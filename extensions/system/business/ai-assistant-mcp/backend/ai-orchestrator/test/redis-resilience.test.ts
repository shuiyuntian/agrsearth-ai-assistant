/**
 * 文件作用：redis-resilience.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-24
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-24) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  ResilientKVStore,
  createKVStore,
  type RedisLike,
} from "../src/store/kv.js";

/** 事件可模拟的 Redis stub（RedisLike 结构） */
function makeRedisStub() {
  const ee = new EventEmitter();
  const fns = {
    get: vi.fn(async (_k: string): Promise<string | null> => null),
    set: vi.fn(async (): Promise<string> => "OK"),
    del: vi.fn(async (): Promise<number> => 1),
    disconnect: vi.fn(),
  };
  const stub: RedisLike = {
    get: fns.get as unknown as RedisLike["get"],
    set: fns.set as unknown as RedisLike["set"],
    del: fns.del as unknown as RedisLike["del"],
    disconnect: fns.disconnect,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      ee.on(event, listener);
      return stub;
    },
  };
  return { stub, fns, emit: (event: string) => ee.emit(event) };
}

describe("ResilientKVStore（事件驱动选路）", () => {
  it("ready/close 事件驱动 redis/memory 切换，每操作按当前状态选路", async () => {
    const { stub: redis, fns, emit } = makeRedisStub();
    const store = new ResilientKVStore(redis, { info: () => {}, warn: () => {} });

    // 初始：未 ready → memory
    expect(store.kind).toBe("memory");
    await store.set("k1", "v1", 100);
    expect(fns.set).not.toHaveBeenCalled();
    expect(await store.get("k1")).toBe("v1");

    // ready → redis
    emit("ready");
    expect(store.kind).toBe("redis");
    fns.get.mockResolvedValueOnce("v2");
    expect(await store.get("k1")).toBe("v2");
    await store.set("k3", "v3", 60);
    expect(fns.set).toHaveBeenCalledWith("k3", "v3", "EX", 60);

    // redis 操作失败 → 该操作回落 memory（不抛）；断连由 close 事件翻转状态（贴近真实时序）
    fns.set.mockRejectedValueOnce(new Error("boom"));
    await store.set("k4", "v4");
    emit("close");
    expect(store.kind).toBe("memory");
    expect(await store.get("k4")).toBe("v4"); // 从 memory 读到

    // memory 期间不再调 redis
    await store.set("k5", "v5");
    expect(fns.set).toHaveBeenCalledTimes(2);

    // 再 ready → 回 redis
    emit("ready");
    expect(store.kind).toBe("redis");
    await store.del("k5");
    expect(fns.del).toHaveBeenCalledWith("k5");
  });
});

describe("createKVStore（必挂端口：启动快速失败 + 后台重连不崩）", () => {
  it("连接 127.0.0.1:6399（无服务）→ memory 提供服务，close 后不再重连", async () => {
    const store = await createKVStore("redis://127.0.0.1:6399", {
      info: () => {},
      warn: () => {},
    });
    expect(store.kind).toBe("memory");
    // 降级后内存语义正常
    await store.set("s1", "x", 60);
    expect(await store.get("s1")).toBe("x");
    // 后台 retryStrategy 活着：等一个重连间隔（~5s 起步）不崩即可（此处只等 300ms 冒烟）
    await new Promise((r) => setTimeout(r, 300));
    expect(store.kind).toBe("memory");
    await store.close();
  }, 10_000);
});
