/**
 * 文件作用：rate-limit 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * 滑动窗口限流（P1-A）：per-user/per-IP，进程内存实现。
 * P2 多实例部署时换 Redis 计数器（KVStore 已就位）。
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string, limit: number): RateLimitResult {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (arr.length >= limit) {
      this.hits.set(key, arr);
      const oldest = arr[0]!;
      return {
        allowed: false,
        retryAfterSec: Math.max(
          1,
          Math.ceil((oldest + this.windowMs - now) / 1000),
        ),
      };
    }

    arr.push(now);
    this.hits.set(key, arr);
    return { allowed: true, retryAfterSec: 0 };
  }
}
