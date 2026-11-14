/**
 * 文件作用：kv 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * KV 存储抽象（P1-A）+ Redis 自动重连（降级粘性修复）。
 *
 * 首选 Redis（REDIS_URL）；不可达/断连时降级进程内 MemoryStore（同接口，日志 warn）。
 *
 * 关键语义（修复点）：
 *  - ioredis 自动重连常开（retryStrategy 有界退避：5s 起步线性、封顶 30s）；
 *  - ready 事件置 available=true，close/end 置 false；
 *  - 每个操作按当前 available 选路（Redis 或 MemoryStore），不在启动时一次性定死；
 *  - 启动期保留 1.5s connectTimeout 快速失败语义（失败即降级，后台继续重连）；
 *  - enableOfflineQueue=false：未就绪时命令立即报错并回落内存，不排队悬挂。
 */
export interface KVStore {
  /** 当前生效后端（动态：redis 断连时为 memory，恢复后回 redis） */
  readonly kind: "redis" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

export class MemoryStore implements KVStore {
  readonly kind = "memory";
  private readonly map = new Map<string, MemoryEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && this.now() >= entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.map.set(key, {
      value,
      expiresAt: ttlSec !== undefined ? this.now() + ttlSec * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async close(): Promise<void> {
    this.map.clear();
  }
}

/** 最小 Redis 客户端接口（ioredis 满足；测试注入 stub 用） */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  disconnect(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export class ResilientKVStore implements KVStore {
  private available = false;
  private readonly memory = new MemoryStore();

  constructor(
    private readonly redis: RedisLike,
    private readonly logger: Pick<typeof console, "info" | "warn"> = console,
  ) {
    redis.on("ready", () => {
      if (!this.available) {
        this.available = true;
        this.logger.info("[store] redis ready -> serving from redis");
      }
    });
    redis.on("close", () => {
      if (this.available) {
        this.available = false;
        this.logger.warn("[store] redis connection closed -> memory fallback");
      }
    });
    redis.on("end", () => {
      if (this.available) {
        this.available = false;
        this.logger.warn("[store] redis connection ended -> memory fallback");
      }
    });
  }

  /** 测试/运维观测用 */
  isAvailable(): boolean {
    return this.available;
  }

  get kind(): "redis" | "memory" {
    return this.available ? "redis" : "memory";
  }

  async get(key: string): Promise<string | null> {
    if (this.available) {
      try {
        return await this.redis.get(key);
      } catch (err) {
        this.logger.warn(
          `[store] redis get failed (${err instanceof Error ? err.message : String(err)}); falling back to memory for this op`,
        );
      }
    }
    return this.memory.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (this.available) {
      try {
        if (ttlSec !== undefined) {
          await this.redis.set(key, value, "EX", ttlSec);
        } else {
          await this.redis.set(key, value);
        }
        return;
      } catch (err) {
        this.logger.warn(
          `[store] redis set failed (${err instanceof Error ? err.message : String(err)}); falling back to memory for this op`,
        );
      }
    }
    await this.memory.set(key, value, ttlSec);
  }

  async del(key: string): Promise<void> {
    if (this.available) {
      try {
        await this.redis.del(key);
        return;
      } catch (err) {
        this.logger.warn(
          `[store] redis del failed (${err instanceof Error ? err.message : String(err)}); falling back to memory for this op`,
        );
      }
    }
    await this.memory.del(key);
  }

  async close(): Promise<void> {
    this.redis.disconnect();
    await this.memory.close();
  }
}

/**
 * 创建 KV 存储（带自动重连）。
 * 启动尝试一次连接（1.5s 快速失败）；失败不抛——后台按 retryStrategy 持续重连，
 * 期间请求走内存，恢复后自动切回 Redis。
 */
export async function createKVStore(
  redisUrl: string,
  logger: Pick<typeof console, "info" | "warn"> = console,
): Promise<KVStore> {
  const { Redis } = await import("ioredis");
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // 自动重连：5s 起步线性退避，封顶 30s（永不放弃）
    retryStrategy: (times) => Math.min(5000 * times, 30_000),
  });
  // 重连期间的报错预期内，吞掉 error 事件避免 unhandled
  redis.on("error", () => {});

  const store = new ResilientKVStore(redis as unknown as RedisLike, logger);
  try {
    await redis.connect();
    await redis.ping();
    logger.info(`[store] redis connected: ${redisUrl}`);
  } catch (err) {
    logger.warn(
      `[store] redis unreachable (${err instanceof Error ? err.message : String(err)}); ` +
        "serving from memory, reconnecting in background",
    );
  }
  return store;
}
