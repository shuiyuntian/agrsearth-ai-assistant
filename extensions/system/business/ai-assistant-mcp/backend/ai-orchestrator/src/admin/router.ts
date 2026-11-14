/**
 * 文件作用：router 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  runtimeConfigPatchSchema,
  type RuntimeConfig,
  type RuntimeConfigData,
} from "../config/runtime.js";
import type { MySQLManager } from "../store/mysql.js";

/**
 * admin 管理面 API（P2-A）。全部挂在 /admin 下（鉴权中间件在 index.ts 已挂载）。
 *
 * 权限模型：LoginUser.permissions 含 `*:*:*` 或对应权限串才放行；
 * AUTH_ENABLED=false 的 dev 身份自带 *:*:*。
 */

/** 权限串常量（与菜单种子/其他轨道约定一致） */
export const PERMS = {
  configList: "aiassistant:config:list",
  configEdit: "aiassistant:config:edit",
  logList: "aiassistant:log:list",
  statsList: "aiassistant:stats:list",
} as const;

export function requirePermission(perm: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const perms = req.auth?.permissions ?? [];
    if (perms.includes("*:*:*") || perms.includes(perm)) {
      next();
      return;
    }
    res.status(403).json({ code: 403, msg: `permission denied: ${perm}` });
  };
}

export interface AdminRouterDeps {
  config: Config;
  runtime: RuntimeConfig;
  mysql: MySQLManager | null;
  persistConfig: (data: RuntimeConfigData, updateBy?: string) => Promise<void>;
}

function maskConfig(data: RuntimeConfigData): RuntimeConfigData {
  return {
    ...data,
    llmApiKeyRef: data.llmApiKeyRef ? "******" : null,
  };
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const { runtime, mysql, persistConfig } = deps;
  const router = Router();

  /** 当前生效配置（llmApiKeyRef 脱敏） */
  router.get("/config", requirePermission(PERMS.configList), (_req, res) => {
    res.json({ code: 200, msg: "success", data: maskConfig(runtime.snapshot()) });
  });

  /** 部分更新 → 落库 + 进程内即时热更（version 递增，下一轮请求即用新值） */
  router.put("/config", requirePermission(PERMS.configEdit), async (req, res) => {
    const parsed = runtimeConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: 400,
        msg: "invalid config patch",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    try {
      const next = await runtime.applyPatch(parsed.data, {
        persist: (data) => persistConfig(data, req.auth?.username),
        updateBy: req.auth?.username,
      });
      res.json({ code: 200, msg: "success", data: maskConfig(next) });
    } catch (err) {
      res.status(500).json({
        code: 500,
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -------------------------------------------------------------------------
  // 审计日志查询（RuoYi TableDataInfo 形态）
  // -------------------------------------------------------------------------

  const logsQuerySchema = z.object({
    pageNum: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(10),
    username: z.string().optional(),
    toolName: z.string().optional(),
    beginTime: z.string().optional(),
    endTime: z.string().optional(),
  });

  router.get("/logs", requirePermission(PERMS.logList), async (req, res) => {
    const ex = mysql?.executor();
    if (!ex) {
      res.status(503).json({ code: 503, msg: "mysql unavailable (degraded)" });
      return;
    }
    const q = logsQuerySchema.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.username) { where.push("username = ?"); params.push(q.username); }
    if (q.toolName) { where.push("tool_name = ?"); params.push(q.toolName); }
    if (q.beginTime) { where.push("created_at >= ?"); params.push(q.beginTime); }
    if (q.endTime) { where.push("created_at <= ?"); params.push(q.endTime); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRows = await ex.query<RowDataPacket>(
      `SELECT COUNT(*) AS c FROM ai_operation_log ${whereSql}`,
      params,
    );
    const rows = await ex.query<RowDataPacket>(
      `SELECT id, kind, username,
              session_id AS sessionId,
              tool_name AS toolName,
              risk_level AS riskLevel,
              args_summary AS argsSummary,
              outcome,
              approval_status AS approvalStatus,
              duration_ms AS durationMs,
              model,
              prompt_tokens AS promptTokens,
              completion_tokens AS completionTokens,
              ip,
              created_at AS createdAt
       FROM ai_operation_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.pageNum - 1) * q.pageSize],
    );
    res.json({ rows, total: totalRows[0]?.c ?? 0, code: 200, msg: "查询成功" });
  });

  // -------------------------------------------------------------------------
  // 统计
  // -------------------------------------------------------------------------

  const statsQuerySchema = z.object({
    beginTime: z.string().optional(),
    endTime: z.string().optional(),
  });

  function timeWhere(q: { beginTime?: string; endTime?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.beginTime) { where.push("created_at >= ?"); params.push(q.beginTime); }
    if (q.endTime) { where.push("created_at <= ?"); params.push(q.endTime); }
    return { sql: where.length ? `AND ${where.join(" AND ")}` : "", params };
  }

  router.get("/stats/summary", requirePermission(PERMS.statsList), async (req, res) => {
    const ex = mysql?.executor();
    if (!ex) {
      res.status(503).json({ code: 503, msg: "mysql unavailable (degraded)" });
      return;
    }
    const q = statsQuerySchema.parse(req.query);
    const tw = timeWhere(q);

    const llm = await ex.query<RowDataPacket>(
      `SELECT COUNT(*) AS requests,
              COUNT(DISTINCT session_id) AS sessions,
              COUNT(DISTINCT username) AS activeUsers,
              COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
              COALESCE(SUM(completion_tokens), 0) AS completionTokens
       FROM ai_operation_log WHERE kind = 'llm' ${tw.sql}`,
      tw.params,
    );
    const approvals = await ex.query<RowDataPacket>(
      `SELECT approval_status AS s, COUNT(*) AS c
       FROM ai_operation_log WHERE kind = 'approval' ${tw.sql} GROUP BY approval_status`,
      tw.params,
    );
    const toolAgg = await ex.query<RowDataPacket>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(outcome = 'error'), 0) AS errors
       FROM ai_operation_log WHERE kind = 'tool' ${tw.sql}`,
      tw.params,
    );
    const durations = await ex.query<RowDataPacket>(
      `SELECT duration_ms AS d FROM ai_operation_log
       WHERE duration_ms IS NOT NULL ${tw.sql} ORDER BY duration_ms`,
      tw.params,
    );

    const approved = Number(approvals.find((r) => r.s === "approved")?.c ?? 0);
    const approvalTotal = approvals.reduce((acc, r) => acc + Number(r.c), 0);
    const ds = durations.map((r) => Number(r.d));
    const p95Index = ds.length ? Math.min(ds.length - 1, Math.ceil(ds.length * 0.95) - 1) : 0;

    res.json({
      code: 200,
      msg: "success",
      data: {
        requests: Number(llm[0]?.requests ?? 0),
        sessions: Number(llm[0]?.sessions ?? 0),
        activeUsers: Number(llm[0]?.activeUsers ?? 0),
        promptTokens: Number(llm[0]?.promptTokens ?? 0),
        completionTokens: Number(llm[0]?.completionTokens ?? 0),
        approvalRate: approvalTotal ? approved / approvalTotal : null,
        errorRate: Number(toolAgg[0]?.total ?? 0)
          ? Number(toolAgg[0]?.errors ?? 0) / Number(toolAgg[0]?.total)
          : null,
        avgDurationMs: ds.length
          ? ds.reduce((a, b) => a + b, 0) / ds.length
          : null,
        p95DurationMs: ds.length ? ds[p95Index] : null,
      },
    });
  });

  router.get("/stats/tools", requirePermission(PERMS.statsList), async (req, res) => {
    const ex = mysql?.executor();
    if (!ex) {
      res.status(503).json({ code: 503, msg: "mysql unavailable (degraded)" });
      return;
    }
    const q = statsQuerySchema.extend({
      topN: z.coerce.number().int().min(1).max(100).default(10),
    }).parse(req.query);
    const tw = timeWhere(q);

    const rows = await ex.query<RowDataPacket>(
      `SELECT tool_name AS toolName,
              COUNT(*) AS calls,
              SUM(outcome = 'success') / COUNT(*) AS successRate,
              AVG(duration_ms) AS avgDurationMs
       FROM ai_operation_log WHERE kind = 'tool' ${tw.sql}
       GROUP BY tool_name ORDER BY calls DESC LIMIT ?`,
      [...tw.params, q.topN],
    );
    res.json({ code: 200, msg: "success", data: rows });
  });

  return router;
}
