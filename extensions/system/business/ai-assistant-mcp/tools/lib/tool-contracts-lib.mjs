// 文件作用：tool-contracts-lib Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-22
// 版本：1.0.1
// 修改记录：
//   - 1.0.1 (2026-11-10) stdio 直启 gateway，避免 pnpm 孙进程导致 CI 悬挂
//   - 1.0.0 (2026-07-22) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

// 工具契约共享逻辑：MCP 连接（HTTP 默认 / stdio 备选）、listTools 拉取、domain/side/riskLevel 映射、契约构建。
// gen-tool-contracts.mjs 与 check-tool-contracts.mjs 共用，映射表只在此维护一份，避免两处漂移。
//
// 红线：不得修改 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/ 内任何文件（vendor pristine）。
// 本模块仅 import gateway 自带 node_modules 里的 @modelcontextprotocol/sdk（vendor 锁定的 1.27.x），
// 保证拿到的 listTools 是未经任何包装的原始 schema（契约单一事实源）。
//
// 工具面 = gateway（6 域 39 + 3 discovery）+ geolocation（3，经 geolocation-http 桥或其 stdio 入口）。
// HTTP 模式（默认）：连已在运行的 gateway streamable-http 与 geolocation 桥（本地开发形态，
// 与 orchestrator 同源）；stdio 备选（--stdio 或 MCP_CONTRACTS_TRANSPORT=stdio）：子进程拉起
// gateway 与 geolocation-server 均直启 node build/index.js（避免包管理器孙进程残留），
// CI 漂移守卫用此形态（无需常驻进程）。

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);
export const MCP_WORKSPACE_ROOT = path.join(
  REPO_ROOT,
  "extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/cesium-js",
);
export const GATEWAY_DIR = path.join(MCP_WORKSPACE_ROOT, "servers/gateway");
export const GEO_SERVER_DIR = path.join(
  REPO_ROOT,
  "extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/geolocation-server",
);
export const UPSTREAM_FILE = path.join(
  REPO_ROOT,
  "extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/.upstream",
);
export const CONTRACTS_DIR = path.join(
  REPO_ROOT,
  "extensions/system/business/ai-assistant-mcp/contracts",
);
export const CONTRACTS_JSON = path.join(CONTRACTS_DIR, "tool-contracts.json");
export const TOOL_NAMES_TS = path.join(CONTRACTS_DIR, "tool-names.ts");
export const TOOL_NAMES_JSON = path.join(CONTRACTS_DIR, "tool-names.json");
/** 本地附加工具（不经 MCP，orchestrator 本地实现），merge 进契约输出 */
export const LOCAL_TOOLS_JSON = path.join(CONTRACTS_DIR, "local-tools.json");

// ---------------------------------------------------------------------------
// 映射表（易改：上游工具命名变化时只改这里）
// ---------------------------------------------------------------------------

/**
 * domain 映射：按工具名前缀/精确名匹配，先命中先生效。
 * 依据：gateway 启动日志注册的 domain（camera/entity/animation/imagery/tiles/terrain + discovery），
 * 其中 tileset_* 归属 tiles 域，clock_control 与 globe_* 归属 animation 域（gateway 源码同此划分）。
 * geolocation_* 来自 geolocation-server（经 geolocation-http 桥接入）。
 */
export const DOMAIN_RULES = [
  { domain: "discovery", match: /^cesium_/ },
  { domain: "geolocation", match: /^geolocation_/ },
  { domain: "camera", match: /^camera_/ },
  { domain: "entity", match: /^entity_/ },
  { domain: "animation", match: /^(animation_|clock_control$|globe_)/ },
  { domain: "imagery", match: /^imagery_/ },
  { domain: "tiles", match: /^tileset_/ },
  { domain: "terrain", match: /^terrain_/ },
];

/**
 * side 映射：工具实际执行侧。
 * geolocation_* 走服务端 GIS 服务、cesium_* 是 gateway 自身的 discovery 操作 → server；
 * 其余全部经 SSE 命令通道下发到浏览器端 Cesium Viewer 执行 → browser。
 */
export const SIDE_RULES = [
  { side: "server", match: /^(geolocation_|cesium_)/ },
  { side: "browser", match: /.*/ },
];

/**
 * riskLevel 映射：先命中先生效，默认 write。
 * - codegen：cesium_execute_code（P3 预留，当前上游不存在，出现即归类）。
 * - destructive：一切 *_remove 类（当前为 entity/tileset/terrain/imagery/animation 五个 remove）。
 * - read：查询类。任务书原文为 *_list / *_get 后缀 glob，但实测 animation_list_active、
 *   camera_get_position 同为纯查询却不匹配后缀，故按「list/get 作为完整词段出现」判定，
 *   另显式列 cesium_list_domains / cesium_man（后者当前不存在，预留）。
 */
export const RISK_RULES = [
  { riskLevel: "codegen", match: /^cesium_execute_code$/ },
  { riskLevel: "destructive", match: /(^|_)remove(_|$)/ },
  {
    riskLevel: "read",
    match: /(^|_)(list|get)(_|$)/, // 覆盖 *_list、*_get、*_list_active、*_get_position 等
  },
  { riskLevel: "read", match: /^cesium_(list_domains|man)$/ },
];
export const DEFAULT_RISK_LEVEL = "write";

export function mapDomain(name) {
  for (const r of DOMAIN_RULES) if (r.match.test(name)) return r.domain;
  return "unknown";
}

export function mapSide(name) {
  for (const r of SIDE_RULES) if (r.match.test(name)) return r.side;
  return "browser";
}

export function mapRiskLevel(name) {
  for (const r of RISK_RULES) if (r.match.test(name)) return r.riskLevel;
  return DEFAULT_RISK_LEVEL;
}

// ---------------------------------------------------------------------------
// MCP 连接与契约构建
// ---------------------------------------------------------------------------

/**
 * 解析 gateway 自带 node_modules 中的 @modelcontextprotocol/sdk（ESM 入口 URL）。
 * streamableHttp 入口仅 HTTP 模式需要，缺失（未 install）时统一在入口处报错。
 */
function resolveMcpSdkEntries() {
  // createRequire 以 gateway 包为锚点做解析（scripts/ 不在该 workspace 内，不能直接裸 import）。
  const req = createRequire(path.join(GATEWAY_DIR, "noop.cjs"));
  // exports 的 require 条件指向 dist/cjs/...；同版 sdk 的 esm 与 cjs 目录布局一致，换成 dist/esm。
  const toEsm = (p) =>
    p.replace(
      `${path.sep}dist${path.sep}cjs${path.sep}`,
      `${path.sep}dist${path.sep}esm${path.sep}`,
    );
  const entries = {
    clientEsm: toEsm(req.resolve("@modelcontextprotocol/sdk/client/index.js")),
    stdioEsm: toEsm(req.resolve("@modelcontextprotocol/sdk/client/stdio.js")),
    streamableHttpEsm: toEsm(
      req.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    ),
  };
  for (const p of Object.values(entries)) {
    if (!p.includes(`${path.sep}dist${path.sep}esm${path.sep}`) || !fs.existsSync(p)) {
      throw new Error(
        `无法定位 @modelcontextprotocol/sdk ESM 入口（${p}）。` +
          `请确认 ${path.relative(REPO_ROOT, MCP_WORKSPACE_ROOT)} 依赖已安装（pnpm install）。`,
      );
    }
  }
  return entries;
}

/** 分页安全地拉取 client 的全量 listTools。 */
async function collectTools(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/** 建立 client 连接（带超时）并收集工具，结束时关闭。 */
async function withClient(entries, makeTransport, label) {
  const { Client } = await import(pathToFileURL(entries.clientEsm).href);
  const client = new Client({ name: "tool-contracts", version: "0.1.0" });
  const timeoutMs = 60_000;
  let timer;
  try {
    await Promise.race([
      client.connect(await makeTransport(entries)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`连接 ${label} 超时（${timeoutMs / 1000}s）`)),
          timeoutMs,
        );
      }),
    ]);
    clearTimeout(timer);
    timer = undefined;
    return await collectTools(client);
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

/** stdio 拉起一个 MCP server 并拉取全量工具。 */
async function listToolsViaStdio(entries, { command, args, cwd, env }) {
  return withClient(
    entries,
    async () => {
      const { StdioClientTransport } = await import(pathToFileURL(entries.stdioEsm).href);
      return new StdioClientTransport({ command, args, cwd, env, stderr: "inherit" });
    },
    `${command} ${args.join(" ")}`,
  );
}

/** HTTP streamable 连接一个 MCP server 并拉取全量工具。 */
async function listToolsViaHttp(entries, url) {
  return withClient(
    entries,
    async () => {
      const { StreamableHTTPClientTransport } = await import(
        pathToFileURL(entries.streamableHttpEsm).href
      );
      return new StreamableHTTPClientTransport(new URL(url));
    },
    url,
  );
}

/**
 * 拉取全量 MCP 工具（gateway + geolocation 合并）。
 *
 * transport=http（默认）：连已运行的 gateway streamable-http（gatewayUrl）与
 * geolocation-http 桥（geoUrl），与 orchestrator 运行形态同源。
 *
 * transport=stdio（CI 备选）：子进程直启 gateway 与 geolocation-server 的
 * `node build/index.js`（需先构建；PORT 用 3910 避开 orchestrator 默认的 3010）。
 */
export async function listAllTools({
  transport = process.env.MCP_CONTRACTS_TRANSPORT || "http",
  gatewayUrl = process.env.MCP_CONTRACTS_GATEWAY_URL || "http://localhost:4010/mcp",
  geoUrl = process.env.MCP_CONTRACTS_GEO_URL || "http://localhost:3008/mcp",
  port = process.env.MCP_GATEWAY_PORT || "3910",
} = {}) {
  const entries = resolveMcpSdkEntries();

  if (transport === "stdio") {
    const gw = await listToolsViaStdio(entries, {
      command: process.execPath,
      args: ["build/index.js"],
      cwd: GATEWAY_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        COMMUNICATION_PROTOCOL: "sse",
        MCP_TRANSPORT: "stdio",
      },
    });
    const geo = await listToolsViaStdio(entries, {
      command: "node",
      args: ["build/index.js"],
      cwd: GEO_SERVER_DIR,
      env: { ...process.env },
    });
    return [...gw, ...geo];
  }

  const gw = await listToolsViaHttp(entries, gatewayUrl);
  const geo = await listToolsViaHttp(entries, geoUrl);
  return [...gw, ...geo];
}

/** 读取 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/.upstream 的 pin 信息（repo/commit）。 */
export function loadUpstreamPin() {
  const pin = { repo: null, commit: null };
  try {
    for (const line of fs.readFileSync(UPSTREAM_FILE, "utf8").split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (!m) continue;
      if (m[1] === "repo") pin.repo = m[2].trim();
      if (m[1] === "commit") pin.commit = m[2].trim();
    }
  } catch {
    // .upstream 缺失不致命，契约里记 null 即可
  }
  return pin;
}

/** 由 listTools 原始结果构建完整契约对象（tools 按名字排序，输出确定性）。 */
export function buildContract(rawTools) {
  const tools = rawTools
    .map((t) => ({
      name: t.name,
      domain: mapDomain(t.name),
      side: mapSide(t.name),
      riskLevel: mapRiskLevel(t.name),
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const unknown = tools.filter((t) => t.domain === "unknown").map((t) => t.name);
  if (unknown.length > 0) {
    throw new Error(
      `以下工具未命中任何 domain 映射规则，请更新 DOMAIN_RULES：${unknown.join(", ")}`,
    );
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    upstream: loadUpstreamPin(),
    toolCount: tools.length,
    tools,
  };
}

/** JSON 值深度相等（对象键序不敏感、数组顺序敏感）。 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(a[i], b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** 工具名 → TS 常量 key（camera_fly_to → CAMERA_FLY_TO）。 */
export function toConstKey(name) {
  return name.toUpperCase();
}

const GENERATED_BANNER =
  "// 本文件由 extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs 自动生成，请勿手改。" +
  "重新生成见 extensions/system/business/ai-assistant-mcp/contracts/README.md";

export function renderToolNamesTs(names) {
  const lines = names.map((n) => `  ${toConstKey(n)}: "${n}",`);
  return `${GENERATED_BANNER}
export const TOOL_NAMES = {
${lines.join("\n")}
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
`;
}

export function renderToolNamesJson(names) {
  const map = {};
  for (const n of names) map[toConstKey(n)] = n;
  return `${JSON.stringify(map, null, 2)}\n`;
}

/** 统计分布：{ domain: {...}, side: {...}, riskLevel: {...} }（键按字典序）。 */
export function summarize(contract) {
  const tally = (key) => {
    const acc = {};
    for (const t of contract.tools) acc[t[key]] = (acc[t[key]] ?? 0) + 1;
    return Object.fromEntries(Object.entries(acc).sort(([a], [b]) => a.localeCompare(b)));
  };
  return {
    total: contract.toolCount,
    domain: tally("domain"),
    side: tally("side"),
    riskLevel: tally("riskLevel"),
  };
}

export function formatDist(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// 本地附加工具合并（P3 codegen：cesium_execute_code 不经 MCP）
// ---------------------------------------------------------------------------

/**
 * 把 contracts/local-tools.json 合并进契约（MCP 重生成时本地工具不丢）。
 * 本地条目自带 name/domain/side/riskLevel/description/inputSchema，标注 source:"local"；
 * 与 MCP 工具重名视为错误（防止本地文件遮蔽上游工具）。
 * 文件不存在时原样返回（向后兼容）。
 */
export function mergeLocalTools(contract) {
  if (!fs.existsSync(LOCAL_TOOLS_JSON)) return contract;
  const local = JSON.parse(fs.readFileSync(LOCAL_TOOLS_JSON, "utf8"));
  const entries = Array.isArray(local.tools) ? local.tools : [];

  const required = ["name", "domain", "side", "riskLevel", "description", "inputSchema"];
  const mcpNames = new Set(contract.tools.map((t) => t.name));
  const merged = [...contract.tools];
  for (const t of entries) {
    const missing = required.filter((k) => t[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`local-tools.json 条目 ${t.name ?? "<unnamed>"} 缺字段: ${missing.join(", ")}`);
    }
    if (mcpNames.has(t.name)) {
      throw new Error(`local-tools.json 条目与 MCP 工具重名: ${t.name}`);
    }
    merged.push({ ...t, source: "local" });
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));

  return { ...contract, toolCount: merged.length, tools: merged };
}
