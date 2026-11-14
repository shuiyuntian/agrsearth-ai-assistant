/**
 * 文件作用：secure-tools.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionOptions, UIMessageStreamWriter } from "ai";
import { wrapToolsForSession, type SecureToolDeps } from "../src/chat/secure-tools.js";
import { ApprovalManager } from "../src/security/approval.js";
import { ArgsValidator } from "../src/security/validator.js";
import type { ContractTool } from "../src/contracts/registry.js";

function makeContract(overrides: Partial<ContractTool>): ContractTool {
  return {
    name: "entity_remove",
    domain: "entity",
    side: "browser",
    riskLevel: "destructive",
    description: "Remove entities",
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string" } },
      required: ["entityId"],
    },
    ...overrides,
  };
}

function makeDeps(
  contract: ContractTool,
  opts?: { approvalTimeoutMs?: number },
) {
  const approvals = new ApprovalManager(opts?.approvalTimeoutMs ?? 120_000, {
    info: () => {},
    warn: () => {},
  });
  const writer = { write: vi.fn(), merge: vi.fn() };
  const registerCalls: string[] = [];
  const deps: SecureToolDeps = {
    sessionId: "s1",
    username: "tester",
    registry: new Map([[contract.name, contract]]),
    commandRouter: {
      registerCall: vi.fn(async (_s: string, tool: string) => {
        registerCalls.push(tool);
        return () => {};
      }),
    } as never,
    approvals,
    validator: new ArgsValidator(),
    isApprovalRequired: () => true,
    getWriter: () => writer as unknown as UIMessageStreamWriter,
  };
  return { deps, approvals, writer, registerCalls };
}

const OPTS = { toolCallId: "call-1", messages: [] } as unknown as ToolExecutionOptions<unknown>;

function wrappedExecute(contract: ContractTool, mcpResult: unknown = { ok: true }) {
  const ctx = makeDeps(contract);
  const mcpExecute = vi.fn().mockResolvedValue(mcpResult);
  const wrapped = wrapToolsForSession(
    { [contract.name]: { description: contract.description, execute: mcpExecute } } as never,
    ctx.deps,
  );
  const tool = wrapped[contract.name] as unknown as {
    execute: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>;
  };
  return { ...ctx, mcpExecute, execute: tool.execute };
}

describe("ajv 参数校验（不合规回喂，不走 MCP）", () => {
  it("缺 required 字段 → isError 结果回喂，MCP execute 未被调用", async () => {
    const { execute, mcpExecute } = wrappedExecute(makeContract({}));
    const result = (await execute({}, OPTS)) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("参数校验未通过");
    expect(result.content[0]?.text).toContain("entityId");
    expect(mcpExecute).not.toHaveBeenCalled();
  });

  it("类型不符 → 回喂；合规参数 → 正常走 MCP", async () => {
    const { execute, mcpExecute } = wrappedExecute(
      makeContract({ riskLevel: "read" }),
    );
    const bad = (await execute({ entityId: 123 }, OPTS)) as { isError: boolean };
    expect(bad.isError).toBe(true);
    expect(mcpExecute).not.toHaveBeenCalled();

    const good = await execute({ entityId: "e-1" }, OPTS);
    expect(good).toEqual({ ok: true });
    expect(mcpExecute).toHaveBeenCalledTimes(1);
  });
});

describe("destructive 审批闸（三态）", () => {
  beforeEach(() => vi.useRealTimers());

  it("approved → 写 data-tool-approval 后执行 MCP", async () => {
    const { execute, mcpExecute, approvals, writer, registerCalls } =
      wrappedExecute(makeContract({}));

    const pending = execute({ entityId: "e-1" }, OPTS);
    // 等 execute 挂起到审批点
    await vi.waitFor(() => expect(approvals.pendingCount).toBe(1));

    expect(writer.write).toHaveBeenCalledWith({
      type: "data-tool-approval",
      id: "call-1",
      data: expect.objectContaining({
        callId: "call-1",
        tool: "entity_remove",
        riskLevel: "destructive",
      }),
    });

    expect(approvals.decide("call-1", true, "boss")).toBe(true);
    const result = await pending;
    expect(result).toEqual({ ok: true });
    expect(mcpExecute).toHaveBeenCalledTimes(1);
    expect(registerCalls).toEqual(["entity_remove"]);
  });

  it("rejected → denied 回喂，MCP 未执行", async () => {
    const { execute, mcpExecute, approvals } = wrappedExecute(makeContract({}));
    const pending = execute({ entityId: "e-1" }, OPTS);
    await vi.waitFor(() => expect(approvals.pendingCount).toBe(1));

    approvals.decide("call-1", false, "boss");
    const result = (await pending) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("拒绝");
    expect(mcpExecute).not.toHaveBeenCalled();
  });

  it("timeout → 超时拒绝回喂（fail-closed），MCP 未执行", async () => {
    vi.useFakeTimers();
    try {
      const contract = makeContract({});
      const ctx = makeDeps(contract, { approvalTimeoutMs: 5_000 });
      const mcpExecute = vi.fn().mockResolvedValue({ ok: true });
      const wrapped = wrapToolsForSession(
        { [contract.name]: { description: contract.description, execute: mcpExecute } } as never,
        ctx.deps,
      );
      const tool = wrapped[contract.name] as unknown as {
        execute: (i: unknown, o: ToolExecutionOptions<unknown>) => Promise<unknown>;
      };

      const pending = tool.execute({ entityId: "e-1" }, OPTS);
      await vi.waitFor(() => expect(ctx.approvals.pendingCount).toBe(1));
      await vi.advanceTimersByTimeAsync(5_000);

      const result = (await pending) as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("超时");
      expect(mcpExecute).not.toHaveBeenCalled();
      expect(ctx.approvals.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("read/write 不触发审批（write 仅审计）", async () => {
    const { execute, mcpExecute, approvals, writer } = wrappedExecute(
      makeContract({ riskLevel: "write", name: "entity_add_point" }),
    );
    const result = await execute({ entityId: "e-1" }, OPTS);
    expect(result).toEqual({ ok: true });
    expect(mcpExecute).toHaveBeenCalledTimes(1);
    expect(writer.write).not.toHaveBeenCalled();
    expect(approvals.pendingCount).toBe(0);
  });
});
