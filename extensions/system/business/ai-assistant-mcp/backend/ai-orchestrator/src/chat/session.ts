/**
 * 文件作用：session 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { randomUUID } from "node:crypto";
import type { KVStore } from "../store/kv.js";

/**
 * 会话签发与归属校验（P1-A + 滑动 TTL）。
 * POST /chat/session 签发（owner=username，TTL 默认 12h，SESSION_TTL_SEC 可覆盖）；
 * /chat、/channel/events、/chat/approval 校验 sessionId 存在且归属当前用户（防冒用）；
 * verify 通过即按原值重写续期（滑动 TTL：活跃会话不过期，闲置超 TTL 才过期）；
 * 签发/过期（含校验未命中）打 info 日志，归属不符打 warn；
 * activeCount() 供 /health 暴露 sessions.active（进程内观测：本实例签发/校验见过
 * 且未过期的会话数；重启后只计本实例见过的会话）。
 */
const KEY_PREFIX = "chat_session:";
/** 默认 TTL：12 小时（SESSION_TTL_SEC 环境变量可覆盖） */
export const DEFAULT_SESSION_TTL_SEC = 43_200;

type Logger = Pick<typeof console, "info" | "warn">;

export class SessionManager {
  /** sessionId -> 过期时间（ms epoch），随签发/滑动续期刷新，activeCount 惰性清理 */
  private readonly active = new Map<string, number>();

  constructor(
    private readonly store: KVStore,
    private readonly ttlSec: number = DEFAULT_SESSION_TTL_SEC,
    private readonly logger: Logger = console,
  ) {}

  async issue(owner: string): Promise<string> {
    const sessionId = randomUUID();
    await this.store.set(
      `${KEY_PREFIX}${sessionId}`,
      JSON.stringify({ owner, createdAt: Date.now() }),
      this.ttlSec,
    );
    this.active.set(sessionId, Date.now() + this.ttlSec * 1000);
    this.logger.info(
      `[session] issued: owner=${owner} ttl=${this.ttlSec}s active=${this.activeCount()}`,
    );
    return sessionId;
  }

  async verify(
    sessionId: string,
    owner: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const key = `${KEY_PREFIX}${sessionId}`;
    const raw = await this.store.get(key);
    if (!raw) {
      this.active.delete(sessionId);
      this.logger.info(
        `[session] verify failed (not found or expired): owner=${owner} active=${this.activeCount()}`,
      );
      return { ok: false, reason: "session not found or expired" };
    }
    let parsed: { owner?: string };
    try {
      parsed = JSON.parse(raw) as { owner?: string };
    } catch {
      return { ok: false, reason: "malformed session record" };
    }
    if (parsed.owner !== owner) {
      this.logger.warn(`[session] verify failed: owner mismatch (expected=${parsed.owner} got=${owner})`);
      return { ok: false, reason: "session owner mismatch" };
    }
    // 滑动 TTL：原值重写，过期时间自本次校验顺延 ttlSec
    await this.store.set(key, raw, this.ttlSec);
    this.active.set(sessionId, Date.now() + this.ttlSec * 1000);
    return { ok: true };
  }

  /** 当前活跃会话数（惰性清理过期项；进程内观测值） */
  activeCount(): number {
    const now = Date.now();
    for (const [id, expiresAt] of this.active) {
      if (now >= expiresAt) this.active.delete(id);
    }
    return this.active.size;
  }
}
