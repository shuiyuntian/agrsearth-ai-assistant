/**
 * 文件作用：模块入口文件
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type LanguageModel, type ToolSet } from "ai";
import { loadConfig } from "./config.js";
import {
  loadRuntimeConfig,
  makeConfigPersister,
  runtimeConfigSchema,
  startConfigPolling,
  type RuntimeConfigData,
} from "./config/runtime.js";
import { createChatModel } from "./llm/provider.js";
import { connectMcp } from "./mcp/client.js";
import { CommandRouter, createChannelRouter } from "./channel/command-router.js";
import { createChatRouter } from "./chat/router.js";
import { createAdminRouter } from "./admin/router.js";
import {
  buildToolRegistry,
  loadContracts,
  parseEnabledToolsEnv,
  type ContractTool,
  type ToolRegistry,
} from "./contracts/registry.js";
import { ArgsValidator } from "./security/validator.js";
import { ApprovalManager } from "./security/approval.js";
import { RateLimiter } from "./security/rate-limit.js";
import { createKVStore } from "./store/kv.js";
import { createMySQLManager } from "./store/mysql.js";
import { SessionManager } from "./chat/session.js";
import { GeocodeHistory } from "./chat/height-inference.js";
import { createHealthHandler } from "./health.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { MySQLAuditSink, setAuditSink } from "./audit/logger.js";
import { runCodegenPipeline } from "./codegen/pipeline.js";
import { buildExposedTools } from "./chat/toolset.js";
import type { SecureToolDeps } from "./chat/secure-tools.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `[orchestrator] config: PORT=${config.PORT} LLM=${config.LLM_BASE_URL} model=${config.LLM_MODEL} MCP_HTTP_URL=${config.MCP_HTTP_URL} GEO_MCP_URL=${config.GEO_MCP_URL || "disabled"} AUTH_ENABLED=${config.AUTH_ENABLED}`,
  );

  // 1. 工具契约（白名单/registry 的事实源）
  const contracts = loadContracts(config.TOOL_CONTRACTS_PATH);

  // 2. MySQL（不可达自动降级：审计回退 console、配置回退 env）
  const mysql = await createMySQLManager(config.MYSQL_URL, {
    healthIntervalMs: config.MYSQL_HEALTH_INTERVAL_MS,
  });
  // 审计 sink 内部按 manager 当前状态选路（up 写库 / down 回 console），始终挂载
  if (mysql) setAuditSink(new MySQLAuditSink(mysql));

  // 3. 运行时配置（ai_config 单行；库里有行以库为准）
  const envDefaults: RuntimeConfigData = runtimeConfigSchema.parse({
    llmBaseUrl: config.LLM_BASE_URL,
    llmModel: config.LLM_MODEL,
    llmApiKeyRef: null,
    agentMaxSteps: config.AGENT_MAX_STEPS,
    temperature: null,
    maxTokens: null,
    rateLimitRpm: config.RATE_LIMIT_RPM,
    enabledTools: parseEnabledToolsEnv(config.ENABLED_TOOLS) ?? null,
    approvalPolicy: contracts.tools
      .filter((t) => t.riskLevel === "destructive")
      .map((t) => t.name),
    codegenEnabled: false,
  });
  const runtime = await loadRuntimeConfig(envDefaults, mysql);
  const stopPolling = startConfigPolling(runtime, mysql, config.CONFIG_POLL_MS);
  console.log(
    `[orchestrator] runtime config: maxSteps=${runtime.snapshot().agentMaxSteps} rpm=${runtime.snapshot().rateLimitRpm} enabledTools=${runtime.snapshot().enabledTools?.length ?? "full"}`,
  );

  // 4. 连接 MCP gateway + geolocation 桥（HTTP streamable，未就绪指数退避重试）
  const mcp = await connectMcp(config);
  const allToolNames = Object.keys(mcp.tools);

  const skillsDir =
    config.CODEGEN_SKILLS_DIR ??
    path.resolve(PKG_ROOT, "../../../../../../.kimi-code/skills");

  // registry/工具集随运行时 enabledTools/codegenEnabled 热更（按 config version 缓存重建）
  let cached: { version: number; registry: ToolRegistry; tools: ToolSet } | null = null;
  function currentTools(): { registry: ToolRegistry; tools: ToolSet } {
    const version = runtime.getVersion();
    if (!cached || cached.version !== version) {
      const rt = runtime.snapshot();
      const registry = buildToolRegistry(
        contracts,
        rt.enabledTools ?? undefined,
      );
      const tools = buildExposedTools(mcp.tools, contracts, registry, rt.codegenEnabled);
      cached = { version, registry, tools };
      console.log(
        `[orchestrator] toolset rebuilt: ${allToolNames.length} MCP tools -> ${Object.keys(tools).length} exposed (codegen=${rt.codegenEnabled})`,
      );
    }
    return cached;
  }
  const getModel = (): LanguageModel => {
    const rt = runtime.snapshot();
    return createChatModel({
      baseURL: rt.llmBaseUrl,
      model: rt.llmModel,
      apiKey: config.LLM_API_KEY,
    });
  };
  console.log(`[orchestrator] MCP connected, ${allToolNames.length} tools`);

  // P3-A codegen 管线闭包（grounding 生成 → AST 校验 → 审批前置产出代码）
  const runCodegen: SecureToolDeps["runCodegen"] = async (input) => {
    const args = (input ?? {}) as { intent?: unknown; description?: unknown };
    const result = await runCodegenPipeline({
      intent: String(args.intent ?? ""),
      description:
        typeof args.description === "string" ? args.description : undefined,
      model: getModel(),
      skillsDir,
      maxAttempts: config.CODEGEN_MAX_ATTEMPTS,
      maxSkills: config.CODEGEN_MAX_SKILLS,
    });
    return {
      code: result.code,
      verified: result.verified,
      attempts: result.attempts,
    };
  };

  // geo MCP 工具内部调用（v2 extent 异步预取）：经 mcp.tools 委托，复用现有
  // geolocation 连接与断线重建重试，不新建 MCP 连接；GEO_MCP_URL 禁用时工具不存在，
  // 预取静默放弃（推算链回落类型表/bbox/缺省）。
  const callGeoTool: SecureToolDeps["callGeoTool"] = async (name, input) => {
    const t = mcp.tools[name] as
      | { execute?: (input: unknown, options: unknown) => Promise<unknown> }
      | undefined;
    if (!t || typeof t.execute !== "function") {
      throw new Error(`geo MCP 工具不可用: ${name}`);
    }
    return t.execute(input, { toolCallId: `geo-internal-${Date.now()}`, messages: [] });
  };

  // 5. 命令通道路由：订阅 gateway SSE（占唯一槽位），对浏览器提供多连接 SSE
  const commandRouter = new CommandRouter({
    mcpSseUrl: config.MCP_SSE_URL,
    mcpResultUrl: config.MCP_RESULT_URL,
  });
  const stopUpstream = commandRouter.connectUpstream();

  // 6. KV 存储（Redis 不可达自动降级内存）+ 会话/审批/限流/鉴权
  const store = await createKVStore(config.REDIS_URL);
  const sessions = new SessionManager(store, config.SESSION_TTL_SEC);
  // S2-B：会话级 geocode 历史（camera_* 高度推算用，TTL 对齐会话 TTL）
  const geocodeHistory = new GeocodeHistory(config.SESSION_TTL_SEC * 1000);
  const approvals = new ApprovalManager(config.APPROVAL_TIMEOUT_MS);
  const validator = new ArgsValidator();
  const rateLimiter = new RateLimiter(60_000);
  const auth = createAuthMiddleware(config, store);

  // 7. HTTP 服务
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get(
    "/health",
    createHealthHandler({
      toolCount: () => Object.keys(currentTools().tools).length,
      mcpStatus: () => mcp.status(),
      authEnabled: config.AUTH_ENABLED,
      storeKind: () => store.kind,
      mysqlUp: () => mysql?.isUp() ?? false,
      configVersion: () => runtime.getVersion(),
      sessionsActive: () => sessions.activeCount(),
    }),
  );

  // P0 验证工具：同源静态 serve test-viewer 页面与本地 Cesium build（零跨域）。
  // Cesium 目录可用 TEST_CESIUM_DIR 覆盖；不存在时跳过挂载并在日志提示（页面将 404）。
  app.use("/scripts", express.static(path.join(PKG_ROOT, "scripts")));
  const cesiumDir =
    process.env.TEST_CESIUM_DIR ??
    path.resolve(PKG_ROOT, "node_modules/cesium/Build/CesiumUnminified");
  if (existsSync(cesiumDir)) {
    app.use("/cesium", express.static(cesiumDir));
    console.log(`[orchestrator] serving /cesium from ${cesiumDir}`);
  } else {
    console.warn(`[orchestrator] Cesium build not found at ${cesiumDir}; /cesium disabled`);
  }

  // 鉴权挂载：chat/channel/admin 全链路（/health 与静态验证页保持公开）
  app.use(
    "/channel",
    auth,
    createChannelRouter(commandRouter, {
      verifySession: config.AUTH_ENABLED
        ? async (sessionId, req) =>
            sessions.verify(sessionId, req.auth?.username ?? "")
        : undefined,
    }),
  );
  app.use(
    "/chat",
    auth,
    createChatRouter({
      config,
      runtime,
      getModel,
      getTools: () => currentTools().tools,
      commandRouter,
      // secure-tools 的契约查找用全量 registry（白名单过滤已由 getTools 完成；
      // 传过滤后的 registry 会在热更后误丢工具）
      registry: buildToolRegistry(contracts),
      approvals,
      validator,
      sessions,
      rateLimiter,
      runCodegen,
      geocodeHistory,
      callGeoTool,
    }),
  );
  app.use(
    "/admin",
    auth,
    createAdminRouter({
      config,
      runtime,
      mysql,
      persistConfig: makeConfigPersister(mysql),
    }),
  );

  const server = app.listen(config.PORT, () => {
    console.log(`[orchestrator] listening on http://localhost:${config.PORT}`);
  });

  // 优雅退出：关 MCP 客户端连接
  const shutdown = async (): Promise<void> => {
    console.log("[orchestrator] shutting down...");
    stopPolling();
    stopUpstream();
    server.close();
    await mcp.close().catch(() => undefined);
    await store.close().catch(() => undefined);
    await mysql?.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[orchestrator] fatal:", err);
  process.exit(1);
});
