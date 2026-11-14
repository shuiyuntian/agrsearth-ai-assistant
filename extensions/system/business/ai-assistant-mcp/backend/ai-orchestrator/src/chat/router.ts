/**
 * 文件作用：router 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { Router, type Request, type Response } from "express";
import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";
import type { Config } from "../config.js";
import type { RuntimeConfig, RuntimeConfigData } from "../config/runtime.js";
import type { CommandRouter } from "../channel/command-router.js";
import type { ToolRegistry } from "../contracts/registry.js";
import type { ApprovalManager } from "../security/approval.js";
import type { ArgsValidator } from "../security/validator.js";
import type { RateLimiter } from "../security/rate-limit.js";
import type { SessionManager } from "./session.js";
import { wrapToolsForSession, type SecureToolDeps } from "./secure-tools.js";
import type { GeocodeHistory } from "./height-inference.js";
import { auditLlm } from "../audit/logger.js";

const SYSTEM_PROMPT =
  "你是一个 GIS 助手，通过工具控制浏览器中的 Cesium 地球：接收自然语言指令，调用合适工具完成相机飞行、实体管理与图层操作，并用中文简要总结结果。" +
  "规则：工具返回被拒绝（denied）、审批超时或失败时，视为用户的明确意愿或操作边界，禁止重试同一或等效操作；直接向用户说明该操作未执行并致歉，等待进一步指示。" +
  "流程规则：「飞到某地/定位到某地」类请求必须先调用 geolocation_geocode 获取坐标、再调用 camera_fly_to（或 camera_set_view）完成飞行；禁止只 geocode 不飞行就声称完成。" +
  "相机高度规则：调用 camera_fly_to/camera_set_view/camera_look_at_transform 时，destination/target 的 height 一律省略（不要自行估算高度）——系统会依据本会话最近一次 geolocation_geocode 的结果自动推算合适的观察高度（有范围数据按范围等比缩放，否则按地点类型默认值）填入；仅当用户明确要求特定高度时才显式传入 height 覆盖推算值。" +
  "相机视角规则：「飞到某地/定位到某地」类请求一律保持垂直俯视——调用 camera_fly_to/camera_set_view 时省略 orientation 参数（系统会自动填入正北垂直俯视）；仅当用户明确要求视角（如“侧视”“45 度”“倾斜看”）时才显式设置 orientation。";

/** UIMessage 形态的宽松校验（content 字符串或 parts 数组，其余字段透传） */
const messageSchema = z
  .looseObject({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
    parts: z.array(z.unknown()).optional(),
  })
  .refine((m) => m.content !== undefined || m.parts !== undefined, {
    message: "message must have content or parts",
  });

const chatEnvelopeSchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(messageSchema).min(1).max(100),
});

const approvalSchema = z.object({
  sessionId: z.string().min(1),
  callId: z.string().min(1),
  approved: z.boolean(),
});

export interface ChatRouterDeps {
  config: Config;
  /** 运行时配置（热更源）：maxSteps/temperature/maxTokens/rpm/approvalPolicy */
  runtime: RuntimeConfig;
  /** 每请求取模型（llmBaseUrl/llmModel 可热更） */
  getModel: () => LanguageModel;
  /** 每请求取工具集（enabledTools 白名单可热更） */
  getTools: () => ToolSet;
  commandRouter: CommandRouter;
  registry: ToolRegistry;
  approvals: ApprovalManager;
  validator: ArgsValidator;
  sessions: SessionManager;
  rateLimiter: RateLimiter;
  /** codegen 管线（codegenEnabled=true 时由 index 注入） */
  runCodegen?: SecureToolDeps["runCodegen"];
  /** 会话级 geocode 历史（S2-B 高度推算；缺省用 secure-tools 进程内共享实例） */
  geocodeHistory?: GeocodeHistory;
  /** geo MCP 工具内部调用（v2 extent 异步预取；index 以 mcp.tools 委托注入） */
  callGeoTool?: SecureToolDeps["callGeoTool"];
}

/** chat 循环参数解析（运行时配置快照 → streamText 入参），供路由与测试共用 */
export function resolveChatParams(rt: Readonly<RuntimeConfigData>): {
  maxSteps: number;
  temperature?: number;
  maxOutputTokens?: number;
} {
  return {
    maxSteps: rt.agentMaxSteps,
    temperature: rt.temperature ?? undefined,
    maxOutputTokens: rt.maxTokens ?? undefined,
  };
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const { config, runtime, getModel, getTools, commandRouter, registry, approvals, validator, sessions, rateLimiter, runCodegen, geocodeHistory, callGeoTool } = deps;
  const router = Router();

  /** 会话签发：返回 {sessionId}，owner=当前用户，TTL SESSION_TTL_SEC */
  router.post("/session", async (req: Request, res: Response) => {
    const owner = req.auth?.username ?? "anonymous";
    const sessionId = await sessions.issue(owner);
    res.json({ sessionId });
  });

  /** 审批回执：{sessionId, callId, approved} → resolve 对应挂起 */
  router.post("/approval", async (req: Request, res: Response) => {
    const parsed = approvalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid approval envelope" });
      return;
    }
    const { sessionId, callId, approved } = parsed.data;

    // 归属校验（AUTH_ENABLED=false 的 dev 模式跳过）
    if (config.AUTH_ENABLED) {
      const v = await sessions.verify(sessionId, req.auth?.username ?? "");
      if (!v.ok) {
        res.status(403).json({ error: v.reason });
        return;
      }
    }
    // 挂起的审批必须属于该 session（防跨会话回执）
    if (approvals.getSessionId(callId) !== sessionId) {
      res.status(404).json({ error: "no pending approval for callId" });
      return;
    }

    const ok = approvals.decide(callId, approved, req.auth?.username);
    if (!ok) {
      res.status(404).json({ error: "no pending approval for callId" });
      return;
    }
    res.json({ success: true });
  });

  router.post("/", async (req: Request, res: Response) => {
    const parsed = chatEnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid chat envelope",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    const { sessionId, messages } = parsed.data;

    // 运行时配置快照（热更：本轮请求即用最新值）
    const rt = runtime.snapshot();
    const chatParams = resolveChatParams(rt);
    const username = req.auth?.username ?? "anonymous";

    // 会话归属校验（AUTH_ENABLED=false 的 dev 模式允许任意 ad-hoc sessionId）
    if (config.AUTH_ENABLED) {
      const v = await sessions.verify(sessionId, username);
      if (!v.ok) {
        res.status(403).json({ error: v.reason });
        return;
      }
    }

    // 限流：per-user（无身份时 per-IP）滑动窗口（rpm 运行时热更）
    const rateKey = username === "anonymous" ? `ip:${req.ip ?? "unknown"}` : username;
    const rl = rateLimiter.check(rateKey, rt.rateLimitRpm);
    if (!rl.allowed) {
      res
        .status(429)
        .setHeader("Retry-After", String(rl.retryAfterSec))
        .json({ error: "rate limit exceeded", retryAfterSec: rl.retryAfterSec });
      return;
    }

    // content 全为字符串时可直接作为 ModelMessage；否则走 UIMessage 转换
    const allStringContent = messages.every((m) => typeof m.content === "string");
    const modelMessages: ModelMessage[] = allStringContent
      ? (messages as unknown as ModelMessage[])
      : await convertToModelMessages(messages as unknown as UIMessage[]);

    // 当前请求的 UI 流 writer（destructive 审批 data part 用），
    // 在 createUIMessageStream 的 execute 里赋值，工具执行时读取
    let writer: UIMessageStreamWriter | undefined;

    const wrappedTools = wrapToolsForSession(getTools(), {
      sessionId,
      username,
      ip: req.ip,
      registry,
      commandRouter,
      approvals,
      validator,
      isApprovalRequired: (toolName) =>
        runtime.snapshot().approvalPolicy.includes(toolName),
      runCodegen,
      geocodeHistory,
      callGeoTool,
      getWriter: () => writer,
    });

    try {
      const t0 = Date.now();
      const stream = createUIMessageStream({
        execute: ({ writer: w }) => {
          writer = w;
          const result = streamText({
            model: getModel(),
            system: SYSTEM_PROMPT,
            messages: modelMessages,
            tools: wrappedTools,
            stopWhen: stepCountIs(chatParams.maxSteps),
            temperature: chatParams.temperature,
            maxOutputTokens: chatParams.maxOutputTokens,
            onFinish: ({ totalUsage }) => {
              // LLM 用量审计（kind=llm；逐步/汇总取汇总 totalUsage，简单可靠）
              auditLlm({
                user: username,
                sessionId,
                model: rt.llmModel,
                promptTokens: totalUsage.inputTokens,
                completionTokens: totalUsage.outputTokens,
                durationMs: Date.now() - t0,
                ip: req.ip,
              });
            },
            onError: ({ error }) => {
              console.error(
                `[chat] stream error (session=${sessionId}):`,
                error instanceof Error ? error.message : error,
              );
            },
          });
          w.merge(result.toUIMessageStream());
        },
        onError: (error) =>
          error instanceof Error ? error.message : String(error),
      });

      // SSE 形式的 UI message stream（防中间层 nginx 攒批）
      res.setHeader("X-Accel-Buffering", "no");
      pipeUIMessageStreamToResponse({ response: res, stream });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return router;
}
