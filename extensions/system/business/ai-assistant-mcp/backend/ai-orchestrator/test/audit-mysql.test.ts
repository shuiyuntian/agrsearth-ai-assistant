/**
 * 文件作用：audit-mysql.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { MySQLAuditSink, setAuditSink, auditLog, auditLlm, ConsoleAuditSink } from "../src/audit/logger.js";
import { staticUpManager } from "../src/store/mysql.js";
import type { SqlExecutor } from "../src/store/mysql.js";

function stubMysql(executeImpl?: () => Promise<ResultSetHeader>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const exec: SqlExecutor = {
    query: vi.fn(async () => []) as never,
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return (executeImpl ? await executeImpl() : ({ affectedRows: 1 } as ResultSetHeader));
    }) as never,
    close: async () => {},
  };
  return { exec, calls };
}

describe("MySQLAuditSink 审计落库", () => {
  it("tool 行字段完整映射（13 列）", async () => {
    const { exec, calls } = stubMysql();
    setAuditSink(new MySQLAuditSink(staticUpManager(exec)));

    auditLog({
      user: "alice",
      sessionId: "s-1",
      tool: "entity_remove",
      riskLevel: "destructive",
      argsSummary: '{"entityId":"e-1"}',
      outcome: "success",
      durationMs: 12,
      ip: "127.0.0.1",
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const { sql, params } = calls[0]!;
    expect(sql).toContain("INSERT INTO ai_operation_log");
    expect(params).toEqual([
      "tool", "alice", "s-1", "entity_remove", "destructive",
      '{"entityId":"e-1"}', "success", null, 12, null, null, null, "127.0.0.1",
    ]);
    setAuditSink(new ConsoleAuditSink());
  });

  it("approval_* outcome 落 kind=approval 行（approval_status 归一）", async () => {
    const { exec, calls } = stubMysql();
    setAuditSink(new MySQLAuditSink(staticUpManager(exec)));

    auditLog({
      user: "alice", sessionId: "s-1", tool: "entity_remove",
      riskLevel: "destructive", argsSummary: "{}",
      outcome: "approval_denied", durationMs: 5000,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.params[0]).toBe("approval");
    expect(calls[0]!.params[7]).toBe("denied");
    setAuditSink(new ConsoleAuditSink());
  });

  it("llm 行带 model/tokens", async () => {
    const { exec, calls } = stubMysql();
    setAuditSink(new MySQLAuditSink(staticUpManager(exec)));

    auditLlm({
      user: "alice", sessionId: "s-1", model: "m-1",
      promptTokens: 120, completionTokens: 45, durationMs: 800,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.params[0]).toBe("llm");
    expect(calls[0]!.params[9]).toBe("m-1");
    expect(calls[0]!.params[10]).toBe(120);
    expect(calls[0]!.params[11]).toBe(45);
    setAuditSink(new ConsoleAuditSink());
  });

  it("写入失败不阻塞主流程（warn + console 回显）", async () => {
    const { exec } = stubMysql();
    (exec.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db gone"));
    const warn = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setAuditSink(new MySQLAuditSink(staticUpManager(exec), { warn }));

    expect(() =>
      auditLlm({ user: "a", sessionId: "s", model: "m", promptTokens: 1 }),
    ).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("[audit]"))).toBe(true),
    );
    logSpy.mockRestore();
    setAuditSink(new ConsoleAuditSink());
  });
});

// 类型引用占位（避免 unused import 告警）
export type { RowDataPacket };
