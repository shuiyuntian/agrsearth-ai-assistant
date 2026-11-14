/**
 * 文件作用：logger 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { MySQLManager } from "../store/mysql.js";

/**
 * 审计/用量落库（P2-A）：MySQL `ai_operation_log`。
 *
 * 异步写入、失败不阻塞主流程（catch 后 warn + 回显 console）。
 * 无 MySQL 时 sink 为 ConsoleSink（P1-A 行为）。
 *
 * kind 三类：
 *  - tool     工具调用（success/error/validation_failed）
 *  - approval 审批事件（approval_status: approved/denied/timeout）
 *  - llm      LLM 完成（model/prompt_tokens/completion_tokens，取自 streamText onFinish usage）
 */
export interface AuditRow {
  kind: "tool" | "llm" | "approval";
  username?: string;
  sessionId?: string;
  toolName?: string;
  riskLevel?: string;
  argsSummary?: string;
  outcome?: string;
  approvalStatus?: "approved" | "denied" | "timeout";
  durationMs?: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  ip?: string;
}

export interface AuditSink {
  write(row: AuditRow): void;
}

export class ConsoleAuditSink implements AuditSink {
  write(row: AuditRow): void {
    console.log(`[audit] ${JSON.stringify({ ts: new Date().toISOString(), ...row })}`);
  }
}

const INSERT_SQL =
  "INSERT INTO ai_operation_log " +
  "(kind, username, session_id, tool_name, risk_level, args_summary, outcome, approval_status, " +
  "duration_ms, model, prompt_tokens, completion_tokens, ip) " +
  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)";

export class MySQLAuditSink implements AuditSink {
  private readonly fallback = new ConsoleAuditSink();

  constructor(
    private readonly mysql: MySQLManager,
    private readonly logger: Pick<typeof console, "warn"> = console,
  ) {}

  write(row: AuditRow): void {
    // 每次写入按当前状态选路：down 直接走 console，up 写库（失败不阻塞 + 触发重探）
    const ex = this.mysql.executor();
    if (!ex) {
      this.fallback.write(row);
      return;
    }
    void ex
      .execute(INSERT_SQL, [
        row.kind,
        row.username ?? null,
        row.sessionId ?? null,
        row.toolName ?? null,
        row.riskLevel ?? null,
        row.argsSummary ?? null,
        row.outcome ?? null,
        row.approvalStatus ?? null,
        row.durationMs ?? null,
        row.model ?? null,
        row.promptTokens ?? null,
        row.completionTokens ?? null,
        row.ip ?? null,
      ])
      .catch((err) => {
        this.logger.warn(
          `[audit] mysql write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.mysql.noteFailure();
        this.fallback.write(row);
      });
  }
}

// ---------------------------------------------------------------------------
// 模块级 sink（startup 时 setAuditSink 切换；默认 console）
// ---------------------------------------------------------------------------

let sink: AuditSink = new ConsoleAuditSink();

export function setAuditSink(next: AuditSink): void {
  sink = next;
}

export function getAuditSink(): AuditSink {
  return sink;
}

// ---------------------------------------------------------------------------
// 兼容层：保留 P1-A 的调用形态
// ---------------------------------------------------------------------------

export interface ToolAuditEntry {
  user: string;
  sessionId: string;
  tool: string;
  riskLevel: string;
  argsSummary: string;
  outcome:
    | "success"
    | "error"
    | "validation_failed"
    | "approval_approved"
    | "approval_denied"
    | "approval_timeout";
  durationMs?: number;
  detail?: string;
  ip?: string;
}

export function summarizeArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {}).slice(0, 200);
  } catch {
    return "[unserializable]";
  }
}

/** 工具调用审计（kind=tool；approval_* outcome 同时落 kind=approval 行） */
export function auditLog(entry: ToolAuditEntry): void {
  if (entry.outcome.startsWith("approval_")) {
    const status = entry.outcome.slice("approval_".length) as
      | "approved"
      | "denied"
      | "timeout";
    sink.write({
      kind: "approval",
      username: entry.user,
      sessionId: entry.sessionId,
      toolName: entry.tool,
      riskLevel: entry.riskLevel,
      argsSummary: entry.argsSummary,
      outcome: entry.outcome,
      approvalStatus: status,
      durationMs: entry.durationMs,
      ip: entry.ip,
    });
    return;
  }
  sink.write({
    kind: "tool",
    username: entry.user,
    sessionId: entry.sessionId,
    toolName: entry.tool,
    riskLevel: entry.riskLevel,
    argsSummary: entry.argsSummary,
    outcome: entry.outcome,
    durationMs: entry.durationMs,
    ip: entry.ip,
  });
}

/** LLM 完成审计（kind=llm，tokens 取自 usage） */
export function auditLlm(entry: {
  user: string;
  sessionId: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  outcome?: string;
  ip?: string;
}): void {
  sink.write({
    kind: "llm",
    username: entry.user,
    sessionId: entry.sessionId,
    model: entry.model,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    durationMs: entry.durationMs,
    outcome: entry.outcome ?? "success",
    ip: entry.ip,
  });
}
