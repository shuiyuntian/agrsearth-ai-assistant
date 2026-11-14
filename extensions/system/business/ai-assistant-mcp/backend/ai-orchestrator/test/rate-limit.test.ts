/**
 * 文件作用：rate-limit.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/security/rate-limit.js";

describe("滑动窗口限流", () => {
  it("窗口内 20 放行、第 21 个拒绝并带 Retry-After", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(60_000, () => now);

    for (let i = 0; i < 20; i++) {
      expect(limiter.check("alice", 20).allowed).toBe(true);
    }
    const denied = limiter.check("alice", 20);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);

    // 窗口滑过后恢复
    now += 61_000;
    expect(limiter.check("alice", 20).allowed).toBe(true);
  });

  it("不同 key 互不影响（per-user）", () => {
    const limiter = new RateLimiter(60_000, () => 1_000_000);
    for (let i = 0; i < 20; i++) limiter.check("alice", 20);
    expect(limiter.check("alice", 20).allowed).toBe(false);
    expect(limiter.check("bob", 20).allowed).toBe(true);
  });
});
