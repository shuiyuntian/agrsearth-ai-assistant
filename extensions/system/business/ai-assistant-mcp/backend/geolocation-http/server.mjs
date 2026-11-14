#!/usr/bin/env node
// 文件作用：server Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-26
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-07-26) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

// geolocation-http — vendor geolocation-server（仅 stdio）的 HTTP streamable 桥。
//
// 背景：mcp/geolocation-server 是 pristine vendor（CesiumGS），其 index.ts 只挂
// StdioServerTransport，而 ai-orchestrator 一律经 HTTP streamable 连 MCP。
// 本桥在 vendor 树外复用其 build 产物的 registerGeolocationTools，经
// StreamableHTTPServerTransport 暴露 http://<host>:3008/mcp。
//
// 多 session：vendor SDK 的 McpServer 单实例只接受一次 initialize（"Server already
// initialized"），故按 SDK 官方多会话模式——每个 session 一对 (McpServer, transport)，
// 按 mcp-session-id 路由。orchestrator 的重建重连与契约工具（gen/check）可并存连接。
//
// 红线：不改 mcp/ 内任何文件；SDK 直接从 vendor 包 node_modules 解析（ESM 入口），
// 保证 McpServer/zod 单实例兼容，锁版以 vendor pnpm-lock 为准。
//
// 用法：
//   NOMINATIM_SERVER_URL=http://127.0.0.1:18860 \
//   OSRM_SERVER_URL=http://127.0.0.1:18861 \
//   OVERPASS_SERVER_URL=http://127.0.0.1:18862/api/interpreter \
//   OSM_USER_AGENT=AGRSEarth/1.0 \
//   PORT=3008 node extensions/system/business/ai-assistant-mcp/backend/geolocation-http/server.mjs
//
// 端点：POST|GET|DELETE /mcp（MCP streamable-http，有状态多 session）；GET /health。
//
// 第 4 个工具 geolocation_extent（本桥自有，非 vendor）：按名称查 Overpass
// way/relation 的 bounds+tags，供 orchestrator 高度推算链（extent 对角线 ×2.7）。
// vendor geocode 的 boundingBox 常是点状框、search 不查 relation 无 bounds，
// extent 查询只能住在桥里（orchestrator 禁止直连 Overpass/Nominatim 原始 API）。
// 纯函数（QL 构建/候选选取/对角线/LRU）在 ./extent.mjs，node --test 单测。
//
// Nominatim 接管（S3 部署层方案，不改 vendor）：vendor provider 硬编码
// https://nominatim.openstreetmap.org，本桥在全局 fetch 层把该 origin 改写为
// NOMINATIM_SERVER_URL（自建实例，无私有限流；内网地址须入 no_proxy 以直连）。
// NOMINATIM_SERVER_URL 留空则不改写，公网 nominatim 经 https_proxy 出网。

import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import {
  EXTENT_DEFAULT_RADIUS_KM,
  EXTENT_MAX_RADIUS_KM,
  ExtentCache,
  buildExtentQuery,
  extentCacheKey,
  parseExtentResponse,
  stripPoiSuffix,
} from "./extent.mjs";

// vendor 的全局 fetch 不读代理 env；EnvHttpProxyAgent 让 https_proxy/http_proxy/no_proxy
// 对进程内全部 fetch 生效（公网 nominatim 必须走代理；内网 GIS 服务经 no_proxy 直连）。
setGlobalDispatcher(new EnvHttpProxyAgent());

// Nominatim 接管：vendor provider 硬编码公网 origin（字符串模板拼 URL 后调全局 fetch），
// 在 fetch 入口改写为 NOMINATIM_SERVER_URL；Host 头随 URL 自动对齐（自建实例已实测不敏感）。
const NOMINATIM_PUBLIC_ORIGIN = "https://nominatim.openstreetmap.org";
const nominatimOverride = process.env.NOMINATIM_SERVER_URL?.replace(/\/+$/, "");
if (nominatimOverride) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith(NOMINATIM_PUBLIC_ORIGIN)) {
      input = nominatimOverride + input.slice(NOMINATIM_PUBLIC_ORIGIN.length);
    } else if (input instanceof URL && input.origin === NOMINATIM_PUBLIC_ORIGIN) {
      input = new URL(nominatimOverride + input.pathname + input.search);
    } else if (input instanceof Request && input.url.startsWith(NOMINATIM_PUBLIC_ORIGIN)) {
      input = new Request(
        nominatimOverride + input.url.slice(NOMINATIM_PUBLIC_ORIGIN.length),
        input,
      );
    }
    return origFetch(input, init);
  };
  console.error(`[geolocation-http] nominatim origin rewrite -> ${nominatimOverride}`);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEO_SERVER_DIR = path.resolve(HERE, "..", "..", "vendor", "cesium-mcp", "geolocation-server");

const PORT = Number.parseInt(process.env.PORT || "3008", 10);
const MCP_ENDPOINT = "/mcp";
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;

/** 解析 vendor 包 node_modules 里的 @modelcontextprotocol/sdk（ESM 入口 URL）。 */
function resolveVendorSdkEntry(subpath) {
  const req = createRequire(path.join(GEO_SERVER_DIR, "package.json"));
  // exports 的 require 条件指向 dist/cjs/...；同版 sdk 的 esm 与 cjs 目录布局一致，换成 dist/esm。
  const esm = req
    .resolve(`@modelcontextprotocol/sdk/${subpath}`)
    .replace(
      `${path.sep}dist${path.sep}cjs${path.sep}`,
      `${path.sep}dist${path.sep}esm${path.sep}`,
    );
  if (!esm.includes(`${path.sep}dist${path.sep}esm${path.sep}`) || !fs.existsSync(esm)) {
    throw new Error(
      `无法定位 @modelcontextprotocol/sdk ESM 入口（${esm}）。` +
        `请确认 ${path.relative(process.cwd(), GEO_SERVER_DIR)} 依赖已安装并完成 tsc 构建。`,
    );
  }
  return esm;
}

/** 解析 vendor 包 node_modules 里的 zod（ESM 入口 URL），保证与 vendor 工具同一 zod 实例。 */
function resolveVendorZodEntry() {
  const req = createRequire(path.join(GEO_SERVER_DIR, "package.json"));
  // zod v4：require 条件指向 index.cjs，同目录 index.js 为 ESM 入口
  const esm = req.resolve("zod").replace(/index\.cjs$/, "index.js");
  if (!esm.endsWith("index.js") || !fs.existsSync(esm)) {
    throw new Error(
      `无法定位 zod ESM 入口（${esm}）。` +
        `请确认 ${path.relative(process.cwd(), GEO_SERVER_DIR)} 依赖已安装。`,
    );
  }
  return esm;
}

function writeJsonRpcError(res, status, code, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

async function main() {
  const { McpServer } = await import(
    pathToFileURL(resolveVendorSdkEntry("server/mcp.js")).href
  );
  const { StreamableHTTPServerTransport } = await import(
    pathToFileURL(resolveVendorSdkEntry("server/streamableHttp.js")).href
  );

  const geoBuildEntry = path.join(GEO_SERVER_DIR, "build", "tools", "index.js");
  if (!fs.existsSync(geoBuildEntry)) {
    throw new Error(
      `geolocation-server build 产物缺失（${geoBuildEntry}）。` +
        "构建见 ai-assistant-mcp 包根 README.md 的 cesium-mcp 组件章节。",
    );
  }
  const { registerGeolocationTools } = await import(pathToFileURL(geoBuildEntry).href);
  const { z } = await import(pathToFileURL(resolveVendorZodEntry()).href);

  // geolocation_extent（桥自有第 4 工具）：Overpass 端点与 vendor provider 同一环境变量，
  // UA 与 vendor 一致取 OSM_USER_AGENT；结果走 LRU（容量 200；正结果 1h，负结果 5min），错误不缓存。
  // 名称阶梯：① 索引化 union（name/official_name/name:zh 精确 + alt_name 包含）；
  // ② 未命中剥一个 POI 通名后缀（故宫博物院→故宫）再走 ①。
  const OVERPASS_URL =
    process.env.OVERPASS_SERVER_URL?.trim() || "https://overpass-api.de/api/interpreter";
  const OSM_USER_AGENT = process.env.OSM_USER_AGENT?.trim() || "AGRSEarth/1.0";
  const extentCache = new ExtentCache();
  console.error(`[geolocation-http] geolocation_extent overpass -> ${OVERPASS_URL}`);

  /** 单次 Overpass 查询：缓存命中直返，否则 POST QL 并分级缓存（错误不缓存）。 */
  async function queryExtentOnce(name, at, radiusKm) {
    const cacheKey = extentCacheKey({ name, at, radiusKm });
    const cached = extentCache.get(cacheKey);
    if (cached !== undefined) return { result: cached, cached: true };
    const startTime = Date.now();
    const query = buildExtentQuery({ name, at, radiusKm });
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OSM_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      // 与 QL timeout 对齐并留 10s 余量（around 25s / 全球 60s）
      signal: AbortSignal.timeout((at ? 25 : 60) * 1000 + 10_000),
    });
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} - ${response.statusText}`);
    }
    const result = parseExtentResponse(await response.json(), at);
    extentCache.set(cacheKey, result, result.found ? undefined : extentCache.negativeTtlMs);
    console.error(
      `[geolocation-http] extent query name="${name}" found=${result.found} ${Date.now() - startTime}ms`,
    );
    return { result, cached: false };
  }

  /** 名称阶梯：原名 → 剥 POI 通名后缀重试；两次都未命中返回原名的负结果。 */
  async function queryExtentWithFallback(name, at, radiusKm) {
    const first = await queryExtentOnce(name, at, radiusKm);
    if (first.result.found) return first;
    const stripped = stripPoiSuffix(name);
    if (!stripped || stripped === name) return first;
    const second = await queryExtentOnce(stripped, at, radiusKm);
    return second.result.found ? second : first;
  }

  /** 注册 geolocation_extent：按名称查 way/relation 的 bounds+tags（orchestrator 高度推算用）。 */
  function registerExtentTool(server) {
    server.registerTool(
      "geolocation_extent",
      {
        title: "Query named place extent (bounds) from Overpass",
        description:
          "Query the geographic extent (bounding box) of a NAMED place (landmark, park, " +
          "administrative area) from OpenStreetMap via Overpass. Matches way/relation by " +
          "name/official_name/name:zh (exact) or alt_name (contains), with a POI-suffix " +
          "stripping fallback (e.g. '故宫博物院' -> '故宫'); returns bounds with diagonal " +
          "size in meters plus OSM tags. " +
          "Prefer relation over way; with 'at', the nearest candidate to 'at' wins. " +
          "Use geolocation_geocode for coordinates, this tool for the spatial extent.",
        inputSchema: {
          name: z.string().min(1).describe("Place name (matched against OSM name/official_name/name:zh/alt_name)"),
          at: z
            .object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            })
            .optional()
            .describe(
              "Bias point: restricts the query to radiusKm around it and picks the nearest candidate",
            ),
          radiusKm: z
            .number()
            .min(0.1)
            .max(EXTENT_MAX_RADIUS_KM)
            .optional()
            .describe(`Search radius around 'at' in km (default ${EXTENT_DEFAULT_RADIUS_KM})`),
        },
      },
      async (params) => {
        const startTime = Date.now();
        const name = params.name.trim();
        const at = params.at;
        const radiusKm = params.radiusKm ?? EXTENT_DEFAULT_RADIUS_KM;
        try {
          const { result, cached } = await queryExtentWithFallback(name, at, radiusKm);
          const ms = Date.now() - startTime;
          const suffix = cached ? ` (cached, ${ms}ms)` : ` (${ms}ms)`;
          return {
            content: [{ type: "text", text: `📏 ${result.message}${suffix}` }],
            structuredContent: result,
            isError: false,
          };
        } catch (error) {
          const ms = Date.now() - startTime;
          const message = `Extent query failed: ${error instanceof Error ? error.message : "Unknown error"}`;
          return {
            content: [{ type: "text", text: `❌ ${message} (${ms}ms)` }],
            structuredContent: { found: false, message },
            isError: true,
          };
        }
      },
    );
  }

  /** sessionId -> { transport, server } */
  const sessions = new Map();

  /** 新 session：一对 (McpServer, transport)（vendor McpServer 单实例只接受一次 initialize）。 */
  async function createSession() {
    const server = new McpServer({
      name: "cesium-geolocation-mcp-server",
      version: "1.0.0",
    });
    registerGeolocationTools(server);
    registerExtentTool(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, server });
        console.error(
          `[geolocation-http] session initialized: ${sessionId} (active=${sessions.size})`,
        );
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
        console.error(
          `[geolocation-http] session closed: ${sessionId} (active=${sessions.size})`,
        );
      },
    });
    transport.onclose = () => {
      server.close().catch(() => undefined);
    };
    await server.connect(transport);
    return transport;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", transport: "streamable-http", sessions: sessions.size }),
      );
      return;
    }
    if (url.pathname !== MCP_ENDPOINT) {
      writeJsonRpcError(res, 404, JSON_RPC_INVALID_REQUEST, "not found");
      return;
    }

    const fail = (err) => {
      console.error("[geolocation-http] handleRequest error:", err);
      if (!res.headersSent) writeJsonRpcError(res, 500, JSON_RPC_INVALID_REQUEST, "internal error");
      else res.end();
    };

    const route = async (body) => {
      const sessionId = req.headers["mcp-session-id"];
      if (typeof sessionId === "string" && sessionId) {
        const entry = sessions.get(sessionId);
        if (!entry) {
          writeJsonRpcError(res, 404, JSON_RPC_INVALID_REQUEST, "session not found");
          return;
        }
        await entry.transport.handleRequest(req, res, body);
        return;
      }
      // 无 session id：仅接受 initialize（新会话）
      const isInitialize =
        body &&
        (body.method === "initialize" ||
          (Array.isArray(body) && body.some((m) => m?.method === "initialize")));
      if (req.method !== "POST" || !isInitialize) {
        writeJsonRpcError(
          res,
          400,
          JSON_RPC_INVALID_REQUEST,
          "Bad Request: missing mcp-session-id or not an initialize request",
        );
        return;
      }
      const transport = await createSession();
      await transport.handleRequest(req, res, body);
    };

    if (req.method === "POST") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          writeJsonRpcError(res, 400, JSON_RPC_PARSE_ERROR, "Parse error");
          return;
        }
        void route(body).catch(fail);
      });
      return;
    }

    // GET（standalone SSE 流）/ DELETE（session 终止）
    void route(undefined).catch(fail);
  });

  server.listen(PORT, () => {
    console.error(
      `[geolocation-http] MCP Server running with Streamable HTTP transport on port ${PORT}${MCP_ENDPOINT}`,
    );
  });

  const shutdown = () => {
    console.error("[geolocation-http] shutting down...");
    server.close(() => process.exit(0));
    // 兜底：长连接占用时 server.close 不返回，2s 后强退
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[geolocation-http] fatal:", err);
  process.exit(1);
});
