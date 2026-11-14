/**
 * 文件作用：health.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-26
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { createHealthHandler } from "../src/health.js";

function mockRes() {
  const state: { body: unknown } = { body: undefined };
  const res = {
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

describe("/health 处理器", () => {
  it("响应含 sessions.active 及既有观测字段", () => {
    const handler = createHealthHandler({
      toolCount: () => 42,
      mcpStatus: () => ({ gateway: { url: "http://x", state: "up", toolCount: 40 } }),
      authEnabled: true,
      storeKind: () => "redis",
      mysqlUp: () => true,
      configVersion: () => 7,
      sessionsActive: () => 3,
    });
    const { res, state } = mockRes();
    handler({} as Request, res);

    const body = state.body as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.tools).toBe(42);
    expect(body.transport).toBe("http");
    expect(body.auth).toBe(true);
    expect(body.store).toBe("redis");
    expect(body.mysql).toBe("up");
    expect(body.configVersion).toBe(7);
    expect(body.sessions).toEqual({ active: 3 });
  });

  it("降级形态：memory store / mysql down / 无活跃会话", () => {
    const handler = createHealthHandler({
      toolCount: () => 0,
      mcpStatus: () => ({}),
      authEnabled: false,
      storeKind: () => "memory",
      mysqlUp: () => false,
      configVersion: () => 1,
      sessionsActive: () => 0,
    });
    const { res, state } = mockRes();
    handler({} as Request, res);

    const body = state.body as Record<string, unknown>;
    expect(body.store).toBe("memory");
    expect(body.mysql).toBe("down");
    expect(body.sessions).toEqual({ active: 0 });
  });
});
