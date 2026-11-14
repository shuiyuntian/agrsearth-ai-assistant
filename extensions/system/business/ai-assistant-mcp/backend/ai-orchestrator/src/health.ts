/**
 * 文件作用：health 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-26
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { Request, Response } from "express";

/**
 * /health 处理器（提取为纯工厂便于单测）。
 * sessions.active：SessionManager 进程内观测的活跃会话数（签发/校验见过且未过期，
 * 滑动 TTL 下活跃会话不过期；重启后只计本实例见过的会话）。
 */
export interface HealthDeps {
  toolCount: () => number;
  mcpStatus: () => unknown;
  authEnabled: boolean;
  storeKind: () => "redis" | "memory";
  mysqlUp: () => boolean;
  configVersion: () => number;
  sessionsActive: () => number;
}

export function createHealthHandler(deps: HealthDeps) {
  return (_req: Request, res: Response): void => {
    res.json({
      status: "ok",
      tools: deps.toolCount(),
      transport: "http",
      mcp: deps.mcpStatus(),
      auth: deps.authEnabled,
      store: deps.storeKind(),
      mysql: deps.mysqlUp() ? "up" : "down",
      configVersion: deps.configVersion(),
      sessions: { active: deps.sessionsActive() },
    });
  };
}
