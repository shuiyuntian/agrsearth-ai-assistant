/**
 * 文件作用：config 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { z } from "zod";

/**
 * 环境变量配置（P0）。
 * 全部经 zod 校验，非法时 fail-fast 并打印全部 issue。
 *
 * P1 预留：鉴权 token、审批开关、工具白名单等在此追加字段即可。
 */
const envSchema = z.object({
  /** orchestrator HTTP 监听端口 */
  PORT: z.coerce.number().int().min(1).max(65535).default(9600),

  /** 外部 OpenAI 兼容端点；公开默认不可达，实际地址由环境配置接管 */
  LLM_BASE_URL: z.url().default("https://llm.example.invalid/v1"),
  LLM_MODEL: z
    .string()
    .min(1)
    .default("external-model"),
  /** 可空；vLLM 本地部署一般不需要 */
  LLM_API_KEY: z.string().optional(),

  /** MCP gateway 通信服务（SSE 命令通道）地址 */
  MCP_SSE_URL: z.url().default("http://localhost:3010/mcp/events"),
  MCP_RESULT_URL: z.url().default("http://localhost:3010/mcp/result"),

  /** MCP gateway 的 streamable-http 端点（外部进程，端口=通信端口+1000） */
  MCP_HTTP_URL: z.url().default("http://localhost:4010/mcp"),
  /** geolocation HTTP 桥（backend/geolocation-http）端点；空串=禁用 */
  GEO_MCP_URL: z
    .union([z.url(), z.literal("")])
    .default("http://localhost:3008/mcp"),

  /** agent 最大步数（stopWhen: stepCountIs） */
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(100).default(8),

  // -------------------------------------------------------------------------
  // P1-A：安全闸 / 会话 / 限流
  // -------------------------------------------------------------------------

  /** 工具白名单（逗号分隔；缺省=契约全量；空字符串=空白名单） */
  ENABLED_TOOLS: z.string().optional(),
  /** 契约文件路径（缺省相对包根 ../../contracts/tool-contracts.json） */
  TOOL_CONTRACTS_PATH: z.string().optional(),

  /** 鉴权开关（本地联调可 false，dev 身份 dev-user） */
  AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** RuoYi JWT secret（HS512，claim user_key），无 user_key header 时解 JWT 兜底 */
  JWT_SECRET: z.string().min(1).default("abcdefghijklmnopqrstuvwxyz"),

  /** Redis 连接串；不可达时自动降级内存 Map（日志 warn） */
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** 会话 TTL（秒），默认 12h；verify 通过即滑动续期（活跃会话不过期） */
  SESSION_TTL_SEC: z.coerce.number().int().min(60).default(43_200),

  /** 限流：滑动窗口每分钟请求数（per-user/per-IP） */
  RATE_LIMIT_RPM: z.coerce.number().int().min(1).default(20),

  /** destructive 工具审批超时（毫秒），超时=拒绝（fail-closed） */
  APPROVAL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),

  // -------------------------------------------------------------------------
  // P2-A：MySQL 管理面
  // -------------------------------------------------------------------------

  /** MySQL 连接串（ai_config / ai_operation_log 所在库）；未配置或不可达时降级 env/console */
  MYSQL_URL: z.string().optional(),
  /** MySQL 健康探测间隔（毫秒）：down 状态周期重探，恢复自动切回 */
  MYSQL_HEALTH_INTERVAL_MS: z.coerce.number().int().min(200).default(30_000),
  /** ai_config 轮询间隔（毫秒），兜底外部直接改库 */
  CONFIG_POLL_MS: z.coerce.number().int().min(1000).default(30_000),

  // -------------------------------------------------------------------------
  // P3-A：codegen 管线
  // -------------------------------------------------------------------------

  /** 领域技能目录（默认解析到仓库根 .kimi-code/skills） */
  CODEGEN_SKILLS_DIR: z.string().optional(),
  /** BM25 选域个数（top N） */
  CODEGEN_MAX_SKILLS: z.coerce.number().int().min(1).max(3).default(1),
  /** 生成-校验重试上限 */
  CODEGEN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // fail-fast：打印全部 issue 后退出
    console.error(`[config] invalid environment:\n${issues}`);
    throw new Error(`Invalid configuration (${result.error.issues.length} issue(s))`);
  }
  return result.data;
}
