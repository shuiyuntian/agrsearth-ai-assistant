/**
 * 文件作用：auth.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import {
  createAuthMiddleware,
  normalizeFastjson2,
  type AuthInfo,
} from "../src/auth/middleware.js";
import { MemoryStore } from "../src/store/kv.js";

const SECRET = "abcdefghijklmnopqrstuvwxyz";

function mockReqRes(headers: Record<string, string> = {}) {
  const state: { statusCode: number; body: unknown; auth?: AuthInfo; nextCalled: boolean } = {
    statusCode: 200,
    body: undefined,
    nextCalled: false,
  };
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  const next = () => {
    state.nextCalled = true;
    state.auth = req.auth;
  };
  return { req, res, next, state };
}

const FASTJSON2_LOGIN =
  '{"userid":1001L,"username":"alice","roles":Set["admin","user"],"expireTime":1893456000000L}';

describe("normalizeFastjson2", () => {
  it("Set[...] → [...]，长整型 123L → 123", () => {
    const normalized = normalizeFastjson2(FASTJSON2_LOGIN);
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    expect(parsed.userid).toBe(1001);
    expect(parsed.roles).toEqual(["admin", "user"]);
    expect(parsed.expireTime).toBe(1893456000000);
  });
});

describe("鉴权中间件", () => {
  const config = { AUTH_ENABLED: true, JWT_SECRET: SECRET };

  it("无任何身份 → 401", async () => {
    const mw = createAuthMiddleware(config, new MemoryStore());
    const { req, res, next, state } = mockReqRes();
    await mw(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  it("user_key header + Redis 登录态 → 放行并提取 username", async () => {
    const store = new MemoryStore();
    await store.set("login_tokens:uk-1", FASTJSON2_LOGIN);
    const mw = createAuthMiddleware(config, store);

    const { req, res, next, state } = mockReqRes({ user_key: "uk-1" });
    await mw(req, res, next);
    expect(state.nextCalled).toBe(true);
    expect(state.auth?.username).toBe("alice");
    expect(state.auth?.userId).toBe(1001);
    expect(state.auth?.via).toBe("header");
  });

  it("user_key 存在但登录态缺失 → 401", async () => {
    const mw = createAuthMiddleware(config, new MemoryStore());
    const { req, res, next, state } = mockReqRes({ user_key: "ghost" });
    await mw(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  it("无 header 时 JWT 兜底（HS512，claim user_key）", async () => {
    const store = new MemoryStore();
    await store.set("login_tokens:uk-jwt", FASTJSON2_LOGIN);
    const token = jwt.sign({ user_key: "uk-jwt" }, SECRET, { algorithm: "HS512" });
    const mw = createAuthMiddleware(config, store);

    const { req, res, next, state } = mockReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next);
    expect(state.nextCalled).toBe(true);
    expect(state.auth?.via).toBe("jwt");
    expect(state.auth?.username).toBe("alice");
  });

  it("错误 secret 的 JWT → 401", async () => {
    const token = jwt.sign({ user_key: "uk-jwt" }, "wrong-secret", { algorithm: "HS512" });
    const mw = createAuthMiddleware(config, new MemoryStore(), { warn: () => {} });
    const { req, res, next, state } = mockReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  it("AUTH_ENABLED=false → dev-user 直接放行", async () => {
    const mw = createAuthMiddleware(
      { AUTH_ENABLED: false, JWT_SECRET: SECRET },
      new MemoryStore(),
    );
    const { req, res, next, state } = mockReqRes();
    await mw(req, res, next);
    expect(state.nextCalled).toBe(true);
    expect(state.auth?.username).toBe("dev-user");
    expect(state.auth?.via).toBe("dev");
  });
});
