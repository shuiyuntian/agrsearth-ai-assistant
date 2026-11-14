/**
 * 文件作用：middleware 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import type { Config } from "../config.js";
import type { KVStore } from "../store/kv.js";

/**
 * 鉴权中间件（P1-A 实装）。
 *
 * 身份来源（按序）：
 *  1. `user_key` header（gateway/RuoYi 网关在 token 校验后注入）；
 *  2. Authorization Bearer JWT（HS512，claim user_key）——无 header 时兜底自解。
 * 取到 user_key 后读 Redis `login_tokens:<user_key>`（fastjson2 格式，归一化后解析）
 * 校验登录态并提取 username。无有效身份 → 401。
 *
 * AUTH_ENABLED=false（本地联调）→ 直接放行，身份为 dev-user。
 */

export interface AuthInfo {
  userKey: string;
  username: string;
  userId?: string | number;
  /** LoginUser.permissions（归一化后数组），admin 权限校验用 */
  permissions: string[];
  via: "header" | "jwt" | "dev";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

/** fastjson2 归一化：`Set[...]` → `[...]`，长整型 `123L` → `123` */
export function normalizeFastjson2(raw: string): string {
  return raw
    .replace(/\bSet\[/g, "[")
    .replace(/(-?\d+)L(?=\s*[,}\]])/g, "$1");
}

export function createAuthMiddleware(
  config: Pick<Config, "AUTH_ENABLED" | "JWT_SECRET">,
  store: KVStore,
  logger: Pick<typeof console, "warn"> = console,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!config.AUTH_ENABLED) {
      req.auth = {
        userKey: "dev",
        username: "dev-user",
        permissions: ["*:*:*"],
        via: "dev",
      };
      next();
      return;
    }

    let userKey: string | undefined;
    let via: AuthInfo["via"] = "header";

    const headerKey = req.header("user_key");
    if (headerKey) {
      userKey = headerKey;
    } else {
      // JWT 兜底
      const authz = req.header("authorization");
      const token = authz?.startsWith("Bearer ") ? authz.slice(7) : undefined;
      if (token) {
        try {
          const payload = jwt.verify(token, config.JWT_SECRET, {
            algorithms: ["HS512"],
          }) as { user_key?: string };
          if (payload.user_key) {
            userKey = payload.user_key;
            via = "jwt";
          }
        } catch (err) {
          logger.warn(
            `[auth] JWT verify failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (!userKey) {
      res
        .status(401)
        .json({ error: "unauthorized: missing user_key header or valid JWT" });
      return;
    }

    let raw: string | null;
    try {
      raw = await store.get(`login_tokens:${userKey}`);
    } catch (err) {
      logger.warn(
        `[auth] store error: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(503).json({ error: "auth store unavailable" });
      return;
    }
    if (!raw) {
      res
        .status(401)
        .json({ error: "unauthorized: login token not found or expired" });
      return;
    }

    let loginUser: Record<string, unknown>;
    try {
      loginUser = JSON.parse(normalizeFastjson2(raw)) as Record<string, unknown>;
    } catch {
      res.status(401).json({ error: "unauthorized: malformed login user" });
      return;
    }

    const permissionsRaw = loginUser.permissions;
    req.auth = {
      userKey,
      username:
        (loginUser.username as string | undefined) ??
        ((loginUser.user as Record<string, unknown> | undefined)?.username as
          | string
          | undefined) ??
        "unknown",
      userId:
        (loginUser.userid as string | number | undefined) ??
        ((loginUser.user as Record<string, unknown> | undefined)?.userid as
          | string
          | number
          | undefined),
      permissions: Array.isArray(permissionsRaw)
        ? permissionsRaw.filter((p): p is string => typeof p === "string")
        : [],
      via,
    };
    next();
  };
}
