/**
 * 文件作用：session.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/store/kv.js";
import { DEFAULT_SESSION_TTL_SEC, SessionManager } from "../src/chat/session.js";

const silent = { info: () => {}, warn: () => {} };

describe("会话签发与归属校验", () => {
  it("签发后可校验归属；他人校验失败（防冒用）", async () => {
    const sessions = new SessionManager(new MemoryStore(), 7200, silent);
    const sessionId = await sessions.issue("alice");

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await sessions.verify(sessionId, "alice")).toEqual({ ok: true });

    const other = await sessions.verify(sessionId, "bob");
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toContain("mismatch");
  });

  it("未知 sessionId 校验失败；TTL 过期后视为不存在", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const sessions = new SessionManager(store, 10, silent);

    expect((await sessions.verify("no-such", "alice")).ok).toBe(false);

    const sessionId = await sessions.issue("alice");
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(true);

    now += 11_000; // 超过 TTL 10s
    const expired = await sessions.verify(sessionId, "alice");
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toContain("expired");
  });
});

describe("滑动 TTL（verify 通过即续期）", () => {
  it("TTL 自最近一次校验顺延：活跃会话不过期，闲置超 TTL 才过期", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const sessions = new SessionManager(store, 100, silent);
    const sessionId = await sessions.issue("alice"); // 过期点 now+100s

    now += 90_000; // 距签发 90s（TTL 100s 内）
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(true); // 滑动 → 新过期点 now+100s

    now += 90_000; // 距签发 180s > 100s，但距上次校验 90s → 仍有效
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(true);

    now += 101_000; // 距上次校验 101s > 100s → 过期
    const expired = await sessions.verify(sessionId, "alice");
    expect(expired.ok).toBe(false);
  });

  it("续期不改会话内容（owner/createdAt 原值保留）", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const sessions = new SessionManager(store, 100, silent);
    const sessionId = await sessions.issue("alice");
    const before = await store.get(`chat_session:${sessionId}`);

    now += 50_000;
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(true);
    expect(await store.get(`chat_session:${sessionId}`)).toBe(before);
  });

  it("默认 TTL 43200（12h），不再 2h", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    expect(DEFAULT_SESSION_TTL_SEC).toBe(43_200);
    const sessions = new SessionManager(store, undefined, silent);
    const t0 = now;
    const sessionId = await sessions.issue("alice"); // 过期点 t0+12h

    now = t0 + 7_200_000 + 1; // t0+2h+1ms：旧默认 2h 下已过期
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(true); // 12h 下有效；滑动到 now+12h

    now += 43_200_000 - 2; // 新窗口内（差 2ms）
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(true); // 再次滑动

    now += 43_200_000 + 1; // 距上次校验 12h+1ms → 过期
    expect((await sessions.verify(sessionId, "alice")).ok).toBe(false);
  });
});

describe("activeCount（/health sessions.active 数据源）", () => {
  it("签发计入；verify 未命中剔除；惰性清理过期项", async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryStore();
      const sessions = new SessionManager(store, 60, silent);
      expect(sessions.activeCount()).toBe(0);

      const a = await sessions.issue("alice");
      await sessions.issue("bob");
      expect(sessions.activeCount()).toBe(2);

      // 存储侧删除后 verify 未命中 → 从活跃集剔除
      await store.del(`chat_session:${a}`);
      expect((await sessions.verify(a, "alice")).ok).toBe(false);
      expect(sessions.activeCount()).toBe(1);

      // 超 TTL 未访问 → activeCount 惰性清理
      vi.setSystemTime(Date.now() + 61_000);
      expect(sessions.activeCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("verify 通过刷新活跃过期点（滑动语义与观测一致）", async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryStore();
      const sessions = new SessionManager(store, 60, silent);
      const id = await sessions.issue("alice");

      vi.setSystemTime(Date.now() + 50_000);
      expect((await sessions.verify(id, "alice")).ok).toBe(true); // 滑动

      vi.setSystemTime(Date.now() + 50_000); // 距签发 100s，距上次校验 50s
      expect(sessions.activeCount()).toBe(1);

      vi.setSystemTime(Date.now() + 61_000); // 距上次校验 61s
      expect(sessions.activeCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
