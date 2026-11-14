/**
 * 文件作用：secure-tools 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { ToolExecutionOptions, ToolSet, UIMessageStreamWriter } from "ai";
import type { ContractTool, ToolRegistry } from "../contracts/registry.js";
import type { CommandRouter } from "../channel/command-router.js";
import type { ApprovalManager } from "../security/approval.js";
import type { ArgsValidator } from "../security/validator.js";
import { auditLog, summarizeArgs } from "../audit/logger.js";
import {
  cameraHeightFieldMissing,
  destinationGuard,
  extractExtentResult,
  extractGeocodeRecord,
  extractSearchTypes,
  fillInferredCameraHeight,
  fillTopDownOrientation,
  GeocodeHistory,
  isCameraHeightTool,
  type ExtentInfo,
  type GeocodeRecord,
  type HeightInference,
} from "./height-inference.js";

/**
 * 安全包装（P1-A 核心）：把 registry 过滤后的 MCP 工具集包一层安全闸。
 *
 * 每个工具的 execute 链：
 *  1. ajv 按契约 inputSchema 校验模型参数 —— 不合规直接回 tool error（不走 MCP）回喂模型修正；
 *  1.5 （S2-B）camera_fly_to/camera_set_view/camera_look_at_transform 缺 height 时，
 *     依据本会话最近一次 geolocation_geocode 结果推算填入并复检（模型显式给 height 不覆盖）；
 *  2. 危险分级：read 放行；write 放行+审计；destructive → 审批挂起
 *     （向 UI 流写 data-tool-approval data part，等 POST /chat/approval 回执，超时=拒绝 fail-closed）；
 *  3. side=browser 的工具调用前后经 command-router 登记/释放（命令通道定向路由）；
 *  4. 全链路审计（console 结构化 JSON 占位，P2 落 MySQL）；
 *  5. geolocation_geocode 成功结果记录进会话级历史（供 1.5 推算）。
 */

export interface ApprovalRequestData {
  callId: string;
  tool: string;
  args: unknown;
  reason: string;
  riskLevel: string;
}

export interface SecureToolDeps {
  sessionId: string;
  username: string;
  ip?: string;
  registry: ToolRegistry;
  commandRouter: CommandRouter;
  approvals: ApprovalManager;
  validator: ArgsValidator;
  /** 审批策略：destructive 且在该清单内才挂审批（运行时配置 approvalPolicy） */
  isApprovalRequired: (toolName: string) => boolean;
  /**
   * codegen 管线（riskLevel=codegen 的工具才需要；未配置时该工具 fail-closed）。
   * 输入工具调用参数（{intent, description?}），返回生成且通过 AST 校验的代码。
   */
  runCodegen?: (input: unknown) => Promise<{
    code: string;
    verified: boolean;
    attempts: number;
  }>;
  /** 取当前请求的 UI 流 writer（审批 data part 用）；非流式场景可为 undefined */
  getWriter: () => UIMessageStreamWriter | undefined;
  /**
   * 会话级 geocode 历史（S2-B 高度推算用）。缺省用进程内共享实例
   * （跨请求保留会话记录）；生产由 index.ts 显式注入。
   */
  geocodeHistory?: GeocodeHistory;
  /**
   * geo MCP 工具内部调用（v2：geocode 成功后异步预取 + camera_* 推算内联补齐
   * geolocation_extent）。
   * 由 index.ts 以 mcp.tools 委托实现（复用现有连接与断线重建重试，不新建 MCP 连接；
   * 红线：orchestrator 不直连 Overpass/Nominatim 原始 HTTP API）。未注入时跳过预取。
   */
  callGeoTool?: (name: string, input: unknown) => Promise<unknown>;
}

type AnyExecute = (
  input: unknown,
  options: ToolExecutionOptions<unknown>,
) => Promise<unknown>;

/** 回喂模型的 tool error 结果（MCP CallToolResult 形态，模型可读后自行修正） */
export function toolErrorResult(text: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text }], isError: true };
}

/** deps 未注入 geocodeHistory 时的进程内共享实例（跨请求保留会话记录） */
const sharedGeocodeHistory = new GeocodeHistory();

/**
 * extent 在途查询去重表：key = sessionId|lat,lon（4 位小数≈11m 粒度）。
 * 同一地点的 prefetch 与内联补齐/并发 camera_* 共享同一次 Overpass 查询，
 * 防并行 fly_to 打爆 Overpass。
 */
const extentInflight = new Map<string, Promise<ExtentInfo | null>>();

/** 内联补齐的超时上界（ms）：桥索引化查询正常 <1s，8s 足以覆盖抖动 */
export const EXTENT_INLINE_TIMEOUT_MS = 8_000;

function extentFetchKey(
  sessionId: string,
  location: { latitude: number; longitude: number },
): string {
  return `${sessionId}|${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
}

/** extent 名称候选：geocode 查询串优先，displayName 首段兜底 */
function extentNameCandidates(rec: Omit<GeocodeRecord, "at">): string[] {
  const candidates: string[] = [];
  if (rec.query) candidates.push(rec.query);
  const firstSegment = rec.displayName?.split(",")[0]?.trim();
  if (firstSegment && !candidates.includes(firstSegment)) candidates.push(firstSegment);
  return candidates;
}

/**
 * 实际发起 extent 查询（名称候选逐个试，命中即返）：经 deps.callGeoTool
 * （geo MCP client 委托）调 geolocation_extent；桥/工具不可用或候选均未命中返回 null。
 * 桥侧已有名称阶梯（索引 union + POI 后缀剥离），失配兜底在桥内完成。
 */
async function fetchExtentForRecord(
  deps: Pick<SecureToolDeps, "callGeoTool">,
  rec: Omit<GeocodeRecord, "at">,
): Promise<ExtentInfo | null> {
  const call = deps.callGeoTool;
  if (!call) return null;
  const candidates = extentNameCandidates(rec);
  if (candidates.length === 0) return null;
  const at = {
    latitude: rec.location.latitude,
    longitude: rec.location.longitude,
  };
  for (const name of candidates) {
    let output: unknown;
    try {
      output = await call("geolocation_extent", { name, at });
    } catch (err) {
      // 桥/工具不可用：不重试其余候选名，静默放弃（下次 geocode 再试）
      console.warn(
        `[height-inference] extent 调用失败（${name}）：` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    const extent = extractExtentResult(output);
    if (extent) return extent;
  }
  return null;
}

/**
 * 去重后的 extent 查询：同地点在途查询复用同一 promise；
 * 命中即回填会话历史（updateExtent 有防串位校验），全程 info 日志可观测。
 */
function fetchExtentDeduped(
  deps: Pick<SecureToolDeps, "callGeoTool" | "sessionId">,
  history: GeocodeHistory,
  rec: Omit<GeocodeRecord, "at">,
): Promise<ExtentInfo | null> {
  const key = extentFetchKey(deps.sessionId, rec.location);
  const existing = extentInflight.get(key);
  if (existing) return existing;
  const label = rec.query ?? rec.displayName ?? "?";
  const promise = (async () => {
    const t0 = Date.now();
    const extent = await fetchExtentForRecord(deps, rec);
    if (extent) {
      history.updateExtent(deps.sessionId, extent, rec.location);
      console.info(
        `[height-inference] extent 命中回填（${label}）：对角线 ` +
          `${Math.round(extent.diagonalMeters)}m（${Date.now() - t0}ms）`,
      );
    } else {
      console.info(
        `[height-inference] extent 未命中（${label}，${Date.now() - t0}ms），推算回落后续级别`,
      );
    }
    return extent;
  })().finally(() => {
    extentInflight.delete(key);
  });
  extentInflight.set(key, promise);
  return promise;
}

/**
 * geocode 成功后异步预取 extent（v2，fire-and-forget 不阻塞主链）：
 * 命中即回填会话历史——后续同名地点的 camera_* 推算直接命中第 1 级（2.7×对角线）。
 * 桥/工具不可用或未命中时静默放弃，推算链自然回落类型表/bbox/缺省。
 */
export function prefetchExtent(
  deps: Pick<SecureToolDeps, "callGeoTool" | "sessionId">,
  history: GeocodeHistory,
  rec: Omit<GeocodeRecord, "at">,
): void {
  if (!deps.callGeoTool) return;
  void fetchExtentDeduped(deps, history, rec).catch(() => undefined);
}

/**
 * rescue 内联补齐（首查竞态修复）：camera_* 缺 height 而历史记录尚无 extent 时，
 * 同步有界等待一次 extent 查询（正常 <1s，上界 8s），首查也能命中推算链第 1 级。
 * 超时/未命中不阻塞主链——推算链回落类型表/bbox/缺省；
 * 超时后在途查询继续跑完并回填（后续调用受益）。
 */
async function ensureExtentInline(
  deps: Pick<SecureToolDeps, "callGeoTool" | "sessionId">,
  history: GeocodeHistory,
  rec: Omit<GeocodeRecord, "at">,
): Promise<void> {
  const TIMEOUT = Symbol("extent-inline-timeout");
  const timeout = new Promise<typeof TIMEOUT>((resolve) =>
    setTimeout(() => resolve(TIMEOUT), EXTENT_INLINE_TIMEOUT_MS),
  );
  const result = await Promise.race([fetchExtentDeduped(deps, history, rec), timeout]);
  if (result === TIMEOUT) {
    console.warn(
      `[height-inference] extent 内联补齐超时（>${EXTENT_INLINE_TIMEOUT_MS}ms），推算回落后续级别`,
    );
  }
}

export function wrapToolsForSession(
  tools: ToolSet,
  deps: SecureToolDeps,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const contract = deps.registry.get(name);
    const originalExecute = tool.execute;
    if (!contract || typeof originalExecute !== "function") {
      // 不在 registry（白名单外）的工具不暴露；无 execute 的工具原样透传
      if (contract) wrapped[name] = tool;
      continue;
    }
    const callOriginal = originalExecute as unknown as AnyExecute;
    wrapped[name] = {
      ...tool,
      execute: (input: unknown, options: ToolExecutionOptions<unknown>) =>
        runSecured(name, contract, callOriginal, input, options, deps),
    } as ToolSet[string];
  }
  return wrapped;
}

async function runSecured(
  name: string,
  contract: ContractTool,
  callOriginal: AnyExecute,
  input: unknown,
  options: ToolExecutionOptions<unknown>,
  deps: SecureToolDeps,
): Promise<unknown> {
  const t0 = Date.now();
  const callId = options.toolCallId;
  const base = {
    user: deps.username,
    sessionId: deps.sessionId,
    tool: name,
    riskLevel: contract.riskLevel,
    argsSummary: summarizeArgs(input),
    ip: deps.ip,
  };

  // 1. ajv 参数校验：不合规 → 不走 MCP，回喂模型修正
  let effectiveInput = input;
  let validation = deps.validator.validate(contract, effectiveInput);
  let heightInferred: HeightInference | undefined;
  let topDownFilled = false;

  // 1.5 高度智能推算（S2-B）：camera_* destination/target 缺 height 时，
  //     依据本会话最近一次 geocode 结果推算填入，复检通过才采用
  //     （模型显式给 height 时 fillInferredCameraHeight 返回 null，原样放行）。
  //     v2 首查竞态修复：历史记录缺 extent 时先内联有界 await 一次 extent
  //     补齐（正常 <1s；并发同地点去重），再推算——首查不再落缺省 10km。
  if (isCameraHeightTool(name)) {
    const history = deps.geocodeHistory ?? sharedGeocodeHistory;
    if (deps.callGeoTool && cameraHeightFieldMissing(name, effectiveInput)) {
      const rec = history.latest(deps.sessionId);
      // R2 守卫：记录与本次目的地错位（并行调用串位）时不为它补 extent——
      // 既省一次 Overpass 查询，也避免错源回填后干扰后续推算
      if (rec && !rec.extent && destinationGuard(rec, name, effectiveInput).usable) {
        await ensureExtentInline(deps, history, rec);
      }
    }
    const filled = fillInferredCameraHeight(
      history,
      deps.sessionId,
      name,
      effectiveInput,
    );
    if (filled) {
      const revalidation = deps.validator.validate(contract, filled.input);
      if (revalidation.ok) {
        validation = revalidation;
        effectiveInput = filled.input;
        heightInferred = filled.inferred;
        // R3：推算决策 console 可见（audit sink 之外的 kubectl 全链路观测，
        // 与 extent 回填行配套——坑 10：推算链路必须带日志）
        console.info(
          `[height-inference] 推算填入（${name}）：${filled.inferred.height}m` +
            `（${filled.inferred.reason}）`,
        );
      }
    }
    // 1.6 视角缺省（S3）：camera_fly_to/camera_set_view 缺 orientation 时填正北垂直俯视
    //     （vendor 缺省为 pitch -15° 斜视；模型显式给 orientation 时返回 null，原样放行）
    const topDown = fillTopDownOrientation(name, effectiveInput);
    if (topDown) {
      const revalidation = deps.validator.validate(contract, topDown.input);
      if (revalidation.ok) {
        validation = revalidation;
        effectiveInput = topDown.input;
        topDownFilled = true;
      }
    }
  }

  if (!validation.ok) {
    auditLog({ ...base, outcome: "validation_failed", detail: validation.errors });
    return toolErrorResult(
      `参数校验未通过（${name}）：${validation.errors}。请按 schema 修正参数后重新调用。`,
    );
  }

  // 2. 危险分级闸
  //    destructive：在审批策略清单内才挂审批；codegen：强制审批（P3-A）
  const isCodegen = contract.riskLevel === "codegen";
  const needsApproval =
    isCodegen || (contract.riskLevel === "destructive" && deps.isApprovalRequired(name));
  if (needsApproval) {
    // codegen：先跑管线（grounding 生成 → AST 校验），产出代码后再挂审批，
    // 审批 args 携带 {intent, code} 供前端审批卡展示完整代码
    let approvalArgs: unknown = effectiveInput;
    let codegenResult:
      | { code: string; verified: boolean; attempts: number }
      | undefined;
    if (isCodegen) {
      if (!deps.runCodegen) {
        auditLog({
          ...base,
          outcome: "error",
          detail: "codegen pipeline not configured",
        });
        return toolErrorResult("codegen 管线未配置（检查 codegenEnabled 与 CODEGEN_* 设置）。");
      }
      try {
        codegenResult = await deps.runCodegen(input);
      } catch (err) {
        auditLog({
          ...base,
          outcome: "error",
          durationMs: Date.now() - t0,
          detail: err instanceof Error ? err.message : String(err),
        });
        return toolErrorResult(
          `代码生成失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      approvalArgs = {
        ...(typeof input === "object" && input !== null
          ? (input as Record<string, unknown>)
          : {}),
        code: codegenResult.code,
      };
    }

    const approvalData: ApprovalRequestData = {
      callId,
      tool: name,
      args: approvalArgs,
      reason: isCodegen
        ? `codegen 操作：${contract.description}`
        : `destructive 操作：${contract.description}`,
      riskLevel: contract.riskLevel,
    };
    // 向 UI 流写自定义 data part（前端轨按同一约定渲染审批卡）
    deps.getWriter()?.write({
      type: "data-tool-approval",
      id: callId,
      data: approvalData,
    });

    const decision = await deps.approvals.request(deps.sessionId, callId);
    if (!decision.approved) {
      const outcome =
        decision.reason === "timeout" ? "approval_timeout" : "approval_denied";
      auditLog({ ...base, outcome, durationMs: Date.now() - t0 });
      return toolErrorResult(
        decision.reason === "timeout"
          ? `审批超时（等待用户确认超时），操作 ${name} 已取消。`
          : `用户拒绝了操作 ${name}（denied）。该操作未执行；用户已明确拒绝，禁止重试同一或等效操作，直接向用户说明结果并致歉。`,
      );
    }
    auditLog({
      ...base,
      outcome: "approval_approved",
      detail: decision.by ? `by ${decision.by}` : undefined,
    });

    // codegen：批准后直接返回代码（真正执行在前端主页面，orchestrator 不执行）
    if (isCodegen) {
      auditLog({ ...base, outcome: "success", durationMs: Date.now() - t0 });
      return {
        ...codegenResult!,
        approvedForExecution: true,
      };
    }
  }

  // 3. browser 工具：命令通道登记（per-tool 锁串行 + 定向路由）
  const release =
    contract.side === "browser"
      ? await deps.commandRouter.registerCall(deps.sessionId, name)
      : undefined;

  try {
    const output = await callOriginal(effectiveInput, options);
    // 5. geocode 成功结果记录（S2-B：供后续 camera_* 高度推算）+ v2 异步预取 extent
    if (name === "geolocation_geocode") {
      const rec = extractGeocodeRecord(effectiveInput, output);
      if (rec) {
        const history = deps.geocodeHistory ?? sharedGeocodeHistory;
        history.record(deps.sessionId, rec);
        prefetchExtent(deps, history, rec);
      }
    } else if (name === "geolocation_search") {
      // v2 推算链第 2 级线索：search 结果 types 合并入会话历史（无记录则忽略）
      const types = extractSearchTypes(output);
      if (types?.length) {
        (deps.geocodeHistory ?? sharedGeocodeHistory).mergeTypes(deps.sessionId, types);
      }
    }
    auditLog({
      ...base,
      outcome: "success",
      durationMs: Date.now() - t0,
      detail: [
        heightInferred
          ? `height 推算填入: ${heightInferred.height}m（${heightInferred.reason}）`
          : undefined,
        topDownFilled ? "orientation 缺省填入: 正北垂直俯视（pitch -90）" : undefined,
      ]
        .filter(Boolean)
        .join("；") || undefined,
    });
    return output;
  } catch (err) {
    auditLog({
      ...base,
      outcome: "error",
      durationMs: Date.now() - t0,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    release?.();
  }
}
