/**
 * 文件作用：runtime 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { z } from "zod";
import type { MySQLManager } from "../store/mysql.js";

/**
 * 运行时配置中心（P2-A）。
 *
 * 事实源：MySQL `ai_config` 单行 JSON（id=1）；无 MySQL 时回退 env 默认。
 * 启动加载一次；PUT /admin/config 写入后进程内即时生效（version 递增，下一轮
 * 请求即用新值）；另有 30s 轮询兜底外部直接改库的场景。
 *
 * 引用方：chat（llmBaseUrl/llmModel/agentMaxSteps/temperature/maxTokens）、
 * 限流（rateLimitRpm）、白名单（enabledTools 重算 registry）、审批策略（approvalPolicy）。
 */
export const runtimeConfigSchema = z.object({
  llmBaseUrl: z.url(),
  llmModel: z.string().min(1),
  /** API key 的引用名（非 key 本体；GET 时脱敏） */
  llmApiKeyRef: z.string().nullable().default(null),
  agentMaxSteps: z.number().int().min(1).max(100),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxTokens: z.number().int().min(1).nullable().default(null),
  rateLimitRpm: z.number().int().min(1),
  /** null = 契约全量 */
  enabledTools: z.array(z.string()).nullable().default(null),
  /** 需审批的工具清单（destructive 子集） */
  approvalPolicy: z.array(z.string()),
  codegenEnabled: z.boolean().default(false),
});
export type RuntimeConfigData = z.infer<typeof runtimeConfigSchema>;

export const runtimeConfigPatchSchema = runtimeConfigSchema.partial();

export class RuntimeConfig {
  private data: RuntimeConfigData;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(initial: RuntimeConfigData) {
    this.data = initial;
  }

  snapshot(): Readonly<RuntimeConfigData> {
    return this.data;
  }

  getVersion(): number {
    return this.version;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** 应用部分更新：合并 → 全量校验 → 持久化 → 生效（version++ 通知监听者） */
  async applyPatch(
    patch: unknown,
    opts?: { persist?: (data: RuntimeConfigData) => Promise<void>; updateBy?: string },
  ): Promise<RuntimeConfigData> {
    const parsed = runtimeConfigPatchSchema.parse(patch);
    const next = runtimeConfigSchema.parse({ ...this.data, ...parsed });
    if (opts?.persist) await opts.persist(next);
    this.data = next;
    this.version++;
    for (const fn of this.listeners) fn();
    return next;
  }

  /** 轮询兜底：外部改库后整体替换（内容相同则不动） */
  replaceAll(raw: unknown): boolean {
    const next = runtimeConfigSchema.parse(raw);
    if (JSON.stringify(next) === JSON.stringify(this.data)) return false;
    this.data = next;
    this.version++;
    for (const fn of this.listeners) fn();
    return true;
  }
}

// -------------------------------------------------------------------------------
// MySQL 读写 + 轮询
// -------------------------------------------------------------------------------

const SELECT_SQL = "SELECT config_json FROM ai_config WHERE id = 1";
const UPSERT_SQL =
  "INSERT INTO ai_config (id, config_json, update_by) VALUES (1, CAST(? AS JSON), ?) " +
  "ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), update_by = VALUES(update_by)";

export function makeConfigPersister(mysql: MySQLManager | null) {
  return async (data: RuntimeConfigData, updateBy?: string): Promise<void> => {
    const ex = mysql?.executor();
    if (!ex) {
      // MySQL 当前 down：仅进程内生效，恢复后由轮询/onRecovery 拉回（库值可能落后）
      console.warn("[runtime-config] mysql down; config applied in-memory only (not persisted)");
      return;
    }
    await ex.execute(UPSERT_SQL, [JSON.stringify(data), updateBy ?? "admin"]);
  };
}

/** 从 ai_config 读一行并整体替换（返回是否发生变化）；mysql down 时静默跳过 */
export async function reloadRuntimeFromDb(
  runtime: RuntimeConfig,
  mysql: MySQLManager | null,
  logger: Pick<typeof console, "info" | "warn"> = console,
): Promise<boolean> {
  const ex = mysql?.executor();
  if (!ex) return false;
  try {
    const rows = await ex.query<import("mysql2/promise").RowDataPacket>(SELECT_SQL);
    const row = rows[0];
    if (!row) return false;
    const raw =
      typeof row.config_json === "string"
        ? JSON.parse(row.config_json)
        : row.config_json;
    const changed = runtime.replaceAll(raw);
    if (changed) {
      logger.info("[runtime-config] reloaded from ai_config");
    }
    return changed;
  } catch (err) {
    // 读失败：上报让 manager 立即重探（不等待下个周期）
    mysql?.noteFailure();
    logger.warn(
      `[runtime-config] reload failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** 启动加载：库里有行则以库为准（覆盖 env 默认），无行用 env 默认并回写一行 */
export async function loadRuntimeConfig(
  defaults: RuntimeConfigData,
  mysql: MySQLManager | null,
  logger: Pick<typeof console, "info" | "warn"> = console,
): Promise<RuntimeConfig> {
  const ex = mysql?.executor();
  if (ex) {
    try {
      const rows = await ex.query<import("mysql2/promise").RowDataPacket>(SELECT_SQL);
      const row = rows[0];
      if (row) {
        const raw =
          typeof row.config_json === "string"
            ? JSON.parse(row.config_json)
            : row.config_json;
        const merged = runtimeConfigSchema.parse({ ...defaults, ...(raw as object) });
        logger.info("[runtime-config] loaded from ai_config (db row wins)");
        return new RuntimeConfig(merged);
      }
      await ex.execute(UPSERT_SQL, [JSON.stringify(defaults), "init"]);
      logger.info("[runtime-config] ai_config empty; seeded with env defaults");
    } catch (err) {
      logger.warn(
        `[runtime-config] load failed (${err instanceof Error ? err.message : String(err)}); using env defaults`,
      );
    }
  }
  return new RuntimeConfig(defaults);
}

/**
 * 30s 轮询兜底外部修改 + MySQL 恢复即时 reload。
 * manager 挂 onRecovery：down→up 迁移时立刻拉一次 DB 值（不等下个周期）。
 */
export function startConfigPolling(
  runtime: RuntimeConfig,
  mysql: MySQLManager | null,
  intervalMs: number = 30_000,
  logger: Pick<typeof console, "info" | "warn"> = console,
): () => void {
  if (!mysql) return () => {};
  mysql.onRecovery(() => {
    logger.info("[runtime-config] mysql recovered; reloading config from ai_config");
    void reloadRuntimeFromDb(runtime, mysql, logger);
  });
  const timer = setInterval(() => {
    void reloadRuntimeFromDb(runtime, mysql, logger);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
