#!/usr/bin/env node
// =============================================================================
// 文件作用：CesiumAI 插件开发辅助 MCP server（stdio）——面向第三方插件开发团队
//   的 AI 编码工具（Kimi Code / Codex / Claude Code / qoder 等）。六组工具：
//   契约文档取读 / 脚手架建包 / 发布预检 / 发布到共享调试环境 / 实例自助诊断 /
//   HMR 联调指引。
//   双形态同源：平台仓 mcps/cesiumai-dev/（唯一事实源）与模板仓导出产物
//   tools/dev-mcp/（禁止直接改，问题回报平台方）。两种落位脚本均在仓根下两层，
//   ROOT 同为 ../..；按目录标记自动判别平台仓/模板仓模式。
//   边界红线：只触达 aiearth02 共享开发调试环境（公司网，默认 LAN
//   10.82.11.52）；永不出现家庭网地址；鉴权只用团队 ext-developer 账号 token
//   （环境变量 CESIUMAI_TOKEN 或仓根 .env.local，server 本体零密钥）；
//   写操作仅 publish_to_dev 一个，强制 reason 事由并审计留痕。
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-10-22
// 版本：0.1.0
// 修改记录：
//   - 0.1.0 (2026-10-22) 初始创建（双 MCP 体系 M3，方案
//     20261019-方案-双MCP体系 §3；M2 裁定零改动——实例/日志用 RM 现有只读端点，
//     不做团队过滤）
//
// 版权所有 (C) 2026 CesiumAI 项目
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------- 运行模式判别（平台仓=事实源自检；模板仓=团队日常使用）----------
const MODE = await fs.stat(path.join(ROOT, "skeletons")).then(() => "template", () => "platform");

// ---------- 环境配置（唯一目标：aiearth02 共享开发调试环境）----------
const DEV_BASE = process.env.CESIUMAI_DEV_BASE || "http://10.82.11.52:18801";
const RM_API = `${DEV_BASE}/resource-manager/api/v1`;

// ---------- 仓根 .env.local 读取（团队 token，gitignored 不落仓）----------
const LOCAL_ENV = {};
try {
  const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith("#")) LOCAL_ENV[m[1]] = m[2];
  }
} catch { /* .env.local 不存在时静默 */ }

function devToken() {
  const t = process.env.CESIUMAI_TOKEN || LOCAL_ENV.CESIUMAI_TOKEN;
  if (!t) {
    throw new Error("缺少团队账号 token：请设环境变量 CESIUMAI_TOKEN，或在仓根 .env.local 写 CESIUMAI_TOKEN=<token>（token 获取见 README：18850 登录后复制 / 向平台管理员申请）");
  }
  return t;
}

// ---------- 通用执行器 ----------
function run(cmd, args, { input, timeoutMs = 60000, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout: out, stderr: err + `\n[dev-mcp] 超时 ${timeoutMs}ms，已终止` });
    }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: err + `\n[dev-mcp] 启动失败：${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function truncate(text, maxLines = 200) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") +
    `\n\n... [dev-mcp 截断：共 ${lines.length} 行，仅显示前 ${maxLines} 行]`;
}

function ok(text, maxLines) {
  return { content: [{ type: "text", text: truncate(text.trim() || "(无输出)", maxLines) }] };
}

function fail(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function fmt({ code, stdout, stderr }, maxLines) {
  const parts = [];
  if (stdout.trim()) parts.push(stdout.trim());
  if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
  if (code !== 0) parts.push(`[exit code: ${code}]`);
  if (parts.length === 0) parts.push("(无输出)");
  return ok(parts.join("\n"), maxLines);
}

// ---------- resource-manager API（aiearth02 网关，团队 token 鉴权）----------
async function rmApi(apiPath) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(`${RM_API}${apiPath}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${devToken()}` },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    return `HTTP ${resp.status}\n${text}`;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 审计日志（logs/operations/dev-mcp-<日期>.jsonl，gitignored）----------
const AUDIT_DIR = path.join(ROOT, "logs", "operations");
const WRITE_TOOLS = new Set(["publish_to_dev"]);
const SECRET_KEY_RE = /token|password|secret|authorization|credential|api[-_]?key/i;

function tsShanghai() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") + "+08:00";
}

function sanitizeArgs(args) {
  if (!args || typeof args !== "object") return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_KEY_RE.test(k)) { out[k] = "***"; continue; }
    out[k] = typeof v === "string" && v.length > 500 ? v.slice(0, 500) + "…[截断]" : v;
  }
  return out;
}

async function audit(entry) {
  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
    const file = path.join(AUDIT_DIR, `dev-mcp-${tsShanghai().slice(0, 10)}.jsonl`);
    await fs.appendFile(file, JSON.stringify({ ts: tsShanghai(), mode: MODE, ...entry }) + "\n");
  } catch { /* 审计落盘失败不阻断工具调用 */ }
}

// ---------- server ----------
const server = new McpServer({
  name: "cesiumai-dev",
  version: "0.1.0",
});

const rawRegisterTool = server.registerTool.bind(server);
server.registerTool = (name, config, handler) =>
  rawRegisterTool(name, config, async (args, extra) => {
    if (WRITE_TOOLS.has(name) && (!args?.reason || String(args.reason).trim().length < 4)) {
      await audit({ tool: name, args: sanitizeArgs(args), ok: false, error: "写操作缺少 reason（≥4 字符），闸口拒绝" });
      return fail(`写操作 ${name} 必须携带 reason 参数（≥4 字符，说明操作事由），已拒绝执行`);
    }
    const started = Date.now();
    let result;
    try {
      result = await handler(args, extra);
    } catch (e) {
      await audit({ tool: name, args: sanitizeArgs(args), ok: false, durationMs: Date.now() - started, error: e.message });
      throw e;
    }
    await audit({
      tool: name, args: sanitizeArgs(args), ok: !(result && result.isError),
      durationMs: Date.now() - started,
      ...(WRITE_TOOLS.has(name) ? { reason: args.reason } : {}),
    });
    return result;
  });

const reasonField = z.string().min(4)
  .describe("操作事由（必填，≥4 字符）：写操作审计留痕用，简述为什么做这次发布");

const pkgDirField = z.string()
  .describe(MODE === "template"
    ? "扩展包目录（仓内相对路径），如 packages/wind-field"
    : "扩展包目录（仓内相对路径），如 extensions/tool/business/basemap");

function assertPkgDir(pkgDir) {
  if (pkgDir.includes("..") || path.isAbsolute(pkgDir)) throw new Error("pkgDir 须为仓内相对路径且不含 ..");
}

// ===== 1. 契约文档 =====

server.registerTool("plugin_dev_docs", {
  description: MODE === "template"
    ? "插件开发文档取读：无参数返回 docs/L1-L10 分层指南目录 + 各篇一级标题；带 topic 返回全部指南中匹配章节的正文（提测/契约/规范问题先查这里）。"
    : "插件开发契约取读（平台仓模式）：无参数返回 PLUGIN_DEVELOPMENT.md 目录；带 topic 返回匹配章节正文。",
  inputSchema: {
    topic: z.string().optional().describe("章节关键词（匹配标题，如 'menu'、'发布'、'track'、'现场分组'）；缺省返回文档地图"),
  },
}, async ({ topic }) => {
  if (MODE === "template") {
    const docsDir = path.join(ROOT, "docs");
    const files = (await fs.readdir(docsDir)).filter((f) => f.endsWith(".md")).sort();
    if (!topic) {
      const lines = ["【分层指南】docs/ 目录："];
      for (const f of files) {
        const text = await fs.readFile(path.join(docsDir, f), "utf8");
        const h1 = text.split("\n").filter((l) => /^#{1,2}\s/.test(l)).slice(0, 6).join("；");
        lines.push(`\n■ docs/${f}\n  ${h1}`);
      }
      return ok(lines.join("\n"), 200);
    }
    const hits = [];
    for (const f of files) {
      const text = await fs.readFile(path.join(docsDir, f), "utf8");
      const sections = text.split(/\n(?=#{1,3}\s)/);
      for (const s of sections) {
        if (s.split("\n")[0].toLowerCase().includes(topic.toLowerCase())) hits.push(`【docs/${f}】\n${s}`);
      }
    }
    if (hits.length === 0) return ok(`(无匹配章节) topic=${topic}——可无参数调用先看目录`);
    return ok(hits.join("\n\n"), 300);
  }
  const contract = path.join(ROOT, "docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md");
  const text = await fs.readFile(contract, "utf8");
  if (!topic) {
    const headings = text.split("\n").filter((l) => /^#{1,3}\s/.test(l)).join("\n");
    return ok(`【契约唯一本体】docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md\n\n${headings}`, 200);
  }
  const sections = text.split(/\n(?=#{1,3}\s)/);
  const hits = sections.filter((s) => s.split("\n")[0].toLowerCase().includes(topic.toLowerCase()));
  if (hits.length === 0) return ok(`(无匹配章节) topic=${topic}`);
  return ok(hits.join("\n\n"), 300);
});

// ===== 2. 脚手架 =====

server.registerTool("scaffold_package", {
  description: MODE === "template"
    ? "脚手架建包（tools/create-extension.sh）：按 track/tier 实例化骨架到 packages/<id>，可选后端/管理端骨架。本地操作，可逆（删目录即撤销）。"
    : "脚手架建包（平台仓模式，scripts/create-extension.sh）：实例化到 extensions/<track>/<tier>/<id>/。",
  inputSchema: {
    id: z.string().describe("包 ID（小写字母/数字/中划线），如 wind-field"),
    track: z.enum(["tool", "system"]).describe("tool=轻量工具轨；system=子系统轨"),
    tier: z.enum(["platform", "business"]).describe("platform=服务平台自身；business=服务业务场景"),
    name: z.string().optional().describe("中文显示名"),
    withBackend: z.boolean().default(false).describe("生成后端服务骨架（backend/ + container/）"),
    withAdminUi: z.boolean().default(false).describe("生成管理端页面骨架（admin-ui/）"),
  },
}, async ({ id, track, tier, name, withBackend, withAdminUi }) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return fail("包 ID 仅允许小写字母/数字/中划线");
  const script = MODE === "template" ? "tools/create-extension.sh" : "scripts/create-extension.sh";
  const args = [script, id, "--track", track, "--tier", tier];
  if (name) args.push("--name", name);
  if (withBackend) args.push("--with-backend");
  if (withAdminUi) args.push("--with-admin-ui");
  return fmt(await run("bash", args, { timeoutMs: 120000 }), 150);
});

// ===== 3. 预检 =====

server.registerTool("dev_precheck", {
  description: MODE === "template"
    ? "发布前预检：版本五处一致性 + 四必备文件（tools/check-extension-versions.sh 仓级）+ 指定包 data/menu.json 本地校验（tools/menujson.py validate）。零副作用。"
    : "发布前预检（平台仓模式）：publish-extension.sh --check-only 全闸口（manifest/track/tier/components/menu.json/号段台账/权限对账）。零副作用。",
  inputSchema: {
    pkgDir: pkgDirField,
  },
}, async ({ pkgDir }) => {
  assertPkgDir(pkgDir);
  if (MODE === "template") {
    const out = [];
    out.push("===== 版本五处一致性 + 四必备（仓级） =====");
    out.push((await run("bash", ["tools/check-extension-versions.sh"], { timeoutMs: 120000 })).stdout || "(无输出)");
    const menuJson = path.join(ROOT, pkgDir, "data", "menu.json");
    try {
      await fs.stat(menuJson);
      out.push("\n===== menu.json 校验 =====");
      const r = await run("python3", ["tools/menujson.py", "validate", `${pkgDir}/data/menu.json`], { timeoutMs: 60000 });
      out.push(r.stdout.trim() || r.stderr.trim() || "(无输出)");
      if (r.code !== 0) out.push(`[menujson exit code: ${r.code}]`);
    } catch {
      out.push("\n（本包无 data/menu.json，跳过菜单校验）");
    }
    return ok(out.join("\n"), 250);
  }
  return fmt(await run("bash", ["scripts/publish-extension.sh", pkgDir, "--check-only"], { timeoutMs: 300000 }), 250);
});

// ===== 4. 发布（唯一写操作） =====

server.registerTool("publish_to_dev", {
  description: "【写操作，需审批】发布扩展包到 aiearth02 共享开发调试环境（tools/publish.sh：构建 → MinIO 直传 → resource-manager 登记+菜单 provision → 冒烟）。prod 一律拒绝；deploy=true 追加触发部署。平台仓模式下本工具不可用（平台侧发布走 cesiumai-ops 的 publish_extension）。",
  inputSchema: {
    pkgDir: pkgDirField,
    skipBuild: z.boolean().default(false).describe("跳过前端构建（复用已有产物）"),
    deploy: z.boolean().default(false).describe("发布后追加触发部署"),
    reason: reasonField,
  },
}, async ({ pkgDir, skipBuild, deploy, reason }) => {
  if (MODE !== "template") {
    return fail("平台仓模式下请使用 cesiumai-ops 的 publish_extension 工具；publish_to_dev 面向模板仓（第三方团队）");
  }
  assertPkgDir(pkgDir);
  const args = ["tools/publish.sh", pkgDir];
  if (skipBuild) args.push("--skip-build");
  if (deploy) args.push("--deploy");
  return fmt(await run("bash", args, { timeoutMs: 1800000 }), 400);
});

// ===== 5. 自助诊断（aiearth02 resource-manager 只读端点，M2 裁定：全员只读、不做团队过滤） =====

server.registerTool("dev_instances", {
  description: "查 aiearth02 共享调试环境的微服务实例列表（resource-manager /microservice/page）。packageId 精确过滤看指定包；无参数看全部（共享环境全员只读可见）。",
  inputSchema: {
    packageId: z.string().optional().describe("包 ID 精确过滤，如 wind-field；缺省列出全部实例"),
    status: z.string().optional().describe("运行状态过滤，如 RUNNING / STOPPED"),
  },
}, async ({ packageId, status }) => {
  try {
    const qs = new URLSearchParams({ pageNum: "1", pageSize: "100" });
    if (packageId) qs.set("packageId", packageId);
    if (status) qs.set("status", status);
    return ok(await rmApi(`/microservice/page?${qs}`), 200);
  } catch (e) {
    return fail(`查询失败：${e.message}`);
  }
});

server.registerTool("dev_instance_logs", {
  description: "查实例的 Pod 容器日志摘要（resource-manager /microservice/{instanceId}/logs，tailLines 可控）与运维任务记录（/{instanceId}/tasks，含部署/启停结果）。",
  inputSchema: {
    instanceId: z.string().describe("实例 ID（dev_instances 返回的 instanceId 字段）"),
    tailLines: z.number().int().min(10).max(500).default(100).describe("日志尾部行数，上限 500"),
    tasks: z.boolean().default(false).describe("true 时改查运维任务记录（部署/启停结果）而非容器日志"),
  },
}, async ({ instanceId, tailLines, tasks }) => {
  if (!/^[\w.-]+$/.test(instanceId)) return fail("instanceId 含非法字符");
  try {
    if (tasks) return ok(await rmApi(`/microservice/${instanceId}/tasks`), 150);
    return ok(await rmApi(`/microservice/${instanceId}/logs?tailLines=${tailLines}`), 300);
  } catch (e) {
    return fail(`查询失败：${e.message}`);
  }
});

// ===== 6. 联调 =====

server.registerTool("hmr_guide", {
  description: "HMR 热更新调试回路指引：给出本包 --dev-url 回路的准确命令（改写已发布版本 manifest 指向本机 dev server）与排障清单。",
  inputSchema: {
    pkgDir: pkgDirField,
    port: z.number().int().min(1024).max(65535).default(5173).describe("本机 vite dev server 端口，默认 5173"),
  },
}, async ({ pkgDir, port }) => {
  assertPkgDir(pkgDir);
  let pkgId = path.basename(pkgDir);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, pkgDir, "manifest.json"), "utf8"));
    if (manifest.id) pkgId = manifest.id;
  } catch { /* manifest 缺失时用目录名 */ }
  const publishCmd = MODE === "template"
    ? `./tools/publish.sh ${pkgDir}`
    : `./scripts/publish-extension.sh ${pkgDir} --env test`;
  if (MODE !== "template") {
    return ok(`HMR 调试回路（包：${pkgId}）

平台仓模式提示：--dev-url 回路是模板仓 tools/publish.sh 的能力（面向第三方团队
对 aiearth02 的调试），平台仓 publish-extension.sh 不支持该参数。
平台仓内的扩展联调请走既有通道：extensions/<track>/<tier>/<pkg>/deploy/docker-compose.yml
联调栈（scripts/deploy/ext-dev-up.sh）+ 球端 dev /esm-libs 中间件，详见
docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md 开发调试章节。`);
  }
  return ok(`HMR 调试回路（包：${pkgId}）

① 起本机 dev server：
   cd ${pkgDir}/frontend && npm run dev -- --port ${port} --host

② 把共享调试环境上该包的 manifest 指向本机产物：
   ${publishCmd} --dev-url http://<本机IP>:${port}/

   说明：--dev-url 会改写 MinIO 上该包当前版本 manifest.json 的 entries.esm.url
   为本机地址并重传；宿主（球端 18880）再拉 manifest 即加载本机 HMR 产物。

③ 调完恢复线上形态（必须做，否则共享环境一直指向你的机器）：
   ${publishCmd} --dev-url --reset

排障清单：
- 宿主没加载本机产物 → 强刷球端页面（manifest 有缓存）；确认本机IP在公司网可达
- dev server 跨域报错 → vite 配置需走 @cesiumai/vite-config（已内置 cors/headers）
- 球端样式丢失 → 宿主 Tailwind 产物需含本包工具类（平台侧闸口，向平台方反馈）
- 忘记 reset → 其他团队看到 404 加载失败；收工前务必执行 ③`);
});

// ---------- 启动 ----------
const transport = new StdioServerTransport();
await server.connect(transport);
