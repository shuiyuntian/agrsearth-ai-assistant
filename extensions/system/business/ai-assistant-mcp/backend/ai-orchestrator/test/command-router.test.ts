/**
 * 文件作用：command-router.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandRouter,
  isBrowserTool,
  wrapBrowserTools,
} from "../src/channel/command-router.js";

function fakeResponse() {
  return {
    write: vi.fn(),
    writableEnded: false,
  } as unknown as Response & { write: ReturnType<typeof vi.fn> };
}

function makeRouter() {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const router = new CommandRouter({
    mcpSseUrl: "http://mock/mcp/events",
    mcpResultUrl: "http://mock/mcp/result",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    logger,
  });
  return { router, fetchImpl, logger };
}

describe("isBrowserTool", () => {
  it("matches hardcoded browser tool patterns", () => {
    expect(isBrowserTool("camera_fly_to")).toBe(true);
    expect(isBrowserTool("entity_create")).toBe(true);
    expect(isBrowserTool("entity_list")).toBe(true);
    expect(isBrowserTool("clock_control")).toBe(true);
    expect(isBrowserTool("globe_set_lighting")).toBe(true);
    expect(isBrowserTool("imagery_list")).toBe(true);
    expect(isBrowserTool("tileset_list")).toBe(true);
    expect(isBrowserTool("terrain_get_height")).toBe(true);
    expect(isBrowserTool("cesium_list_domains")).toBe(false);
    expect(isBrowserTool("list_domains")).toBe(false);
    expect(isBrowserTool("geocode")).toBe(false);
  });
});

describe("CommandRouter 定向匹配", () => {
  it("registered (s1, camera_fly_to) routes command only to s1 connections", async () => {
    const { router } = makeRouter();
    const s1conn = fakeResponse();
    const s2conn = fakeResponse();
    router.addConnection("s1", s1conn);
    router.addConnection("s2", s2conn);

    const release = await router.registerCall("s1", "camera_fly_to");
    const ok = router.handleCommand({ id: "cmd-1", type: "camera_fly_to", x: 1 });

    expect(ok).toBe(true);
    expect(s1conn.write).toHaveBeenCalledTimes(1);
    const frame = String(s1conn.write.mock.calls[0]?.[0]);
    expect(frame).toContain('"id":"cmd-1"');
    expect(frame).toContain('"type":"camera_fly_to"');
    expect(s2conn.write).not.toHaveBeenCalled();
    release();
  });

  it("drops command with no in-flight registration and warns", () => {
    const { router, logger } = makeRouter();
    const conn = fakeResponse();
    router.addConnection("s1", conn);

    const ok = router.handleCommand({ id: "cmd-x", type: "entity_create" });

    expect(ok).toBe(false);
    expect(conn.write).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no in-flight registration"),
    );
  });

  it("drops command when the registered session has no connection", async () => {
    const { router, logger } = makeRouter();
    const release = await router.registerCall("ghost", "camera_fly_to");
    const ok = router.handleCommand({ id: "cmd-g", type: "camera_fly_to" });
    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no connection"),
    );
    release();
  });
});

describe("CommandRouter per-tool 锁", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("serializes concurrent calls of the same tool", async () => {
    const { router } = makeRouter();
    const order: string[] = [];

    const release1 = await router.registerCall("s1", "camera_fly_to");
    order.push("acquired-1");

    let secondAcquired = false;
    const p2 = router.registerCall("s2", "camera_fly_to").then((r) => {
      secondAcquired = true;
      order.push("acquired-2");
      return r;
    });

    // 第二笔同名调用必须等待
    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    release1();
    const release2 = await p2;
    expect(secondAcquired).toBe(true);
    expect(order).toEqual(["acquired-1", "acquired-2"]);
    release2();
  });

  it("different tools do not block each other", async () => {
    const { router } = makeRouter();
    const release1 = await router.registerCall("s1", "camera_fly_to");
    const release2 = await router.registerCall("s2", "entity_create");
    release1();
    release2();
  });

  it("releases the lock when the browser does not respond within the timeout", async () => {
    const { router, logger } = makeRouter();
    const conn = fakeResponse();
    router.addConnection("s1", conn);

    await router.registerCall("s1", "camera_fly_to");
    router.handleCommand({ id: "cmd-t", type: "camera_fly_to" });

    // 第二笔同名调用排队；浏览器一直不回 -> 10s 超时后放锁
    let secondAcquired = false;
    const p2 = router.registerCall("s2", "camera_fly_to").then((r) => {
      secondAcquired = true;
      return r;
    });
    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    const release2 = await p2;
    expect(secondAcquired).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("timed out"),
    );
    release2();
  });
});

describe("CommandRouter.handleResult", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("clears the dispatch timer and forwards to MCP result url", async () => {
    const { router, fetchImpl } = makeRouter();
    const conn = fakeResponse();
    router.addConnection("s1", conn);

    const release = await router.registerCall("s1", "camera_fly_to");
    router.handleCommand({ id: "cmd-r", type: "camera_fly_to" });

    await router.handleResult("cmd-r", { success: true, mock: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://mock/mcp/result",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0]?.[1] as { body: string }).body),
    );
    expect(body).toEqual({ id: "cmd-r", result: { success: true, mock: true } });

    // 计时器已清：推进时间不会触发超时释放（锁仍由 release 持有）
    await vi.advanceTimersByTimeAsync(60_000);
    const stillQueued = router.registerCall("s2", "camera_fly_to");
    let acquired = false;
    void stillQueued.then(() => {
      acquired = true;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    release();
    await stillQueued;
  });
});

describe("wrapBrowserTools", () => {
  it("registers/releases around browser tool execute, passes others through", async () => {
    const { router } = makeRouter();
    const conn = fakeResponse();
    router.addConnection("s1", conn);

    const browserExecute = vi.fn().mockResolvedValue({ success: true });
    const discoveryExecute = vi.fn().mockResolvedValue(["camera"]);
    const tools = {
      camera_fly_to: { description: "fly", execute: browserExecute },
      list_domains: { description: "discover", execute: discoveryExecute },
      no_execute_tool: { description: "schema only" },
    };

    const wrapped = wrapBrowserTools(tools as never, "s1", router as never);

    // 非 browser 工具原样透传
    expect(wrapped.list_domains?.execute).toBe(discoveryExecute);
    expect(wrapped.no_execute_tool).toBe(tools.no_execute_tool);

    // browser 工具：execute 期间存在在途登记（命令可被定向路由）
    let routedDuringCall = 0;
    browserExecute.mockImplementation(async () => {
      if (router.handleCommand({ id: "cmd-w", type: "camera_fly_to" })) {
        routedDuringCall++;
      }
      return { success: true };
    });

    await (wrapped.camera_fly_to as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, {});
    expect(routedDuringCall).toBe(1);
    expect(conn.write).toHaveBeenCalled();

    // 调用结束登记已释放：再来的命令应被丢弃
    expect(router.handleCommand({ id: "cmd-w2", type: "camera_fly_to" })).toBe(false);
  });
});
