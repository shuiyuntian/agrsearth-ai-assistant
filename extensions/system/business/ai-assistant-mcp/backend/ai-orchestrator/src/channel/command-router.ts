/**
 * 文件作用：command-router 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { Router, type Request, type Response } from "express";
import type { ToolSet } from "ai";

/**
 * command-router —— P0 最关键模块。
 *
 * 背景：MCP gateway 的命令通道（SSE GET /mcp/events）是**单连接**，
 * gateway 把 browser 工具的调用广播成 `{"type":"command","command":{id,type,...}}`，
 * 浏览器执行后 POST /mcp/result {id,result} 按 id resolve。
 *
 * 本模块：
 *  1. 启动时订阅 MCP_SSE_URL，占住 gateway 唯一 SSE 槽位；
 *  2. 对浏览器提供 GET /channel/events?sessionId=X（多连接，按 sessionId 分桶）；
 *  3. chat 层在 browser 工具调用前 registerCall(sessionId, toolName) 登记；
 *     截获广播命令时按 command.type 匹配在途登记（toolName 先经 resolveCommandType
 *     归一：entity_add_* 12 个工具与 globe_set_lighting 的 MCP 命令类型与工具名不同名），
 *     仅推给该 session；无匹配登记则丢弃并 warn。同命令类型并发经 per-type 锁串行；
 *  4. 浏览器 POST /channel/result {id,result} → 转发 MCP_RESULT_URL；
 *  5. 浏览器超时未回（对齐 MCP 侧 commandTimeoutMs）→ 自动释放锁（MCP 侧会自行超时拒绝）。
 *
 * P1 预留：鉴权（连接级 token）、审批（命令推送前挂审批钩子，见 handleCommand 标注）、
 * 会话粘性路由（多 gateway 实例时按 sessionId 分片）。
 */

/** gateway 广播的命令（工具参数平铺；type 为 MCP 命令类型，与工具名未必同名，见 resolveCommandType） */
export interface BrowserCommand {
  id: string;
  type: string;
  [key: string]: unknown;
}

/**
 * 工具名 → MCP 命令类型归一。
 * MCP 侧绝大多数工具 toolName === command.type，例外两族（vendor pristine 不可改）：
 *  - entity_add_*（entity_add_point/label/billboard/model/polygon/polyline/rectangle/
 *    wall/corridor/ellipse/cylinder/box 共 12 个工具）统一发 command.type = "entity_add"
 *    （见 mcp entity-server utils.executeEntityAddCommand）；
 *  - globe_set_lighting 发 command.type = "globe_lighting"。
 * 登记与锁都必须以命令类型为键，否则 entity_add_label 等命令会因查不到在途登记被丢弃。
 */
export function resolveCommandType(toolName: string): string {
  if (toolName.startsWith("entity_add_")) return "entity_add";
  if (toolName === "globe_set_lighting") return "globe_lighting";
  return toolName;
}

interface InFlightCall {
  sessionId: string;
  toolName: string;
  commandId?: string;
  dispatchTimer?: NodeJS.Timeout;
  /** 幂等释放（wrapper finally 为主路径，超时兜底也会调） */
  release?: () => void;
}

export interface CommandRouterOptions {
  mcpSseUrl: string;
  mcpResultUrl: string;
  /** 对齐 MCP 侧 DEFAULT_COMMAND_TIMEOUT_MS（10s） */
  commandTimeoutMs?: number;
  /** 浏览器 SSE 心跳间隔 */
  heartbeatMs?: number;
  /** 可注入 mock（测试用） */
  fetchImpl?: typeof fetch;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
}

type ReleaseFn = () => void;

/** browser 工具名单（硬编码 P0）：这些工具的 execute 在 MCP 侧经命令通道驱动浏览器 */
const BROWSER_TOOL_PATTERNS: RegExp[] = [
  /^camera_/,
  /^entity_/,
  /^animation_/,
  /^clock_control$/,
  /^globe_/,
  /^imagery_/,
  /^tileset_/,
  /^terrain_/,
];

export function isBrowserTool(toolName: string): boolean {
  return BROWSER_TOOL_PATTERNS.some((re) => re.test(toolName));
}

export class CommandRouter {
  private readonly opts: Required<
    Pick<CommandRouterOptions, "commandTimeoutMs" | "heartbeatMs">
  > &
    CommandRouterOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly log: Pick<typeof console, "info" | "warn" | "error">;

  /** sessionId -> 该会话的全部浏览器 SSE 连接 */
  private readonly sessions = new Map<string, Set<Response>>();
  /** commandType -> 在途登记（per-type 锁保证同命令类型全局只有一笔在途） */
  private readonly inFlight = new Map<string, InFlightCall>();
  /** toolName -> 锁链尾部 promise（串行化同命令类型工具调用） */
  private readonly lockChains = new Map<string, Promise<void>>();

  private upstreamAbort?: AbortController;

  constructor(options: CommandRouterOptions) {
    this.opts = {
      commandTimeoutMs: 10_000,
      heartbeatMs: 30_000,
      ...options,
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.logger ?? console;
  }

  // ---------------------------------------------------------------------------
  // 浏览器侧连接管理
  // ---------------------------------------------------------------------------

  addConnection(sessionId: string, res: Response): void {
    let bucket = this.sessions.get(sessionId);
    if (!bucket) {
      bucket = new Set();
      this.sessions.set(sessionId, bucket);
    }
    bucket.add(res);
  }

  removeConnection(sessionId: string, res: Response): void {
    const bucket = this.sessions.get(sessionId);
    if (!bucket) return;
    bucket.delete(res);
    if (bucket.size === 0) this.sessions.delete(sessionId);
  }

  connectionCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0;
  }

  // ---------------------------------------------------------------------------
  // 在途登记 + per-tool 锁
  // ---------------------------------------------------------------------------

  /**
   * browser 工具调用前登记。同命令类型（resolveCommandType 归一）并发时在此排队串行。
   * 返回幂等的 release 函数（wrapper finally / 超时兜底都会调）。
   */
  async registerCall(sessionId: string, toolName: string): Promise<ReleaseFn> {
    // 以命令类型为登记/锁键：entity_add_* 12 个工具共享 entity_add 命令类型，
    // 若按工具名加锁，两个不同 entity_add_* 工具并发的命令会无法区分（同 type 广播）
    const commandType = resolveCommandType(toolName);
    const prev = this.lockChains.get(commandType) ?? Promise.resolve();

    let releaseLock!: () => void;
    const acquired = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.lockChains.set(commandType, prev.then(() => acquired));

    // 等待前一笔同命令类型调用释放
    await prev;

    const entry: InFlightCall = { sessionId, toolName };
    this.inFlight.set(commandType, entry);

    let released = false;
    const release: ReleaseFn = () => {
      if (released) return;
      released = true;
      if (entry.dispatchTimer) clearTimeout(entry.dispatchTimer);
      // 仅当在途登记仍属本笔时才清除（超时兜底与正常释放可能交错）
      if (this.inFlight.get(commandType) === entry) {
        this.inFlight.delete(commandType);
      }
      releaseLock();
    };
    entry.release = release;
    return release;
  }

  // ---------------------------------------------------------------------------
  // gateway 广播命令的截获与定向分发
  // ---------------------------------------------------------------------------

  /**
   * 处理 gateway 广播命令：按 command.type 匹配在途登记，仅推给对应 session。
   * @returns 是否成功分发
   */
  handleCommand(command: BrowserCommand): boolean {
    const entry = this.inFlight.get(command.type);
    if (!entry) {
      this.log.warn(
        `[command-router] drop command ${command.id} (type=${command.type}): no in-flight registration`,
      );
      return false;
    }

    entry.commandId = command.id;

    // P1 预留：审批钩子 —— 推送浏览器前可在此挂人工/规则审批。
    const bucket = this.sessions.get(entry.sessionId);
    if (!bucket || bucket.size === 0) {
      this.log.warn(
        `[command-router] drop command ${command.id}: session ${entry.sessionId} has no connection`,
      );
      return false;
    }

    const frame = `data: ${JSON.stringify({ type: "command", command })}\n\n`;
    for (const res of bucket) {
      res.write(frame);
    }
    this.log.info(
      `[command-router] routed ${command.type} (${command.id}) -> session ${entry.sessionId} (${bucket.size} conn)`,
    );

    // 浏览器超时未回：释放锁（MCP 侧会按自身超时拒绝该 tool call，
    // wrapper 的 finally 随后到达时 release 已幂等为空操作）
    entry.dispatchTimer = setTimeout(() => {
      this.log.warn(
        `[command-router] command ${command.id} timed out after ${this.opts.commandTimeoutMs}ms, releasing lock for ${command.type}`,
      );
      entry.release?.();
    }, this.opts.commandTimeoutMs);
    // 不阻塞进程退出
    entry.dispatchTimer.unref?.();

    return true;
  }

  /**
   * 浏览器回传结果：清除超时计时器，并转发给 gateway /mcp/result。
   * 锁的释放由工具 wrapper 的 finally 完成（MCP 侧 resolve 后）。
   */
  async handleResult(id: string, result: unknown): Promise<void> {
    for (const entry of this.inFlight.values()) {
      if (entry.commandId === id && entry.dispatchTimer) {
        clearTimeout(entry.dispatchTimer);
        entry.dispatchTimer = undefined;
      }
    }

    const resp = await this.fetchImpl(this.opts.mcpResultUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, result }),
    });
    if (!resp.ok) {
      this.log.warn(
        `[command-router] forward result ${id} to MCP failed: HTTP ${resp.status}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 上行：订阅 gateway SSE（占唯一槽位）
  // ---------------------------------------------------------------------------

  /** 订阅 MCP_SSE_URL，断线自动重连。返回停止函数。 */
  connectUpstream(): () => void {
    this.upstreamAbort = new AbortController();
    const signal = this.upstreamAbort.signal;

    const loop = async (): Promise<void> => {
      while (!signal.aborted) {
        try {
          this.log.info(
            `[command-router] subscribing MCP SSE: ${this.opts.mcpSseUrl}`,
          );
          const resp = await this.fetchImpl(this.opts.mcpSseUrl, {
            headers: { Accept: "text/event-stream" },
            signal,
          });
          if (!resp.ok || !resp.body) {
            throw new Error(`MCP SSE subscribe failed: HTTP ${resp.status}`);
          }
          await this.consumeSseStream(resp.body, signal);
        } catch (err) {
          if (signal.aborted) return;
          this.log.warn(
            `[command-router] MCP SSE disconnected: ${err instanceof Error ? err.message : String(err)}; retry in 2s`,
          );
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };

    void loop();
    return () => this.upstreamAbort?.abort();
  }

  private async consumeSseStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 帧以空行分隔
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            this.handleSseData(data);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleSseData(data: string): void {
    let msg: { type?: string; command?: BrowserCommand };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      this.log.warn(`[command-router] bad SSE frame: ${data.slice(0, 120)}`);
      return;
    }
    if (msg.type === "command" && msg.command) {
      this.handleCommand(msg.command);
    }
    // heartbeat / connected 等帧忽略
  }
}

// -------------------------------------------------------------------------------
// Express 路由
// -------------------------------------------------------------------------------

export interface ChannelRouterOptions {
  /** 会话归属校验（AUTH_ENABLED=true 时必传）；dev 模式缺省跳过 */
  verifySession?: (sessionId: string, req: Request) => Promise<{ ok: boolean; reason?: string }>;
}

/** 挂载于 /channel 下（路径为 /events、/result） */
export function createChannelRouter(
  commandRouter: CommandRouter,
  options?: ChannelRouterOptions,
): Router {
  const router = Router();

  /** 浏览器 SSE 连接（多连接，按 sessionId 分桶） */
  router.get("/events", async (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    // 会话归属校验（防冒用他人 session 接收命令）
    if (options?.verifySession) {
      try {
        const v = await options.verifySession(sessionId, req);
        if (!v.ok) {
          res.status(403).json({ error: v.reason ?? "session rejected" });
          return;
        }
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      // 防中间层 nginx 攒批（SSE 逐条下发）
      "X-Accel-Buffering": "no",
    });
    res.write(
      `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
    );

    commandRouter.addConnection(sessionId, res);

    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
    }, 30_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      commandRouter.removeConnection(sessionId, res);
    });
  });

  /** 浏览器回传命令结果 → 转发 gateway /mcp/result */
  router.post("/result", async (req: Request, res: Response) => {
    const { id, result } = (req.body ?? {}) as { id?: string; result?: unknown };
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }
    try {
      await commandRouter.handleResult(id, result);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({
        error: `forward to MCP failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  return router;
}

// -------------------------------------------------------------------------------
// browser 工具包装钩子（chat 层在调用前后挂登记/释放）
// -------------------------------------------------------------------------------

/**
 * 包装 MCP 工具集：browser 工具的 execute 前后自动 registerCall/release。
 * 非 browser 工具（如 discovery）原样透传。
 */
export function wrapBrowserTools(
  tools: ToolSet,
  sessionId: string,
  commandRouter: CommandRouter,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const originalExecute = tool.execute;
    if (!isBrowserTool(name) || typeof originalExecute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    const callOriginal = originalExecute as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>;
    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options: unknown) => {
        const release = await commandRouter.registerCall(sessionId, name);
        try {
          return await callOriginal(input, options);
        } finally {
          release();
        }
      },
    } as ToolSet[string];
  }
  return wrapped;
}
