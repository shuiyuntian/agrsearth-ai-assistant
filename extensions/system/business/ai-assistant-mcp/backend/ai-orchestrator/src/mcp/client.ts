/**
 * 文件作用：client 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { Config } from "../config.js";

export interface McpConnInfo {
  url: string;
  state: "up" | "down";
  toolCount: number;
}

export interface McpHandle {
  /** MCP 侧 listTools 转换来的 AI SDK ToolSet（execute 由 MCP 侧完成；连接重建后委托随之切换） */
  tools: ToolSet;
  /** 各 MCP 连接实时状态（/health 用） */
  status: () => Record<string, McpConnInfo>;
  close: () => Promise<void>;
}

interface Conn {
  name: string;
  url: string;
  client: MCPClient | null;
  tools: ToolSet;
  state: "up" | "down";
  /** 进行中的重建 promise（串行化并发触发） */
  rebuilding: Promise<void> | null;
}

type Logger = Pick<typeof console, "info" | "warn" | "error">;

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
/** 工具调用失败触发的重建最多尝试次数（启动路径为无限重试） */
const REBUILD_MAX_ATTEMPTS = 3;

type ToolExecute = (input: unknown, options: unknown) => Promise<unknown>;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectOnce(url: string): Promise<{ client: MCPClient; tools: ToolSet }> {
  const client = await createMCPClient({
    transport: { type: "http", url },
    clientName: "ai-orchestrator",
  });
  try {
    const tools = await client.tools();
    return { client, tools };
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err;
  }
}

/**
 * 连接 MCP gateway（+ geolocation 桥），一律 HTTP streamable（S1 起 MCP 均为外部进程：
 * 本地起法见包根 README.md 的 cesium-mcp 组件章节）。
 *
 * - 启动：任一连接未就绪时指数退避无限重试（支持先起 orchestrator 后起 MCP）；
 * - 运行期：工具调用失败 → 标记 down 并有界重试地重建该 client（新 session），
 *   原调用随后重试一次；成功则 tools 委托切换到新 client，失败抛原错误、下次调用再触发重建；
 * - geolocation 连接由 GEO_MCP_URL 配置，空串禁用；两连接工具集合并后统一暴露，
 *   重名视为配置错误 fail-fast。
 *
 * 注意 gateway 的 streamable-http 是有状态 session 实现，orchestrator 是其唯一客户端。
 */
export async function connectMcp(config: Config, log: Logger = console): Promise<McpHandle> {
  const state = { closed: false };

  const conns: Conn[] = [
    {
      name: "gateway",
      url: config.MCP_HTTP_URL,
      client: null,
      tools: {},
      state: "down",
      rebuilding: null,
    },
  ];
  if (config.GEO_MCP_URL) {
    conns.push({
      name: "geolocation",
      url: config.GEO_MCP_URL,
      client: null,
      tools: {},
      state: "down",
      rebuilding: null,
    });
  }

  async function connectWithRetry(
    conn: Conn,
    maxAttempts: number | undefined,
  ): Promise<{ client: MCPClient; tools: ToolSet }> {
    let delay = INITIAL_BACKOFF_MS;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (state.closed) throw new Error("MCP handle closed");
      attempt += 1;
      try {
        return await connectOnce(conn.url);
      } catch (err) {
        if (maxAttempts !== undefined && attempt >= maxAttempts) throw err;
        log.warn(
          `[mcp] ${conn.name} connect failed (attempt ${attempt}): ${errMsg(err)}; retry in ${delay}ms`,
        );
        await sleep(delay);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /** 调用失败后的有界重建（串行）；成功换上新 client/tools，失败保持 down 并抛错。 */
  async function rebuildConn(conn: Conn): Promise<void> {
    conn.rebuilding ??= (async () => {
      conn.state = "down";
      await conn.client?.close().catch(() => undefined);
      conn.client = null;
      try {
        const { client, tools } = await connectWithRetry(conn, REBUILD_MAX_ATTEMPTS);
        conn.client = client;
        conn.tools = tools;
        conn.state = "up";
        log.info(
          `[mcp] ${conn.name} reconnected: ${conn.url} (${Object.keys(tools).length} tools)`,
        );
      } catch (err) {
        log.warn(`[mcp] ${conn.name} rebuild failed: ${errMsg(err)}`);
        throw err;
      }
    })().finally(() => {
      conn.rebuilding = null;
    });
    return conn.rebuilding;
  }

  /** execute 委托当前 conn.tools[name]；失败触发重建并重试一次。 */
  function wrapTool(conn: Conn, name: string, baseTool: ToolSet[string]): ToolSet[string] {
    const baseExecute = (baseTool as { execute?: ToolExecute }).execute;
    if (typeof baseExecute !== "function") return baseTool;
    return {
      ...baseTool,
      execute: async (input: unknown, options: unknown) => {
        const current = conn.tools[name] as { execute?: ToolExecute };
        try {
          return await current.execute!(input, options);
        } catch (err) {
          if (state.closed) throw err;
          log.warn(
            `[mcp] ${conn.name} tool ${name} call failed: ${errMsg(err)}; rebuilding client and retrying once`,
          );
          await rebuildConn(conn);
          const fresh = conn.tools[name] as { execute?: ToolExecute };
          return await fresh.execute!(input, options);
        }
      },
    } as ToolSet[string];
  }

  // 启动：逐连接指数退避重试，直到全部连上
  for (const conn of conns) {
    const { client, tools } = await connectWithRetry(conn, undefined);
    conn.client = client;
    conn.tools = tools;
    conn.state = "up";
    log.info(`[mcp] ${conn.name} connected: ${conn.url} (${Object.keys(tools).length} tools)`);
  }

  // 合并工具面（重名 fail-fast）
  const tools: ToolSet = {};
  const origin = new Map<string, string>();
  for (const conn of conns) {
    for (const [name, tool] of Object.entries(conn.tools)) {
      const from = origin.get(name);
      if (from) {
        throw new Error(`MCP 工具重名: ${name}（${from} 与 ${conn.name} 均提供）`);
      }
      origin.set(name, conn.name);
      tools[name] = wrapTool(conn, name, tool);
    }
  }

  return {
    tools,
    status: () =>
      Object.fromEntries(
        conns.map((c) => [
          c.name,
          { url: c.url, state: c.state, toolCount: Object.keys(c.tools).length },
        ]),
      ),
    close: async () => {
      state.closed = true;
      await Promise.all(
        conns.map((c) => c.client?.close().catch(() => undefined)),
      );
    },
  };
}
