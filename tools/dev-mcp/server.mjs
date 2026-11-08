#!/usr/bin/env node
// =============================================================================
// 文件作用：AGRSEarth 插件开发 MCP server（stdio）——面向第三方插件开发团队的 AI 编码工具
//   （Kimi Code / Codex / Claude Code / qoder 等），统一命名 25 工具：
//   本地能力（docs_read/package_scaffold/package_precheck/package_contract_check/package_publish/hmr_get_guide）
//   + 开发者中心 DC API 能力（package_list/package_register/package_manage/team_list/
//   team_manage/task_get/task_retry/resource_list/resource_issue/resource_rotate/
//   resource_revoke/instance_list/instance_logs：全部对接 DC 显式门面 controller）
//   + 原生授权登录五工具（auth_login_start/auth_login_wait/auth_login/auth_status/auth_logout）。
//   双形态同源：平台仓 mcps/agrsearth-dev/（唯一事实源）与模板仓导出产物
//   tools/dev-mcp/（禁止直接改，问题回报平台方）。落位脚本均在仓根下两层，ROOT 同为
//   ../..；按 tools/publish.sh 是否存在判别模板仓/平台仓。
//   边界：默认触达 aiearth01 共享开发调试环境；其他环境须显式配置 DC/native URL；
//   远程一律走 DC API（默认 /developer-center/api/v1，可覆盖），RM 旧 API 不再
//   使用；鉴权 = auth_login 原生授权（OIDC 授权码 + PKCE S256 + loopback 回跳，密码不过
//   本工具）落盘 ~/.config/agrsearth（0600），AGRSEARTH_TOKEN 环境变量仍为 CI 覆盖通道；
//   写操作强制 reason 事由并审计留痕；审计日志只记参数与结果码，不记任何响应体/令牌。
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-10-22
// 版本：1.7.0
// 修改记录：
//   - 1.7.0 (2026-11-08) hmr_get_guide 检测随包 style.css 并补 --dev-css-url 指引
//   - 1.6.2 (2026-11-07) package_scaffold 双模式改直调 Node 脚手架（tools/ 或 scripts/
//     create-extension.mjs，process.execPath），不再经 bash——配合两仓脚手架 Node 化
//     （薄 shim 模式），Windows 端建包免 Git Bash；平台仓模式下 withAdminUi 显式报错
//     （admin-ui 骨架为模板仓能力，原为透传后被脚本拒绝）
//   - 1.6.1 (2026-11-07) listenLoopback 瞬态错误纳入重试：EACCES/EADDRNOTAVAIL 与
//     EADDRINUSE 同待遇（Windows 端口瞬时保留实测 EACCES 硬失败，模板仓 issue #11），
//     耗尽后聚合报错含尝试次数/最后错误码/可直接重调提示；不采纳 listen(0)——服务端
//     native-clients allowed-ports 硬校验 49152-65535，OS 分配端口可能越界被拒
//   - 1.6.0 (2026-11-07) 非密拓扑项配置分层升级：process.env > 仓根 .env.local >
//     用户级 ~/.config/agrsearth/config.json > 默认值（与 publish.mjs 2.3.0 同口径；
//     token 不进配置层）；publish.mjs 2.3.0 起自行读取配置层，子进程无需注入拓扑变量
//   - 1.5.0 (2026-11-06) ① run() 增可选 env 覆盖（与 process.env 合并后仅注入该子
//     进程，不改本进程环境、不进任何输出与审计）；package_publish 先 resolveToken
//     再仅向 publish.mjs 子进程注入 AGRSEARTH_TOKEN（登录落盘文件/CI 环境变量同源
//     生效，根治「登录 token 已落盘但 publish.mjs 拿不到」），令牌绝不打印、不进审计；
//     ② instance_logs 增 tailLines 可选参数（int 1-2000，默认 500；tasks=true 时忽略）：
//     GET /instances/{id}/logs?tailLines=...，展示截断上限与 tailLines 对齐（不再固定
//     只显示前 300 行），描述删除「尾部行数服务端固定」旧口径；③ package_manage 增
//     remove action：仅限 DC 测试环境移除测试包——DC DELETE /packages/{packageId}
//     （dcFetch base 已含 /api/v1），服务端把 MinIO 产物移入同 Bucket
//     _trash/<packageId>/<时间-短ID>/ 回收目录后删除包登记，透传 trashPrefix/
//     movedObjects 真实响应、不假成功；写 action 需 reason（≥4 字符），审计保留
//   - 1.4.0 (2026-11-05) 新增 auth_login_start/wait 两步登录，兼容 token 有效期字段；支持 AGRSEARTH_BASH
//   - 1.3.0 (2026-11-05) 新增 package_contract_check（第 23 工具），接入前后端 URL 契约对账
//   - 1.2.4 (2026-11-04) loopback 清理改 Promise 包装 server.close，修复超时 finally 二次抛错
//   - 1.2.3 (2026-11-04) Windows 开浏览器改 rundll32/直连 Chrome；HMR 指南改 watch + vite preview + 实际 ESM URL
//   - 1.2.2 (2026-11-03) 模板仓 precheck/publish 直走 publish.mjs（process.execPath），不再经 bash/python
//   - 1.2.1 (2026-11-02) 支持 AGRSEARTH_SOCKS_PROXY（SSH 动态转发），Node fetch 与
//     独立 Chrome 登录页共用 SOCKS5；不改系统代理，不回显代理凭据
//   - 1.2.0 (2026-11-02) 登录与 DC 连接参数全量可覆盖：支持进程环境/仓根 .env.local，
//     完整 DC API/native-session/native-callback URL、clientId、回跳端口段/固定端口；
//     默认开发支撑环境切至 aiearth01，aiearth02 仅用于部署测试
//   - 0.1.0 (2026-10-22) 初始创建（双 MCP 体系 M3，7 工具，RM 旧 API + 团队 token）
//   - 1.0.0 (2026-10-24) 绿地重构：统一命名 21 工具；新增真实 auth_login（ruoyi-auth
//     /auth/casdoor/native-session + loopback 回跳 + /auth/casdoor/native-callback，PKCE
//     node:crypto 自实现）；DC API 全面替换 RM 旧 API；资源/实例/任务重试按 DC 真实
//     controller 面显式报错（DC 暂无端点，不假成功）；审计脱敏不记响应
//     （20261024 dev-mcp 绿地命名方案；DC=developer-center，controller 见
//     extensions/system/platform/developer-center/backend/.../controller/）
//   - 1.0.1 (2026-10-24) DC P1 资源/重试落地转真实调用：resource_list/issue/rotate/revoke
//     → ResourceController（GET /packages/{id}/resources + POST
//     /packages/{id}/resources/pg-dev/{issue|rotate|revoke}，ttlSeconds 300-86400，
//     一次性开发密码仅此一次展示、不落盘不记审计）；task_retry → POST /tasks/{id}/retry
//     （幂等重试）。runtime 密码只写 Secret 不经 controller（DC 设计红线）
//   - 1.0.2 (2026-10-24) DC P2 实例门面/发布门面：instance_list → GET /instances
//     （packageId 必填授权锚点，未授权 404 如实透传）；instance_logs → GET
//     /instances/{id}/logs（服务端 LogMasker 逐行脱敏）| /instances/{id}/tasks
//     （tasks=true）；package_publish 描述改 DC 发布门面四步（release-prepare →
//     upload-sessions 预签名 POST 直传 → complete → release-complete）。全部 21 工具落地
//   - 1.0.3 (2026-10-24) DC P3 生命周期/团队管理账号：package_manage 增 archive
//     （POST /packages/{id}/archive 幂等）/ transfer（POST /packages/{id}/transfer
//     {targetTeamId}；有 PG 数据返回 migrationTaskId 并提示 task_get 跟踪）；
//     resource_* scope 增 pg-admin（锚点 teamId → /teams/{teamId}/resources/pg-admin/*，
//     pg-dev 仍锚 packageId；resource_list 明确拒绝 pg-admin——无团队资源位列表示端点）；
//     task_get 描述补 PACKAGE_MIGRATION 迁移状态；team_manage 增 quota_request
//     （后端仍无接口，明确报错 + 既有审批通道指引，不假成功）
//   - 1.0.4 (2026-10-24) DC P4 配额闭环：team_manage quota_request 转真实调用
//     （POST /teams/{teamId}/quota-requests，items 1-8 项 {quota:MENU_POOL|PACKAGE|PG,
//     band?, additional:1-100}——服务端字段名 quota 非 type，顶层 reason 可选；创建
//     QUOTA_APPROVAL 任务）；新增 quota_approve / quota_reject 承载平台管理员审批
//     （POST /tasks/{taskId}/quota-approve 无 body / quota-reject body {reason} 透传；
//     21 工具定型不增 task_manage，task_get 只读，task_retry 保持原义）；响应附审批
//     进度指引
//   - 1.1.0 (2026-10-25) 新增 environment_status（第 22 工具）：授权包级只读巡检，
//     Pod/实例健康/任务/PG/运行时 Secret 证据状态/菜单/产物 URL 与版本一致性；
//     不开放全集群参数，不读取 Secret 明文，证据不足明确 NOT_VERIFIED
//
// 版权所有 (C) 2026 AGRSEarth 项目
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { socksDispatcher } from "fetch-socks";
import { spawn } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "..", "..");

// ---------- 运行模式判别（模板仓=团队日常使用；平台仓=事实源自检/本地工具）----------
const MODE = await fs.stat(path.join(ROOT, "tools", "publish.sh"))
  .then(() => "template", () => "platform");

// ---------- 仓根 .env.local 读取（进程环境优先；gitignored，不落仓）----------
const LOCAL_ENV = {};
try {
  const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith("#")) LOCAL_ENV[m[1]] = m[2];
  }
} catch { /* .env.local 不存在时静默 */ }

// ---------- 用户级非密配置（~/.config/agrsearth/config.json；token 不落此文件）----------
const USER_CONFIG = {};
try {
  const parsed = JSON.parse(await fs.readFile(
    path.join(os.homedir(), ".config", "agrsearth", "config.json"), "utf8"));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(USER_CONFIG, parsed);
} catch { /* config.json 不存在/非法时静默 */ }

// ---------- 可覆盖的环境配置（process.env > 仓根 .env.local > 用户级 config.json > 默认值）----------
function envValue(name, fallback) {
  return process.env[name] || LOCAL_ENV[name] || USER_CONFIG[name] || fallback;
}
function httpUrl(name, value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} 仅支持 http/https URL：${value}`);
  }
  return value.replace(/\/+$/, "");
}
function portValue(name, value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1-65535 的整数端口：${value}`);
  }
  return port;
}

const DEV_BASE = httpUrl("AGRSEARTH_DEV_BASE", envValue("AGRSEARTH_DEV_BASE", "http://10.82.11.51:18801"));
const DC_API = httpUrl("AGRSEARTH_DC_API_BASE", envValue("AGRSEARTH_DC_API_BASE", `${DEV_BASE}/developer-center/api/v1`));
const NATIVE_SESSION_URL = httpUrl("AGRSEARTH_NATIVE_SESSION_URL",
  envValue("AGRSEARTH_NATIVE_SESSION_URL", `${DEV_BASE}/auth/casdoor/native-session`));
const NATIVE_CALLBACK_URL = httpUrl("AGRSEARTH_NATIVE_CALLBACK_URL",
  envValue("AGRSEARTH_NATIVE_CALLBACK_URL", `${DEV_BASE}/auth/casdoor/native-callback`));
const NATIVE_CLIENT_ID = envValue("AGRSEARTH_DEV_CLIENT_ID", "agrsearth-dev-cli");
const FIXED_LOOPBACK_PORT = envValue("AGRSEARTH_LOOPBACK_PORT", "");
const LOOPBACK_PORT_MIN = portValue("AGRSEARTH_LOOPBACK_PORT_MIN",
  envValue("AGRSEARTH_LOOPBACK_PORT_MIN", FIXED_LOOPBACK_PORT || "49152"));
const LOOPBACK_PORT_MAX = portValue("AGRSEARTH_LOOPBACK_PORT_MAX",
  envValue("AGRSEARTH_LOOPBACK_PORT_MAX", FIXED_LOOPBACK_PORT || "65535"));
if (LOOPBACK_PORT_MIN > LOOPBACK_PORT_MAX) {
  throw new Error(`回跳端口段起止颠倒：${LOOPBACK_PORT_MIN}-${LOOPBACK_PORT_MAX}`);
}
const TOKEN_FILE = envValue("AGRSEARTH_TOKEN_FILE",
  path.join(os.homedir(), ".config", "agrsearth", "dev-mcp-token.json"));

export function parseSocksProxy(value) {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "socks5:" && parsed.protocol !== "socks5h:") {
    throw new Error(`AGRSEARTH_SOCKS_PROXY 仅支持 socks5:// 或 socks5h://：${parsed.protocol}`);
  }
  const options = {
    type: 5,
    host: parsed.hostname,
    port: parsed.port ? portValue("AGRSEARTH_SOCKS_PROXY 端口", parsed.port) : 1080,
  };
  if (parsed.username) options.userId = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  return options;
}
const SOCKS_OPTIONS = parseSocksProxy(envValue("AGRSEARTH_SOCKS_PROXY", envValue("SOCKS_PROXY", "")));
const SOCKS_DISPATCHER = SOCKS_OPTIONS ? socksDispatcher(SOCKS_OPTIONS) : null;
function fetchOptions() {
  return SOCKS_DISPATCHER ? { dispatcher: SOCKS_DISPATCHER } : {};
}
export const DEV_MCP_CONFIG = Object.freeze({
  devBase: DEV_BASE, dcApi: DC_API, nativeSessionUrl: NATIVE_SESSION_URL,
  nativeCallbackUrl: NATIVE_CALLBACK_URL, nativeClientId: NATIVE_CLIENT_ID,
  loopbackPortMin: LOOPBACK_PORT_MIN, loopbackPortMax: LOOPBACK_PORT_MAX,
  socksProxyEnabled: Boolean(SOCKS_OPTIONS),
});

// =============================================================================
// 令牌解析（优先级：AGRSEARTH_TOKEN 环境变量 > ~/.config/agrsearth 文件 > 仓根 .env.local）
// =============================================================================

async function loadTokenFile() {
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.access_token === "string" && parsed.access_token) return parsed;
    return null;
  } catch { return null; }
}
export { loadTokenFile };

async function resolveToken() {
  if (process.env.AGRSEARTH_TOKEN) {
    return { token: process.env.AGRSEARTH_TOKEN, source: "env:AGRSEARTH_TOKEN" };
  }
  const saved = await loadTokenFile();
  if (saved) return { token: saved.access_token, source: `file:${TOKEN_FILE}`, saved };
  if (LOCAL_ENV.AGRSEARTH_TOKEN) {
    return { token: LOCAL_ENV.AGRSEARTH_TOKEN, source: "repo:.env.local(legacy)" };
  }
  throw new Error(
    "未找到可用凭据：请先调用 auth_login（浏览器授权登录，自动落盘），"
    + "或设置环境变量 AGRSEARTH_TOKEN（CI 场景）；auth_login 需要可访问 Casdoor 的桌面环境",
  );
}

async function saveTokenFile(payload) {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  await fs.chmod(TOKEN_FILE, 0o600).catch(() => {});
}
export { saveTokenFile };

async function clearTokenFile() {
  await fs.rm(TOKEN_FILE, { force: true });
}
export { clearTokenFile };

// =============================================================================
// PKCE（RFC 7636，node:crypto 自实现，无新依赖）
// =============================================================================

/** RFC 7636 §4.2：S256(codeVerifier) = SHA-256 的 base64url（无填充）编码，定长 43 字符 */
export function computeS256Challenge(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

/** 生成 code_verifier（64 位 unreserved 字符，满足 43-128 区间）与对应 S256 挑战 */
export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(48).toString("base64url"); // 64 字符
  return { codeVerifier, codeChallenge: computeS256Challenge(codeVerifier) };
}

export function randomLoopbackPort() {
  return LOOPBACK_PORT_MIN + crypto.randomInt(LOOPBACK_PORT_MAX - LOOPBACK_PORT_MIN + 1);
}

/** listen 瞬态可重试错误码：端口被撞/被瞬时保留，换个端口即可，其余错误码才致命 */
const RETRYABLE_LISTEN_CODES = new Set(["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"]);

/**
 * 在 49152-65535 段随机挑空闲端口起 loopback 监听（EADDRINUSE/EACCES/EADDRNOTAVAIL
 * 等瞬态错误重试，最多 30 次）。injectFailure 仅测试用：返回 Error 即模拟本次 listen 失败。
 */
export async function listenLoopback(handler, injectFailure = null) {
  const server = http.createServer(handler);
  let lastErr = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = randomLoopbackPort();
    try {
      const injected = injectFailure?.(attempt, port);
      if (injected) throw injected;
      return await new Promise((resolve, reject) => {
        const onErr = (e) => reject(e);
        server.once("error", onErr);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", onErr);
          resolve({ server, port });
        });
      });
    } catch (e) {
      lastErr = e;
      if (RETRYABLE_LISTEN_CODES.has(e.code)) continue;
      throw e;
    }
  }
  throw new Error(
    `loopback 监听失败：${LOOPBACK_PORT_MIN}-${LOOPBACK_PORT_MAX} 段随机尝试 30 个端口均被拒绝`
    + `（最后一次 ${lastErr?.code || "未知错误"}: ${lastErr?.message || "无详情"}）。`
    + `EADDRINUSE/EACCES 多为端口瞬时占用，可直接重调 auth_login_start；`
    + `持续失败请检查本机端口保留区间与安全软件拦截`,
  );
}

// =============================================================================
// 通用执行器（本地脚本包装；stdout 为 MCP 协议通道，子进程输出一律只进结果文本）
// =============================================================================

export function bashCommand(platform = process.platform, env = process.env) {
  return env.AGRSEARTH_BASH || (platform === "win32" ? "bash.exe" : "bash");
}

function run(cmd, args, { input, timeoutMs = 60000, cwd = ROOT, env } = {}) {
  return new Promise((resolve) => {
    // env 为可选覆盖：与 process.env 合并后仅作用于该子进程（如向 publish.mjs 注入
    // AGRSEARTH_TOKEN），不改本进程环境，也绝不进入任何输出与审计
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env });
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
  if (maxLines === 0) return text;
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

/** 本地写操作 reason 闸口（双形态工具在 handler 内按 action 调用） */
function reasonMissing(args) {
  return !args?.reason || String(args.reason).trim().length < 4;
}

function reasonFail(tool, action) {
  return fail(`写操作 ${tool}${action ? `（${action}）` : ""} 必须携带 reason 参数（≥4 字符，说明操作事由），已拒绝执行`);
}

// =============================================================================
// HTTP 客户端（auth 原生端点 + DC API）
// =============================================================================

async function postJson(url, body, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      ...fetchOptions(),
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    return { status: resp.status, text, parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function dcFetch(apiPath, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const { token } = await resolveToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${DC_API}${apiPath}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      ...fetchOptions(),
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    return { status: resp.status, text, parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** DC 结果统一格式化：HTTP 状态 + 美化 JSON；HTTP≥400 或业务 code≠200 判失败（不记日志） */
function dcResult({ status, text, parsed }, maxLines) {
  let body = text;
  if (parsed) body = JSON.stringify(parsed, null, 2);
  const head = `HTTP ${status}`;
  const out = body.trim() ? `${head}\n${body}` : head;
  const bizCode = parsed && typeof parsed.code === "number" ? parsed.code : null;
  if (status >= 400 || (bizCode !== null && bizCode !== 200)) return fail(out);
  return ok(out, maxLines);
}

/** auth 原生端点取 R<?> data（失败时抛出含服务端 msg 的可读错误） */
function rData({ status, text, parsed }, what) {
  if (parsed && typeof parsed.code === "number") {
    if (parsed.code !== 200) {
      throw new Error(`${what} 失败（HTTP ${status}）：${parsed.msg || JSON.stringify(parsed)}`);
    }
    return parsed.data;
  }
  throw new Error(`${what} 失败（HTTP ${status}，非 R 响应）：${truncate(text, 20).slice(0, 500)}`);
}

// =============================================================================
// 审计日志（logs/operations/dev-mcp-<日期>.jsonl，gitignored；只记参数/结果码，不记响应体）
// =============================================================================

const AUDIT_DIR = path.join(ROOT, "logs", "operations");
// 整工具写操作（经 wrapper 闸 reason）；双形态工具的写 action 在 handler 内闸
const WRITE_TOOLS = new Set(["package_publish", "package_register"]);
const SECRET_KEY_RE = /token|password|secret|authorization|credential|api[-_]?key|code_verifier/i;

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

// =============================================================================
// server
// =============================================================================

const server = new McpServer({
  name: "agrsearth-dev",
  version: "1.7.0",
});

const rawRegisterTool = server.registerTool.bind(server);
server.registerTool = (name, config, handler) =>
  rawRegisterTool(name, config, async (args, extra) => {
    if (WRITE_TOOLS.has(name) && reasonMissing(args)) {
      await audit({ tool: name, args: sanitizeArgs(args), ok: false, error: "写操作缺少 reason（≥4 字符），闸口拒绝" });
      return reasonFail(name);
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
      ...(WRITE_TOOLS.has(name) || args?.reason ? { reason: args.reason } : {}),
    });
    return result;
  });

const reasonField = z.string().min(4)
  .describe("操作事由（写操作必填，≥4 字符）：审计留痕用，简述为什么做这次变更");

const pkgDirField = z.string()
  .describe("扩展包目录（仓内相对路径），如 extensions/tool/business/wind-field（目录唯一规则，不含 ..）");

function assertPkgDir(pkgDir) {
  if (pkgDir.includes("..") || path.isAbsolute(pkgDir)) throw new Error("pkgDir 须为仓内相对路径且不含 ..");
}

/** 包 ID 形态（与 package_register 服务端校验同口径：小写字母/数字/中划线，防路径注入） */
const PKG_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function assertPkgId(packageId) {
  if (!PKG_ID_RE.test(packageId)) throw new Error("packageId 含非法字符（仅允许小写字母/数字/中划线）");
}

/** DC 远端调用的统一兜底：凭据/网络错误转成可读 fail（不抛栈给模型） */
async function dcCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return fail(`请求失败：${e.message}`);
  }
}

// ===== 1. docs_read：契约文档取读 =====

server.registerTool("docs_read", {
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

// ===== 2. package_scaffold：脚手架建包 =====

server.registerTool("package_scaffold", {
  description: MODE === "template"
    ? "脚手架建包（Node 直调 tools/create-extension.mjs，不经 bash/python）：按 track/tier 实例化骨架到 extensions/<track>/<tier>/<id>/，可选后端/管理端骨架。本地操作，可逆（删目录即撤销）。"
    : "脚手架建包（平台仓模式，Node 直调 scripts/create-extension.mjs，不经 bash/python）：实例化到 extensions/<track>/<tier>/<id>/。",
  inputSchema: {
    id: z.string().describe("包 ID（小写字母/数字/中划线），如 wind-field"),
    track: z.enum(["tool", "system"]).describe("tool=轻量工具轨；system=子系统轨"),
    tier: z.enum(["platform", "business"]).describe("platform=服务平台自身；business=服务业务场景"),
    name: z.string().optional().describe("中文显示名"),
    delivery: z.enum(["bundled", "optional"]).optional().describe("交付形态（仅 tool·business 有意义；bundled=全员标配，optional=选装）"),
    withBackend: z.boolean().default(false).describe("生成后端服务骨架（backend/ + container/）"),
    withAdminUi: z.boolean().default(false).describe("生成管理端页面骨架（admin-ui/）"),
  },
}, async ({ id, track, tier, name, delivery, withBackend, withAdminUi }) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return fail("包 ID 仅允许小写字母/数字/中划线");
  const script = MODE === "template" ? "tools/create-extension.mjs" : "scripts/create-extension.mjs";
  const args = [script, id, "--track", track, "--tier", tier];
  if (name) args.push("--name", name);
  if (delivery) args.push("--delivery", delivery);
  if (withBackend) args.push("--with-backend");
  if (withAdminUi) {
    if (MODE !== "template") return fail("平台仓脚手架不支持管理端页面骨架（--with-admin-ui 为模板仓能力）");
    args.push("--with-admin-ui");
  }
  return fmt(await run(process.execPath, args, { timeoutMs: 120000 }), 150);
});

// ===== 3. package_precheck：发布前预检 =====

server.registerTool("package_precheck", {
  description: MODE === "template"
    ? "发布前预检：直接以 Node 执行 publish.mjs --check-only（目录/manifest/components/menu/版本/组件版本轴/前后端 URL 契约），零网络、零副作用；不经 bash/python。"
    : "发布前预检（平台仓模式）：publish-extension.sh --check-only 全闸口（manifest/track/tier/components/menu.json/号段台账/权限对账）。零副作用。",
  inputSchema: {
    pkgDir: pkgDirField,
  },
}, async ({ pkgDir }) => {
  assertPkgDir(pkgDir);
  if (MODE === "template") {
    return fmt(await run(process.execPath, ["tools/publish.mjs", pkgDir, "--check-only"], { timeoutMs: 120000 }), 250);
  }
  return fmt(await run(bashCommand(), ["scripts/publish-extension.sh", pkgDir, "--check-only"], { timeoutMs: 300000 }), 250);
});

// ===== 3.1 package_contract_check：前后端 URL 契约对账 =====

server.registerTool("package_contract_check", {
  description: "前后端 URL 契约对账：模板仓模式以 Node 执行 tools/check-api-contract.mjs，双向 diff 前端/管理页 src/api/index.ts 与公开后端 Spring Mapping 全路径，并检查业务文件散落服务 URL；零网络、零副作用。平台仓模式不适用。",
  inputSchema: {
    pkgDir: pkgDirField,
  },
}, async ({ pkgDir }) => {
  assertPkgDir(pkgDir);
  if (MODE !== "template") {
    return fail("package_contract_check 仅适用于模板仓；平台仓模式无 tools/check-api-contract.mjs，请先在模板仓执行该检查");
  }
  const result = await run(process.execPath, ["tools/check-api-contract.mjs", pkgDir], { timeoutMs: 120000 });
  const output = fmt(result, 250);
  if (result.code !== 0) output.isError = true;
  return output;
});

// ===== 4. package_publish：发布（整工具写操作，wrapper 闸 reason） =====

server.registerTool("package_publish", {
  description: "【写操作，需审批】发布扩展包到 aiearth01 共享开发调试环境（直接以 Node 执行 tools/publish.mjs，不经 bash：DC release-prepare → upload-sessions + MinIO PostPolicy → complete → release-complete；allowedSecretRefs 仅服务端计算）。执行前先 resolveToken（auth_login 落盘文件 / AGRSEARTH_TOKEN 环境变量同源），令牌仅以 AGRSEARTH_TOKEN 注入 publish.mjs 子进程环境——绝不打印、不进审计；未登录时明确报错并指引 auth_login。入口闸 developercenter:package:manage + 包 owner/grant + PUBLISH capability。prod 一律拒绝；deploy=true 追加触发部署。",
  inputSchema: {
    pkgDir: pkgDirField,
    skipBuild: z.boolean().default(false).describe("跳过前端构建（复用已有产物）"),
    deploy: z.boolean().default(false).describe("发布后追加触发部署"),
    reason: reasonField.optional().describe("写操作必填（wrapper 闸口校验 ≥4 字符）"),
  },
}, async ({ pkgDir, skipBuild, deploy, reason }) => {
  if (MODE !== "template") {
    return fail("平台仓模式下请使用 agrsearth-ops 的 publish_extension 工具；package_publish 面向模板仓（第三方团队）");
  }
  assertPkgDir(pkgDir);
  let resolved;
  try {
    resolved = await resolveToken();
  } catch (e) {
    return fail(e.message);
  }
  const args = ["tools/publish.mjs", pkgDir];
  if (skipBuild) args.push("--skip-build");
  if (deploy) args.push("--deploy");
  return fmt(await run(process.execPath, args, {
    timeoutMs: 1800000,
    env: { AGRSEARTH_TOKEN: resolved.token },
  }), 400);
});

// ===== 5. package_list：我可见的扩展包（DC GET /packages） =====

server.registerTool("package_list", {
  description: "查开发者中心「我可见的扩展包」分页列表（归属团队 ∪ 授权；DC GET /packages，TableDataInfo 形态）。需先 auth_login 或配置 AGRSEARTH_TOKEN。",
  inputSchema: {
    keyword: z.string().optional().describe("包 ID/名称关键字模糊过滤"),
    track: z.enum(["tool", "system"]).optional().describe("按轨过滤"),
    tier: z.enum(["platform", "business"]).optional().describe("按层过滤"),
    pageNum: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(100).default(10).describe("每页条数"),
  },
}, async ({ keyword, track, tier, pageNum, pageSize }) => {
  return dcCall(async () => {
    const qs = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
    if (keyword) qs.set("keyword", keyword);
    if (track) qs.set("track", track);
    if (tier) qs.set("tier", tier);
    return dcResult(await dcFetch(`/packages?${qs}`), 200);
  });
});

// ===== 6. package_register：注册扩展包（DC POST /packages/register，写操作） =====

server.registerTool("package_register", {
  description: "【写操作，需审批】以归属团队名义注册扩展包（DC POST /packages/register）：packageId 唯一 owner（dc_package_owner 唯一索引兜底冲突），resources.postgres/menu 为资源位开关（契约固定键，不另起 minio/registry）。HTTP 200 仅表示登记与任务受理；响应 provisionTaskId/provisionStatus 是发放真相，必须继续 task_get 跟踪到 ACTIVE 才发布，PARTIAL/ERROR 时先 task_retry 或排障，不得视为注册完成。",
  inputSchema: {
    packageId: z.string().min(2).describe("包 ID（小写字母/数字/中划线，如 wind-field）"),
    packageName: z.string().min(1).describe("包显示名"),
    track: z.enum(["tool", "system"]).describe("tool=轻量工具轨；system=子系统轨"),
    tier: z.enum(["platform", "business"]).describe("platform=服务平台自身；business=服务业务场景"),
    teamId: z.number().int().positive().describe("归属团队 ID（team_list 可查；须为该团队 TEAM_MAINTAINER 及以上）"),
    postgres: z.boolean().default(false).describe("资源位：PostgreSQL schema 资源位（发放编排执行器开通）"),
    menu: z.boolean().default(false).describe("资源位：publish 时经 menu-provision 幂等落地菜单"),
    reason: reasonField.optional().describe("写操作必填（wrapper 闸口校验 ≥4 字符）"),
  },
}, async ({ packageId, packageName, track, tier, teamId, postgres, menu, reason }) => {
  try { assertPkgId(packageId); } catch (e) { return fail(e.message); }
  return dcCall(async () => dcResult(await dcFetch("/packages/register", {
    method: "POST",
    body: { packageId, packageName, track, tier, teamId, resources: { postgres, menu } },
  }), 150));
});

// ===== 7. package_manage：包委托（grants）+ 生命周期（archive/transfer；写 action 需 reason） =====

server.registerTool("package_manage", {
  description: "扩展包管理与委托：list-grants 查委托列表（GET /packages/{packageId}/grants）；create-grant 创建委托（POST，subjectType=TEAM/USER，role=TEAM_MAINTAINER/DEVELOPER/VIEWER，capabilities∈PUBLISH/PROVISION）；revoke-grant 删除委托（DELETE /grants/{grantId}）；archive 归档包（POST /packages/{packageId}/archive；TEAM_OWNER/TEAM_MAINTAINER；停止后续写操作、资源账号 NOLOGIN 数据保留、幂等）；transfer 转移归属（POST /packages/{packageId}/transfer，body {targetTeamId}；校验目标团队、菜单段保持不变；无 PG 数据直接过户，有 PG 数据建 PACKAGE_MIGRATION 显式任务并返回 migrationTaskId——用 task_get(taskId) 跟踪停写→导出→恢复→校验→切换）；remove 移除测试包（仅限 DC 测试环境：DELETE /packages/{packageId}；服务端定点回收菜单/K8s/网关，MinIO 产物移至同 Bucket `_trash/<packageId>/<时间-短ID>/` 后物理清理登记，runtime Secret 删除、PG 数据默认保留；透传 cleanupResult 与 trashPrefix/movedObjects，审计保留、不假成功）。写 action（create-grant/revoke-grant/archive/transfer/remove）需 reason。",
  inputSchema: {
    action: z.enum(["list-grants", "create-grant", "revoke-grant", "archive", "transfer", "remove"]).describe("动作"),
    packageId: z.string().describe("包 ID"),
    subjectType: z.enum(["TEAM", "USER"]).optional().describe("create-grant：委托对象类型"),
    subjectId: z.number().int().positive().optional().describe("create-grant：委托对象 ID（团队 ID 或用户 ID）"),
    subjectName: z.string().optional().describe("create-grant：委托对象显示名（服务端会复核）"),
    role: z.enum(["TEAM_MAINTAINER", "DEVELOPER", "VIEWER"]).optional().describe("create-grant：委托角色"),
    capabilities: z.array(z.enum(["PUBLISH", "PROVISION"])).optional().describe("create-grant：能力集（空=仅可见）"),
    expireTime: z.string().optional().describe("create-grant：过期时间 ISO-8601（可选，如 2027-01-01T00:00:00+08:00）"),
    grantId: z.number().int().positive().optional().describe("revoke-grant：委托 ID"),
    targetTeamId: z.number().int().positive().optional().describe("transfer：目标团队 ID（team_list 可查）"),
    reason: z.string().min(4).optional().describe("写 action 必填，≥4 字符"),
  },
}, async (args) => {
  const { action, packageId } = args;
  try { assertPkgId(packageId); } catch (e) { return fail(e.message); }
  if (action === "list-grants") {
    return dcCall(async () => dcResult(await dcFetch(`/packages/${packageId}/grants`), 150));
  }
  if (reasonMissing(args)) return reasonFail("package_manage", action);
  if (action === "create-grant") {
    if (!args.subjectType || !args.subjectId || !args.role) {
      return fail("create-grant 需要 subjectType + subjectId + role（capabilities 可选）");
    }
    const body = {
      subjectType: args.subjectType, subjectId: args.subjectId, role: args.role,
      ...(args.subjectName ? { subjectName: args.subjectName } : {}),
      ...(args.capabilities ? { capabilities: args.capabilities } : {}),
      ...(args.expireTime ? { expireTime: args.expireTime } : {}),
    };
    return dcCall(async () => dcResult(await dcFetch(`/packages/${packageId}/grants`, { method: "POST", body }), 150));
  }
  if (action === "archive") {
    return dcCall(async () => dcResult(
      await dcFetch(`/packages/${packageId}/archive`, { method: "POST" }), 150));
  }
  if (action === "remove") {
    // 仅限 DC 测试环境：服务端把 MinIO 产物移入 _trash/<packageId>/<时间-短ID>/ 后删登记；
    // 透传 trashPrefix/movedObjects 真实响应，不假成功
    return dcCall(async () => dcResult(
      await dcFetch(`/packages/${packageId}`, { method: "DELETE" }), 150));
  }
  if (action === "transfer") {
    if (!args.targetTeamId) return fail("transfer 需要 targetTeamId");
    return dcCall(async () => {
      const r = await dcFetch(`/packages/${packageId}/transfer`, {
        method: "POST", body: { targetTeamId: args.targetTeamId },
      });
      const base = dcResult(r, 200);
      if (!base.isError && r.parsed?.data?.transferred === false && r.parsed?.data?.migrationTaskId) {
        base.content[0].text += `\n\nℹ️ 有 PG 数据：已建迁移任务 migrationTaskId=${r.parsed.data.migrationTaskId}，用 task_get(taskId=${r.parsed.data.migrationTaskId}) 跟踪停写→导出→恢复→校验→切换进度。`;
      }
      return base;
    });
  }
  // revoke-grant
  if (!args.grantId) return fail("revoke-grant 需要 grantId");
  return dcCall(async () => dcResult(
    await dcFetch(`/packages/${packageId}/grants/${args.grantId}`, { method: "DELETE" }), 100));
});

// ===== 8. team_list：团队查询（DC GET /teams、/teams/{id}/members） =====

server.registerTool("team_list", {
  description: "开发者中心团队查询：list 查「我可见的团队」分页列表（成员视角，平台超管全量）；members 查团队成员分页列表。",
  inputSchema: {
    action: z.enum(["list", "members"]).describe("动作"),
    keyword: z.string().optional().describe("list：团队编码/名称关键字"),
    status: z.string().optional().describe("list：状态过滤"),
    teamId: z.number().int().positive().optional().describe("members：团队 ID"),
    pageNum: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(100).default(10).describe("每页条数"),
  },
}, async ({ action, keyword, status, teamId, pageNum, pageSize }) => {
  if (action === "members") {
    if (!teamId) return fail("members 需要 teamId");
    return dcCall(async () => dcResult(
      await dcFetch(`/teams/${teamId}/members?pageNum=${pageNum}&pageSize=${pageSize}`), 200));
  }
  const qs = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
  if (keyword) qs.set("keyword", keyword);
  if (status) qs.set("status", status);
  return dcCall(async () => dcResult(await dcFetch(`/teams?${qs}`), 200));
});

// ===== 9. team_manage：团队管理（写 action 需 reason；search-users 为配套只读） =====

server.registerTool("team_manage", {
  description: "开发者中心团队管理：create 创建团队（POST /teams，创建者自动 TEAM_OWNER）；add-member 加成员（userId 或 username + teamRole）；update-role 变更成员角色（所有者不可经接口变更）；remove-member 移除成员；search-users 平台用户窄检索（GET /platform-users?keyword=，≤20 条）；quota_request 配额申请（POST /teams/{teamId}/quota-requests，TEAM_OWNER/TEAM_MAINTAINER；items 1-8 项 {quota:MENU_POOL|PACKAGE|PG, band?, additional:1-100}，顶层 reason 可选；创建 QUOTA_APPROVAL 任务 PENDING 待平台管理员审批）；quota_approve / quota_reject 配额审批（平台管理员；POST /tasks/{taskId}/quota-approve 无 body 抬升配额 / quota-reject 驳回终态 REVOKED 不动配额、body {reason} 透传；经 task_get 查 QUOTA_APPROVAL 任务）。写 action 全部需 reason（≥4 字符）。",
  inputSchema: {
    action: z.enum(["create", "add-member", "update-role", "remove-member", "search-users", "quota_request", "quota_approve", "quota_reject"]).describe("动作"),
    code: z.string().optional().describe("create：团队编码"),
    name: z.string().optional().describe("create：团队名称"),
    description: z.string().optional().describe("create：团队描述"),
    teamId: z.number().int().positive().optional().describe("add-member/update-role/remove-member/quota_request：团队 ID"),
    userId: z.number().int().positive().optional().describe("add-member：平台用户 ID"),
    username: z.string().optional().describe("add-member：平台用户名（userId/username 二选一）"),
    memberId: z.number().int().positive().optional().describe("update-role/remove-member：成员 ID"),
    teamRole: z.enum(["TEAM_OWNER", "TEAM_MAINTAINER", "DEVELOPER", "VIEWER"]).optional().describe("add-member/update-role：团队角色"),
    keyword: z.string().optional().describe("search-users：检索关键字（必填）"),
    items: z.array(z.object({
      quota: z.enum(["MENU_POOL", "PACKAGE", "PG"]).describe("配额轴：MENU_POOL=菜单号段池 / PACKAGE=包数 / PG=PG schema"),
      band: z.string().max(16).optional().describe("菜单段 band（仅 MENU_POOL 用，如 6xxx/7xxx；DC 菜单段服务口径）"),
      additional: z.number().int().min(1).max(100).describe("申请增量（单次 1-100）"),
    })).min(1).max(8).optional().describe("quota_request：申请项列表（1-8 项；服务端字段名 quota，非 type）"),
    taskId: z.number().int().positive().optional().describe("quota_approve/quota_reject：QUOTA_APPROVAL 任务 ID（task_get 可查）"),
    reason: z.string().min(4).optional().describe("写 action 必填，≥4 字符；quota_request 时兼作服务端顶层 reason，quota_reject 时透传服务端驳回原因"),
  },
}, async (args) => {
  const { action } = args;
  if (action === "search-users") {
    if (!args.keyword || !args.keyword.trim()) return fail("search-users 需要 keyword");
    return dcCall(async () => dcResult(
      await dcFetch(`/platform-users?keyword=${encodeURIComponent(args.keyword.trim())}`), 100));
  }
  const WRITE_ACTIONS = new Set([
    "create", "add-member", "update-role", "remove-member",
    "quota_request", "quota_approve", "quota_reject",
  ]);
  if (WRITE_ACTIONS.has(action) && reasonMissing(args)) return reasonFail("team_manage", action);
  if (action === "create") {
    if (!args.code || !args.name) return fail("create 需要 code + name");
    return dcCall(async () => dcResult(await dcFetch("/teams", {
      method: "POST",
      body: { code: args.code, name: args.name, ...(args.description ? { description: args.description } : {}) },
    }), 150));
  }
  if (action === "quota_request") {
    if (!args.teamId) return fail("quota_request 需要 teamId");
    if (!args.items || args.items.length === 0) return fail("quota_request 需要 items（1-8 项 {quota,band?,additional}）");
    return dcCall(async () => {
      const r = await dcFetch(`/teams/${args.teamId}/quota-requests`, {
        method: "POST",
        body: { items: args.items, ...(args.reason ? { reason: args.reason } : {}) },
      });
      const base = dcResult(r, 200);
      if (!base.isError) {
        base.content[0].text += "\n\nℹ️ 已创建 QUOTA_APPROVAL 任务（PENDING）：平台管理员经 team_manage action=quota_approve/quota_reject 审批；进度用 task_get 查看。";
      }
      return base;
    });
  }
  if (action === "quota_approve" || action === "quota_reject") {
    if (!args.taskId) return fail(`${action} 需要 taskId（QUOTA_APPROVAL 任务，task_get 可查）`);
    const body = action === "quota_reject" && args.reason ? { reason: args.reason } : undefined;
    return dcCall(async () => dcResult(
      await dcFetch(`/tasks/${args.taskId}/${action === "quota_approve" ? "quota-approve" : "quota-reject"}`,
        { method: "POST", ...(body ? { body } : {}) }), 200));
  }
  if (!args.teamId) return fail(`${action} 需要 teamId`);
  if (action === "add-member") {
    if (!args.userId && !args.username) return fail("add-member 需要 userId 或 username");
    if (!args.teamRole) return fail("add-member 需要 teamRole");
    const body = { teamRole: args.teamRole };
    if (args.userId) body.userId = args.userId; else body.username = args.username;
    return dcCall(async () => dcResult(await dcFetch(`/teams/${args.teamId}/members`, { method: "POST", body }), 150));
  }
  if (!args.memberId) return fail(`${action} 需要 memberId`);
  if (action === "update-role") {
    if (!args.teamRole) return fail("update-role 需要 teamRole");
    return dcCall(async () => dcResult(
      await dcFetch(`/teams/${args.teamId}/members/${args.memberId}`, { method: "PUT", body: { teamRole: args.teamRole } }), 150));
  }
  // remove-member
  return dcCall(async () => dcResult(
    await dcFetch(`/teams/${args.teamId}/members/${args.memberId}`, { method: "DELETE" }), 100));
});

// ===== 10-13. resource_*：PG 账号资源（DC ResourceController + TeamResourceController） =====
// pg-dev（包级开发账号）：GET /packages/{packageId}/resources + POST .../pg-dev/{issue|rotate|revoke}
// pg-admin（团队级管理账号）：POST /teams/{teamId}/resources/pg-admin/{issue|rotate|revoke}（无列表端点）
// 红线：runtime 密码只写 Secret、不经 controller（DC 设计）；本工具只透传响应、审计不记响应体；
//       账号 subject 恒为当前登录者本人，不存在代申/服务号通道。

const PG_DEV_NOTS = "pg-dev=包级开发账号（权限点 developercenter:package:* + 归属团队活跃成员二次校验，锚点 packageId）";
const PG_ADMIN_NOTS = "pg-admin=团队级管理账号（权限点 developercenter:team:manage + TEAM_OWNER/TEAM_MAINTAINER，锚点 teamId；owner group 成员短 TTL）";
const PG_COMMON_NOTS = "账号 subject 恒为当前登录者本人（不存在代申/服务号通道）；runtime 密码不经本通道";

/** 按 scope 解析资源账号端点锚点：pg-dev→packageId，pg-admin→teamId */
function resolveResourceAnchor(scope, packageId, teamId) {
  if (scope === "pg-admin") {
    if (!teamId || !Number.isInteger(teamId) || teamId <= 0) {
      throw new Error("scope=pg-admin 需要 teamId（正整数）");
    }
    return { base: `/teams/${teamId}/resources/pg-admin` };
  }
  if (!PKG_ID_RE.test(packageId || "")) {
    throw new Error("scope=pg-dev 需要合法 packageId（小写字母/数字/中划线）");
  }
  return { base: `/packages/${packageId}/resources/pg-dev` };
}

server.registerTool("resource_list", {
  description: `查扩展包资源位列表（DC GET /packages/{packageId}/resources）：声明位 + 发放回填引用 + PG 开发租约数/菜单段。${PG_DEV_NOTS}。注意：pg-admin 为团队级账号、无资源位列表示端点——账号状态经 resource_issue(scope=pg-admin) 幂等返回的元数据查看；scope='pg-admin' 会被明确拒绝。`,
  inputSchema: {
    packageId: z.string().describe("包 ID"),
    scope: z.string().optional().describe("客户端过滤：只显示 resourceType/resourceKey 含该串的资源位；传 pg-admin 将明确拒绝（无团队资源位列表端点）"),
  },
}, async ({ packageId, scope }) => {
  try { assertPkgId(packageId); } catch (e) { return fail(e.message); }
  if (scope === "pg-admin") {
    return fail("scope=pg-admin 无列表示端点（pg-admin 是团队级账号而非包资源位）：账号元数据经 resource_issue(scope=pg-admin, teamId=…) 幂等返回；如需团队资源位请先回到包级视角查 packageId 对应资源");
  }
  return dcCall(async () => {
    const r = await dcFetch(`/packages/${packageId}/resources`);
    if (scope && r.parsed && r.parsed.code === 200 && Array.isArray(r.parsed.data)) {
      const needle = scope.toLowerCase();
      const rows = r.parsed.data.filter((s) =>
        String(s.resourceType || "").toLowerCase().includes(needle)
        || String(s.resourceKey || "").toLowerCase().includes(needle));
      return ok(`HTTP ${r.status}\n${JSON.stringify({ code: 200, rows: rows.length, note: `scope='${scope}' 客户端过滤（原始 ${r.parsed.data.length} 条）`, data: rows }, null, 2)}`, 150);
    }
    return dcResult(r, 150);
  });
});

server.registerTool("resource_issue", {
  description: `【写操作】签发本人 PG 账号（幂等——已有有效账号只返回元数据 newlyIssued=false；新签发一次性返回密码，仅此一次请立即保存，本工具不落盘、审计不记响应）。scope=pg-dev → DC POST /packages/{packageId}/resources/pg-dev/issue（${PG_DEV_NOTS}）；scope=pg-admin → DC POST /teams/{teamId}/resources/pg-admin/issue（${PG_ADMIN_NOTS}）。ttlSeconds 300-86400（服务端再钳制，缺省用平台配置）。${PG_COMMON_NOTS}。`,
  inputSchema: {
    packageId: z.string().optional().describe("包 ID（scope=pg-dev 必填）"),
    teamId: z.number().int().positive().optional().describe("团队 ID（scope=pg-admin 必填，team_list 可查）"),
    scope: z.enum(["pg-dev", "pg-admin"]).default("pg-dev").describe("资源域：pg-dev=包级开发账号（锚点 packageId）；pg-admin=团队级管理账号（锚点 teamId）"),
    ttlSeconds: z.number().int().min(300).max(86400).optional().describe("凭据有效期秒数（300-86400；缺省用服务端默认）"),
    reason: z.string().min(4).optional().describe("写操作必填（handler 闸口校验 ≥4 字符）"),
  },
}, async ({ packageId, teamId, scope, ttlSeconds, reason }) => {
  let anchor;
  try { anchor = resolveResourceAnchor(scope, packageId, teamId); } catch (e) { return fail(e.message); }
  if (reasonMissing({ reason })) return reasonFail("resource_issue", scope);
  return dcCall(async () => {
    const r = await dcFetch(`${anchor.base}/issue`, {
      method: "POST",
      body: ttlSeconds ? { ttlSeconds } : {},
    });
    const base = dcResult(r, 150);
    if (!base.isError && r.parsed?.data?.newlyIssued) {
      base.content[0].text += "\n\n⚠️ 本次为新签发：password 字段仅此一次性返回，请立即保存；重发/审计/日志均不再出现。";
    }
    return base;
  });
});

server.registerTool("resource_rotate", {
  description: `【写操作】强制轮换本人 PG 账号口令并重置短 TTL（须有有效租约，新密码一次性返回）。scope=pg-dev → DC POST /packages/{packageId}/resources/pg-dev/rotate；scope=pg-admin → DC POST /teams/{teamId}/resources/pg-admin/rotate（吊销时回收 owner group 成员身份）。${PG_COMMON_NOTS}。`,
  inputSchema: {
    packageId: z.string().optional().describe("包 ID（scope=pg-dev 必填）"),
    teamId: z.number().int().positive().optional().describe("团队 ID（scope=pg-admin 必填）"),
    scope: z.enum(["pg-dev", "pg-admin"]).default("pg-dev").describe("资源域：pg-dev=包级开发账号；pg-admin=团队级管理账号"),
    reason: z.string().min(4).optional().describe("写操作必填（handler 闸口校验 ≥4 字符）"),
  },
}, async ({ packageId, teamId, scope, reason }) => {
  let anchor;
  try { anchor = resolveResourceAnchor(scope, packageId, teamId); } catch (e) { return fail(e.message); }
  if (reasonMissing({ reason })) return reasonFail("resource_rotate", scope);
  return dcCall(async () => {
    const r = await dcFetch(`${anchor.base}/rotate`, { method: "POST" });
    const base = dcResult(r, 150);
    if (!base.isError) {
      base.content[0].text += "\n\n⚠️ 轮换后新 password 仅此一次性返回，请立即保存并更新本机配置。";
    }
    return base;
  });
});

server.registerTool("resource_revoke", {
  description: `【写操作】吊销本人 PG 账号（立即 NOLOGIN + 回收授权）。scope=pg-dev → DC POST /packages/{packageId}/resources/pg-dev/revoke；scope=pg-admin → DC POST /teams/{teamId}/resources/pg-admin/revoke（同时回收 owner group 成员身份）。${PG_COMMON_NOTS}。`,
  inputSchema: {
    packageId: z.string().optional().describe("包 ID（scope=pg-dev 必填）"),
    teamId: z.number().int().positive().optional().describe("团队 ID（scope=pg-admin 必填）"),
    scope: z.enum(["pg-dev", "pg-admin"]).default("pg-dev").describe("资源域：pg-dev=包级开发账号；pg-admin=团队级管理账号"),
    reason: z.string().min(4).optional().describe("写操作必填（handler 闸口校验 ≥4 字符）"),
  },
}, async ({ packageId, teamId, scope, reason }) => {
  let anchor;
  try { anchor = resolveResourceAnchor(scope, packageId, teamId); } catch (e) { return fail(e.message); }
  if (reasonMissing({ reason })) return reasonFail("resource_revoke", scope);
  return dcCall(async () => dcResult(
    await dcFetch(`${anchor.base}/revoke`, { method: "POST" }), 100));
});

// ===== 14-15. instance_*：运行运维门面（DC RuntimeOpsController，P2 已实现） =====
// GET /instances?packageId=&status=（packageId 必填；读授权未过一律 404，不暴露存在性）
// GET /instances/{id}/logs?tailLines=N（服务端 LogMasker 逐行脱敏：只掩值不掩键；
// 尾部行数由 tailLines 查询参数控制：1-2000，默认 500）
// GET /instances/{id}/tasks（实例运维任务，per-instance；与发放任务 /tasks 相互独立）

const INSTANCE_ID_RE = /^(?!.*\.\.)[\w.-]+$/;

server.registerTool("instance_list", {
  description: "查扩展包的运行实例列表（DC GET /instances）：packageId 必填（团队数据范围锚点，禁全量拉取），status 可选过滤；读授权未过一律 404（不暴露存在性），404 如实透传不reinterpret。",
  inputSchema: {
    packageId: z.string().describe("包 ID（必填，授权锚点）"),
    status: z.string().optional().describe("实例状态过滤（可空，如 RUNNING / STOPPED）"),
  },
}, async ({ packageId, status }) => {
  try { assertPkgId(packageId); } catch (e) { return fail(e.message); }
  return dcCall(async () => {
    const qs = new URLSearchParams({ packageId });
    if (status) qs.set("status", status);
    return dcResult(await dcFetch(`/instances?${qs}`), 200);
  });
});

server.registerTool("instance_logs", {
  description: "查实例日志或实例运维任务（DC 门面）：tasks=false → GET /instances/{id}/logs?tailLines=N（instanceId→packageId 反查授权，未授权 404；日志服务端已逐行脱敏只掩值不掩键；tailLines 控制返回尾部行数 1-2000、默认 500，MCP 不再二次截断 JSON）；tasks=true → GET /instances/{id}/tasks（per-instance 运维任务，与发放任务 /tasks 不同源，tailLines 忽略）。",
  inputSchema: {
    instanceId: z.string().describe("实例 ID（instance_list 返回）"),
    tasks: z.boolean().default(false).describe("true 查实例运维任务（/instances/{id}/tasks）；false 查日志"),
    tailLines: z.number().int().min(1).max(2000).default(500)
      .describe("日志尾部行数（1-2000，默认 500；仅 tasks=false 生效，tasks=true 时忽略）"),
  },
}, async ({ instanceId, tasks, tailLines }) => {
  if (!INSTANCE_ID_RE.test(instanceId)) return fail("instanceId 含非法字符（仅允许字母/数字/中划线/点，禁 ..）");
  return dcCall(async () => {
    if (tasks) {
      return dcResult(await dcFetch(`/instances/${instanceId}/tasks`), 150);
    }
    const qs = new URLSearchParams({ tailLines: String(tailLines) });
    return dcResult(await dcFetch(`/instances/${instanceId}/logs?${qs}`), 0);
  });
});

// ===== 16. environment_status：授权包级只读巡检（DC GET /environment/status） =====

server.registerTool("environment_status", {
  description: "查授权包级只读巡检（DC GET /environment/status?packageId=）：Pod 就绪/重启/实际镜像、实例健康、发放任务、PostgreSQL schema/runtime 状态、运行时 Secret 有效性的证据状态、菜单号段、产物 URL 与版本一致性。packageId 必填且限授权包，未授权 404；不开放全集群、节点或其他团队数据，不读取或返回 Secret 明文。证据不足时返回 NOT_VERIFIED，不伪造健康。",
  inputSchema: {
    packageId: z.string().describe("包 ID（必填，团队授权锚点）"),
  },
}, async ({ packageId }) => {
  return dcCall(async () => dcResult(
    await dcFetch(`/environment/status?${new URLSearchParams({ packageId })}`), 300));
});

// ===== 17. task_get：发放任务查询（DC GET /tasks、/tasks/{taskId}，只读） =====

server.registerTool("task_get", {
  description: "查开发者中心发放任务（只读）：带 taskId 查任务详情（含 outbox 事件轨迹）；不带则按 type/status/keyword 分页列表。全局任务全员可见，团队任务仅归属团队成员（服务端收敛）。任务类型：type=PACKAGE_MIGRATION 为包转移迁移任务（package_manage transfer 有 PG 数据时创建，status/outboxEvents 展示停写→导出→恢复→校验→切换，可配 task_retry 补失败步）；type=QUOTA_APPROVAL 为配额申请审批任务（team_manage quota_request 创建，平台管理员经 team_manage quota_approve/quota_reject 审批）。",
  inputSchema: {
    taskId: z.number().int().positive().optional().describe("任务 ID（缺省=list 分页查询）"),
    type: z.string().optional().describe("list：任务类型过滤"),
    status: z.string().optional().describe("list：状态过滤"),
    keyword: z.string().optional().describe("list：关键字过滤"),
    pageNum: z.number().int().min(1).default(1).describe("list：页码"),
    pageSize: z.number().int().min(1).max(100).default(10).describe("list：每页条数"),
  },
}, async ({ taskId, type, status, keyword, pageNum, pageSize }) => {
  if (taskId) {
    return dcCall(async () => dcResult(await dcFetch(`/tasks/${taskId}`), 200));
  }
  const qs = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
  if (type) qs.set("type", type);
  if (status) qs.set("status", status);
  if (keyword) qs.set("keyword", keyword);
  return dcCall(async () => dcResult(await dcFetch(`/tasks?${qs}`), 200));
});

// ===== 17. task_retry：幂等重试（DC POST /tasks/{taskId}/retry，P1 已实现） =====

server.registerTool("task_retry", {
  description: "【写操作】幂等重试发放任务（DC POST /tasks/{taskId}/retry）：仅 PARTIAL 或含可恢复失败步的 ERROR 任务回池 PENDING，执行器重跑只补 FAILED 步（成功步骤不重跑）；状态前置校验幂等，重复调用安全。返回重试后任务详情。",
  inputSchema: {
    taskId: z.number().int().positive().describe("任务 ID（task_get 可查）"),
    reason: z.string().min(4).optional().describe("写操作必填（handler 闸口校验 ≥4 字符）"),
  },
}, async ({ taskId, reason }) => {
  if (reasonMissing({ reason })) return reasonFail("task_retry");
  return dcCall(async () => dcResult(await dcFetch(`/tasks/${taskId}/retry`, { method: "POST" }), 200));
});

// ===== 18. hmr_get_guide：HMR 联调指引 =====

server.registerTool("hmr_get_guide", {
  description: "HMR 热更新调试回路指引：watch 构建 + vite preview 伺服 dist + --dev-url 指向实际 ESM 产物；有随包 CSS 时补 --dev-css-url，含恢复与排障命令。",
  inputSchema: {
    pkgDir: pkgDirField,
    port: z.number().int().min(1024).max(65535).default(5173).describe("本机 vite preview 静态服务端口，默认 5173"),
  },
}, async ({ pkgDir, port }) => {
  assertPkgDir(pkgDir);
  let pkgId = path.basename(pkgDir);
  let esmFile = "tool.es.js";
  let cssFile = "";
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, pkgDir, "manifest.json"), "utf8"));
    if (manifest.id) pkgId = manifest.id;
    const currentUrl = manifest.entries?.esm?.url;
    if (currentUrl) esmFile = path.basename(new URL(currentUrl).pathname) || esmFile;
    const currentCssUrl = manifest.entries?.css?.url;
    if (currentCssUrl) cssFile = path.basename(new URL(currentCssUrl).pathname);
  } catch { /* manifest 缺失时沿用骨架默认产物名 */ }
  if (!cssFile) {
    try {
      const names = (await fs.readdir(path.join(ROOT, pkgDir, "frontend", "dist")))
        .filter((name) => name.endsWith(".css"))
        .sort();
      cssFile = names.find((name) => name === "tool.css")
        ?? names.find((name) => name === "style.css")
        ?? names[0]
        ?? "";
    } catch { /* 无随包 CSS 时只切换 ESM */ }
  }
  const publishCmd = MODE === "template"
    ? `./tools/publish.sh ${pkgDir}`
    : `./scripts/publish-extension.sh ${pkgDir} --env test`;
  if (MODE !== "template") {
    return ok(`HMR 调试回路（包：${pkgId}）

平台仓模式提示：--dev-url 回路是模板仓 tools/publish.sh 的能力（面向第三方团队
对 aiearth01 的调试），平台仓 publish-extension.sh 不支持该参数。
平台仓内的扩展联调请走既有通道：extensions/<track>/<tier>/<pkg>/deploy/docker-compose.yml
联调栈（scripts/deploy/ext-dev-up.sh）+ 球端 dev /esm-libs 中间件，详见
docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md 开发调试章节。`);
  }
  const cssArg = cssFile ? ` --dev-css-url http://<本机IP>:${port}/${cssFile}` : "";
  return ok(`HMR 调试回路（包：${pkgId}）

① 终端 A：持续构建（骨架 dev = vite build --watch，不接 --port/--host）：
   cd ${pkgDir}/frontend && npm run dev

② 终端 B：用 vite preview 伺服最新 dist：
   cd ${pkgDir}/frontend && npx vite preview --outDir dist --host 0.0.0.0 --port ${port} --strictPort

③ 把共享调试环境上该包的 manifest 指向本机实际产物：
   ${publishCmd} --dev-url http://<本机IP>:${port}/${esmFile}${cssArg}

   说明：--dev-url 改写 entries.esm.url；有随包 CSS 时 --dev-css-url 同步改写
   entries.css.url。宿主（球端 18880）再拉 manifest 即加载本机 HMR 产物。

④ 调完恢复线上形态（必须做，否则共享环境一直指向你的机器）：
   ${publishCmd} --dev-url --reset

   reset 会同时恢复 ESM 与已有的 CSS 正式入口。

排障清单：
- 宿主没加载本机产物 → 强刷球端页面（manifest 有缓存）；确认本机IP在公司网可达
- preview 跨域报错 → vite 配置需走 @agrsearth/vite-config（已内置 cors/headers）
- 球端样式丢失 → 优先确认随包 style.css 已发布且 entries.css.url 可达；关键布局不要只依赖宿主 Tailwind
- 忘记 reset → 其他团队看到 404 加载失败；收工前务必执行 ④`);
});

// ===== 19. auth_login：原生授权登录（OIDC 授权码 + PKCE S256 + loopback 回跳） =====

export function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

export function browserLaunchCommand(url, platform = process.platform) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

async function windowsChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* 继续探测下一安装位置 */ }
  }
  throw new Error("未找到 Chrome，请设置 CHROME_BIN 或手动打开授权链接");
}

async function openSystemBrowser(url) {
  let cmd;
  let args;
  if (SOCKS_OPTIONS) {
    const profile = path.join(os.homedir(), ".config", "agrsearth", "dev-mcp-browser");
    await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    const host = SOCKS_OPTIONS.host.includes(":") ? `[${SOCKS_OPTIONS.host}]` : SOCKS_OPTIONS.host;
    const chromeArgs = [
      `--user-data-dir=${profile}`,
      `--proxy-server=socks5://${host}:${SOCKS_OPTIONS.port}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      url,
    ];
    if (process.platform === "win32") {
      try {
        cmd = await windowsChromeExecutable();
        args = chromeArgs;
      } catch (e) {
        return `${e.message}`;
      }
    } else {
      [cmd, args] = process.platform === "darwin"
        ? ["open", ["-na", "Google Chrome", "--args", ...chromeArgs]]
        : ["google-chrome", chromeArgs];
    }
  } else {
    [cmd, args] = browserLaunchCommand(url);
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: false });
      child.on("error", (e) => resolve(`系统浏览器打开失败（${e.message}），请手动打开授权链接`));
      child.on("spawn", () => { child.unref(); resolve(null); });
    } catch (e) {
      resolve(`系统浏览器打开失败（${e.message}），请手动打开授权链接`);
    }
  });
}

const AUTH_SESSIONS = new Map();
const authLoginInput = {
  openBrowser: z.boolean().default(true).describe("自动打开系统浏览器；false 时输出授权链接手动打开（无桌面/远程场景）"),
  timeoutSeconds: z.number().int().min(30).max(900).default(300).describe("等待浏览器回跳的超时（秒），上限 900（state 服务端有效期 600 秒）"),
};

async function authLoginFlow({ openBrowser, timeoutSeconds, onReady }) {
  const { codeVerifier, codeChallenge } = generatePkcePair();

  // 1. 起 loopback 监听（端口须先确定：服务端校验 redirectUri 逐字符一致，含端口）
  let expectedState = null;
  let settle = null;
  const codePromise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const onCallback = (req, res) => {
    let url;
    try { url = new URL(req.url, `http://127.0.0.1/`); } catch { res.writeHead(400); res.end("bad request"); return; }
    if (url.pathname !== "/callback") { res.writeHead(404); res.end("not found"); return; }
    const q = url.searchParams;
    const page = (title, body) => {
      res.writeHead(title.includes("失败") || title.includes("错误") ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;padding:2em"><h3>${title}</h3><p>${body}</p></body>`);
    };
    const err = q.get("error");
    if (err) {
      page("登录失败", `授权端返回错误：${err} ${q.get("error_description") || ""}；请回到 AI 工具重新 auth_login`);
      settle.reject(new Error(`Casdoor 授权失败：${err} ${q.get("error_description") || ""}`));
      return;
    }
    const code = q.get("code");
    const state = q.get("state");
    if (!code || !state) { page("登录失败", "回跳缺少 code/state 参数"); settle.reject(new Error("回跳缺少 code/state 参数")); return; }
    if (state !== expectedState) { page("登录失败", "state 不匹配（可能点了旧链接），请回到 AI 工具重试"); return; }
    page("登录成功", "授权码已接收，可关闭本页并回到 AI 工具继续。");
    settle.resolve(code);
  };
  const { server: loopback, port } = await listenLoopback(onCallback);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    // 2. 申请服务端一次性会话（签发 state + 服务端拼好的 Casdoor 授权跳转 URL）
    const session = rData(await postJson(NATIVE_SESSION_URL, {
      clientId: NATIVE_CLIENT_ID,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
    }), "创建登录会话");
    expectedState = session.state;
    const authorizeUrl = session.authorizeUrl;
    const waitSeconds = Math.min(timeoutSeconds, Math.max(30, Number(session.expiresIn || 600) - 15));

    // 3. 打开系统浏览器（安全方式：spawn 参数数组、无 shell）；手动模式/失败时
    //    授权链接实时写到 stderr（stdout 是 MCP 协议通道，绝不能写）
    let browserNote = "";
    let browserAutoOpened = false;
    if (openBrowser) {
      const browserError = await openSystemBrowser(authorizeUrl);
      browserAutoOpened = !browserError;
      browserNote = browserError || (SOCKS_OPTIONS ? "已使用独立 Chrome 配置和 SOCKS5 隧道" : "");
    } else {
      browserNote = "已按参数跳过自动开浏览器";
    }
    if (!browserAutoOpened) {
      process.stderr.write(
        `\n[agrsearth-dev] 请在 ${waitSeconds}s 内打开授权链接完成登录：\n${authorizeUrl}\n\n`,
      );
      browserNote += "（授权链接已实时输出到 MCP server stderr）";
    }
    if (onReady) onReady({ authorizeUrl, waitSeconds, browserNote });

    // 4. 等回跳（超时兜底）
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待浏览器回跳超时（${waitSeconds}s 未收到授权码）`)), waitSeconds * 1000);
      codePromise.then(
        (c) => { clearTimeout(timer); resolve(c); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });

    // 5. 核销 state + PKCE 复核 + 换码验签 → RuoYi JWT
    const tokenData = rData(await postJson(NATIVE_CALLBACK_URL, {
      clientId: NATIVE_CLIENT_ID,
      state: expectedState,
      code,
      codeVerifier,
      redirectUri,
    }), "登录回调");

    const expiresIn = tokenData.expire_in ?? tokenData.expires_in ?? tokenData.expiresIn ?? null;

    // 6. 落盘（0600，目录 0700）；响应文本绝不出现令牌本体
    await saveTokenFile({
      access_token: tokenData.access_token,
      expire_in: expiresIn,
      obtained_at: new Date().toISOString(),
      dev_base: DEV_BASE,
      client_id: NATIVE_CLIENT_ID,
    });

    // 7. DC /me 复核身份（只展示 userId/username）
    let who = "";
    try {
      const me = rData(await dcFetch("/me"), "查询当前登录者");
      who = `\nDC 身份复核：userId=${me.userId} username=${me.username}`;
    } catch { who = "\nDC 身份复核失败（token 已保存；可用 auth_status 复查）"; }

    return ok(`✅ 登录成功${who}
令牌来源：auth_login（已落盘 ${TOKEN_FILE}，权限 0600；目录 0700）
RuoYi token 有效期：${expiresIn ?? "未知"} 秒（过期后重新 auth_login）
dev_base=${DEV_BASE}  client_id=${NATIVE_CLIENT_ID}
${browserNote ? `浏览器通道：${browserNote}` : "浏览器通道：已自动打开系统浏览器"}`.trim());
  } finally {
    await closeHttpServer(loopback);
  }
}

async function createAuthSession(args) {
  const loginId = crypto.randomUUID();
  const record = { completion: null, completed: false, cleanupTimer: null };
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  AUTH_SESSIONS.set(loginId, record);
  record.completion = authLoginFlow({ ...args, onReady: readyResolve });
  record.completion.catch((error) => readyReject(error));
  record.completion.catch(() => {});
  const onSettled = () => {
    record.completed = true;
    record.cleanupTimer = setTimeout(() => {
      if (AUTH_SESSIONS.get(loginId) === record) AUTH_SESSIONS.delete(loginId);
    }, 300000);
    record.cleanupTimer.unref();
  };
  record.completion.then(onSettled, onSettled);
  try {
    const { authorizeUrl, waitSeconds, browserNote } = await readyPromise;
    return {
      loginId,
      result: ok(`登录会话已创建：loginId=${loginId}\n请在 ${waitSeconds}s 内打开授权链接完成登录：\n${authorizeUrl}\n完成后调用 auth_login_wait（loginId=\"${loginId}\"）。\n${browserNote}`.trim()),
    };
  } catch (error) {
    AUTH_SESSIONS.delete(loginId);
    throw error;
  }
}

async function waitAuthSession(loginId) {
  const record = AUTH_SESSIONS.get(loginId);
  if (!record) return fail("登录会话不存在或已过期，请重新调用 auth_login_start");
  try {
    return await record.completion;
  } finally {
    if (record.completed) {
      if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
      AUTH_SESSIONS.delete(loginId);
    }
  }
}

server.registerTool("auth_login_start", {
  description: "启动浏览器原生授权登录并立即返回 loginId 与完整授权链接；后台保持 loopback 回跳监听，避免 MCP 客户端工具调用超时。完成后调用 auth_login_wait。零密码接触。",
  inputSchema: authLoginInput,
}, async (args) => (await createAuthSession(args)).result);

server.registerTool("auth_login_wait", {
  description: "等待 auth_login_start 创建的登录会话完成：接收 loopback 授权码、PKCE 核销、令牌落盘与 DC /me 复核；会话完成后可重复等待直至清理。",
  inputSchema: {
    loginId: z.string().uuid().describe("auth_login_start 返回的登录会话 ID"),
  },
}, async ({ loginId }) => waitAuthSession(loginId));

server.registerTool("auth_login", {
  description: "兼容入口：一次性完成原生授权登录（内部等价 auth_login_start + auth_login_wait）。若 MCP 客户端有较短工具超时，请改用两步工具。OIDC 授权码 + PKCE S256 + loopback 回跳，密码/MFA 均在 Casdoor 页内完成。",
  inputSchema: authLoginInput,
}, async (args) => {
  const { loginId } = await createAuthSession(args);
  return waitAuthSession(loginId);
});

// ===== 20. auth_status：凭据状态（DC GET /me 复核） =====

server.registerTool("auth_status", {
  description: "查看当前凭据状态：令牌来源（AGRSEARTH_TOKEN 环境变量 / ~/.config/agrsearth 落盘文件 / 仓根 .env.local 遗留）、落盘时间/有效期，并用 DC GET /me 实测复核身份。只展示身份与元信息，绝不回显令牌。",
  inputSchema: {},
}, async () => {
  let resolved;
  try {
    resolved = await resolveToken();
  } catch (e) {
    return fail(`${e.message}；或联系平台管理员申请团队账号`);
  }
  const lines = [`凭据来源：${resolved.source}`];
  if (resolved.saved) {
    lines.push(`落盘时间：${resolved.saved.obtained_at || "未知"}`);
    lines.push(`token 有效期：${resolved.saved.expire_in ?? "未知"} 秒（自落盘时刻起算，以服务端为准）`);
    if (resolved.saved.dev_base) lines.push(`登录时 dev_base：${resolved.saved.dev_base}`);
  }
  try {
    const me = rData(await dcFetch("/me"), "查询当前登录者");
    lines.push(`DC /me 实测：✅ userId=${me.userId} username=${me.username}`);
  } catch (e) {
    lines.push(`DC /me 实测：❌ ${e.message}（令牌可能已过期，请重新 auth_login）`);
    return fail(lines.join("\n"));
  }
  return ok(lines.join("\n"));
});

// ===== 21. auth_logout：清理本地凭据 =====

server.registerTool("auth_logout", {
  description: "清理本地凭据：删除 ~/.config/agrsearth/dev-mcp-token.json 落盘令牌。若凭据来自 AGRSEARTH_TOKEN 环境变量/仓根 .env.local，本工具无法替你改环境，只会清理落盘文件并提示。",
  inputSchema: {},
}, async () => {
  const hadFile = !!(await loadTokenFile());
  await clearTokenFile();
  const lines = [];
  lines.push(hadFile ? `已删除落盘令牌：${TOKEN_FILE}` : `无落盘令牌（${TOKEN_FILE} 不存在或已清理）`);
  if (process.env.AGRSEARTH_TOKEN) {
    lines.push("注意：AGRSEARTH_TOKEN 环境变量仍生效（CI 覆盖通道）——如需彻底登出请 unset 该变量");
  }
  if (LOCAL_ENV.AGRSEARTH_TOKEN) {
    lines.push("注意：仓根 .env.local 仍有 AGRSEARTH_TOKEN（遗留通道）——如需彻底登出请删除该键");
  }
  lines.push("服务端会话/令牌按平台策略过期，本工具不持有也不接触服务端吊销通道");
  return ok(lines.join("\n"));
});

// ---------- 启动（被测试 import 时不连 stdio）----------
export const TOOL_MANIFEST = [
  "docs_read", "package_scaffold", "package_precheck", "package_contract_check", "package_publish", "package_list",
  "package_register", "package_manage", "team_list", "team_manage", "resource_list",
  "resource_issue", "resource_rotate", "resource_revoke", "instance_list", "instance_logs",
  "environment_status", "task_get", "task_retry", "hmr_get_guide", "auth_login_start", "auth_login_wait",
  "auth_login", "auth_status", "auth_logout",
];

const isMain = process.argv[1] && path.resolve(process.argv[1]) === HERE;
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
