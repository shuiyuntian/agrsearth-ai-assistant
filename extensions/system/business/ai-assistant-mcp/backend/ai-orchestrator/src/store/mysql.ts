/**
 * 文件作用：mysql 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

/**
 * MySQL 接入（P2-A 管理面）+ 健康重探（降级粘性修复）。
 *
 * MYSQL_URL 形如 mysql://root:pass@localhost:3306/ai_admin。
 * 未配置或不可达 → 降级（审计回退 console、配置回退 env）。
 *
 * 关键语义（修复点）：
 *  - MySQLManager 持有 up/down 状态，周期性 `SELECT 1` 探测（默认 30s，
 *    MYSQL_HEALTH_INTERVAL_MS 可调）；
 *  - down → up：自动切回（onRecovery 通知审计/配置恢复）；up → down：自动降级；
 *  - 调用方任何时刻按当前状态选路（不在启动时一次性定死）；
 *  - mysql2 池在服务端恢复后新建连接天然可用，无需重建池；只有显式 close() 才终结。
 */
export interface SqlExecutor {
  query<T extends RowDataPacket>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ResultSetHeader>;
  close(): Promise<void>;
}

export interface MySQLManager {
  /** 当前是否可用（探测驱动；调用方按此选路） */
  isUp(): boolean;
  /** up 时返回 executor，down 时返回 null */
  executor(): SqlExecutor | null;
  /** down → up 迁移时触发（审计恢复写库、RuntimeConfig reload 等） */
  onRecovery(fn: () => void): void;
  /** 运行期操作失败时上报：立即触发一次重探（不等待下个周期） */
  noteFailure(): void;
  /** 立即探测一次（返回探测后的状态） */
  probeNow(): Promise<boolean>;
  close(): Promise<void>;
}

class MysqlPoolExecutor implements SqlExecutor {
  constructor(private readonly pool: Pool) {}

  async query<T extends RowDataPacket>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const [rows] = await this.pool.query<T[]>(sql, params);
    return rows;
  }

  async execute(sql: string, params?: unknown[]): Promise<ResultSetHeader> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      sql,
      params as Parameters<Pool["execute"]>[1],
    );
    return result;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const DEFAULT_MYSQL_HEALTH_INTERVAL_MS = 30_000;

class PooledMySQLManager implements MySQLManager {
  private readonly pool: Pool;
  private readonly exec: SqlExecutor;
  private up = false;
  private probing = false;
  private closed = false;
  private readonly recoveryListeners = new Set<() => void>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    mysqlUrl: string,
    private readonly healthIntervalMs: number,
    private readonly logger: Pick<typeof console, "info" | "warn">,
  ) {
    this.pool = mysql.createPool({
      uri: mysqlUrl,
      connectionLimit: 5,
      connectTimeout: 2000,
      dateStrings: true,
      // 池内连接被服务端踢掉时不反复重试单条语句，让探测来判定状态
      enableKeepAlive: false,
    });
    this.exec = new MysqlPoolExecutor(this.pool);
    this.timer = setInterval(() => {
      void this.probeNow();
    }, this.healthIntervalMs);
    this.timer.unref();
  }

  isUp(): boolean {
    return this.up;
  }

  executor(): SqlExecutor | null {
    return this.up ? this.exec : null;
  }

  onRecovery(fn: () => void): void {
    this.recoveryListeners.add(fn);
  }

  /** 运行期操作（如审计写入）失败时上报：立即触发一次重探（不等待下个周期） */
  noteFailure(): void {
    if (this.up) void this.probeNow();
  }

  async probeNow(): Promise<boolean> {
    if (this.closed || this.probing) return this.up;
    this.probing = true;
    try {
      await this.exec.query<RowDataPacket>("SELECT 1");
      if (!this.up) {
        this.up = true;
        this.logger.info("[mysql] recovered -> up");
        for (const fn of this.recoveryListeners) {
          try {
            fn();
          } catch (err) {
            this.logger.warn(
              `[mysql] recovery listener error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    } catch {
      if (this.up) {
        this.up = false;
        this.logger.warn("[mysql] probe failed -> down (console/env fallback)");
      }
      // down 状态探测失败：静默保持降级（下个周期再试）
    } finally {
      this.probing = false;
    }
    return this.up;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await this.pool.end().catch(() => undefined);
  }
}

export interface CreateMySQLManagerOptions {
  healthIntervalMs?: number;
  logger?: Pick<typeof console, "info" | "warn">;
}

/**
 * 创建 MySQL 管理器（带周期重探）。
 * MYSQL_URL 未配置 → 返回 null（health 报 down，调用方全走降级路径）。
 * 初始状态由一次同步探测确定（启动期快速失败语义：connectTimeout 2s）。
 */
export async function createMySQLManager(
  mysqlUrl: string | undefined,
  options?: CreateMySQLManagerOptions,
): Promise<MySQLManager | null> {
  const logger = options?.logger ?? console;
  if (!mysqlUrl) {
    logger.warn(
      "[mysql] MYSQL_URL not set; admin/audit persistence disabled (env/console fallback)",
    );
    return null;
  }
  const mgr = new PooledMySQLManager(
    mysqlUrl,
    options?.healthIntervalMs ?? DEFAULT_MYSQL_HEALTH_INTERVAL_MS,
    logger,
  );
  await mgr.probeNow();
  if (mgr.isUp()) {
    logger.info(`[mysql] connected: ${mysqlUrl.replace(/:\/\/[^@]*@/, "://***@")}`);
  } else {
    logger.warn("[mysql] unreachable at startup; running degraded, probing in background");
  }
  return mgr;
}

// ---------------------------------------------------------------------------
// 兼容/测试辅助
// ---------------------------------------------------------------------------

/** 旧接口：一次性连接探测（测试与不需要重探的调用方保留） */
export async function createMySQL(
  mysqlUrl: string | undefined,
  logger: Pick<typeof console, "info" | "warn"> = console,
): Promise<SqlExecutor | null> {
  if (!mysqlUrl) return null;
  try {
    const pool = mysql.createPool({
      uri: mysqlUrl,
      connectionLimit: 5,
      connectTimeout: 2000,
      dateStrings: true,
    });
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    logger.info(`[mysql] connected: ${mysqlUrl.replace(/:\/\/[^@]*@/, "://***@")}`);
    return new MysqlPoolExecutor(pool);
  } catch (err) {
    logger.warn(
      `[mysql] unreachable (${err instanceof Error ? err.message : String(err)}); falling back to env/console`,
    );
    return null;
  }
}

/** 包装一个裸 executor 为恒 up 的 manager（测试用） */
export function staticUpManager(exec: SqlExecutor): MySQLManager {
  return {
    isUp: () => true,
    executor: () => exec,
    onRecovery: () => {},
    noteFailure: () => {},
    probeNow: async () => true,
    close: () => exec.close(),
  };
}
