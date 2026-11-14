/**
 * 文件作用：approval 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * destructive 工具审批管理器（P1-A）。
 *
 * chat 层遇到 destructive 工具时 request() 挂起执行（Promise 等回执），
 * POST /chat/approval 到达后 decide() 放行/拒绝；超时=拒绝（fail-closed）。
 */
export interface ApprovalDecision {
  approved: boolean;
  reason: "approved" | "rejected" | "timeout";
  by?: string;
}

interface PendingApproval {
  sessionId: string;
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly timeoutMs: number = 120_000,
    private readonly logger: Pick<typeof console, "info" | "warn"> = console,
  ) {}

  /** 挂起等待审批回执；超时自动拒绝（fail-closed） */
  request(sessionId: string, callId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(callId)) {
          this.logger.warn(
            `[approval] ${callId} timed out after ${this.timeoutMs}ms -> rejected (fail-closed)`,
          );
          resolve({ approved: false, reason: "timeout" });
        }
      }, this.timeoutMs);
      timer.unref?.();

      this.pending.set(callId, {
        sessionId,
        timer,
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        },
      });
      this.logger.info(`[approval] pending ${callId} (session=${sessionId})`);
    });
  }

  /** 回执；无对应挂起返回 false */
  decide(callId: string, approved: boolean, by?: string): boolean {
    const entry = this.pending.get(callId);
    if (!entry) return false;
    this.pending.delete(callId);
    entry.resolve({ approved, reason: approved ? "approved" : "rejected", by });
    this.logger.info(
      `[approval] ${callId} ${approved ? "approved" : "rejected"}${by ? ` by ${by}` : ""}`,
    );
    return true;
  }

  /** 查询挂起归属的 sessionId（端点归属校验用） */
  getSessionId(callId: string): string | undefined {
    return this.pending.get(callId)?.sessionId;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
