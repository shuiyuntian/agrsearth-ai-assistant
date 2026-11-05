#!/usr/bin/env node
//
// 文件作用：扩展包测试底座发布器——本地校验、构建、DC 发布协议、MinIO 直传与冒烟
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-03
// 版本：2.2.0
// 修改记录：
//   - 2.2.0 (2026-11-05) check-only 与正式发布前执行前后端 URL 契约双向对账（issue #6）
//   - 2.1.1 (2026-11-04) dev-url 输出补 vite preview 静态伺服指引
//   - 2.1.0 (2026-11-03) 新增 check-only、data/sql 幂等布设入参与部署前 registry 预检
//   - 2.0.0 (2026-11-03) Node 单实现替代 bash/jq/curl 发布层，支持 SOCKS5 与请求对拍
//
// 版权所有 (C) 2026 AGRSEarth 项目

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Blob } from "node:buffer";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as tar from "tar";
import undici from "undici";
import { socksDispatcher } from "fetch-socks";
import { checkApiContract, formatApiContractReport } from "./check-api-contract.mjs";

const { fetch, FormData } = undici;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DC_API_BASE = "http://10.82.11.51:18801/developer-center/api/v1";
const VALID_TRACKS = new Set(["tool", "system"]);
const VALID_TIERS = new Set(["platform", "business"]);
const VALID_DELIVERY = new Set(["bundled", "optional"]);

export class PublishError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PublishError";
  }
}

function fail(message, options) {
  throw new PublishError(message, options);
}

function exists(file) {
  return fs.existsSync(file);
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    fail(`JSON 解析失败（${file}）：${error.message}`, { cause: error });
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isNonEmptyDirectory(directory) {
  return exists(directory) && fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length > 0;
}

function usage() {
  return `用法：
  node tools/publish.mjs <package-dir> [--skip-build] [--deploy]
  node tools/publish.mjs <package-dir> --check-only
  node tools/publish.mjs <package-dir> --dev-url <url>
  node tools/publish.mjs <package-dir> --dev-url --reset

环境变量：
  DC_API_BASE             默认 ${DEFAULT_DC_API_BASE}
  AGRSEARTH_TOKEN         团队 token（RM_TOKEN 仅过渡兼容；--check-only 不需要）
  AGRSEARTH_NETWORK       lan / tailscale；缺省按 DC 网关 IP 推导
  AGRSEARTH_SOCKS_PROXY   可选 SOCKS5，如 socks5h://127.0.0.1:51080
  REGISTRY                默认 localhost:32000
  CHANGELOG               覆盖 CHANGELOG.md 最新版本段
  PUBLISH_TRACE_FILE      可选：记录归一化请求序列（不含 token/签名原文）
`;
}

export function parseArgs(argv) {
  const result = {
    pluginDir: "",
    skipBuild: false,
    deploy: false,
    checkOnly: false,
    devMode: false,
    devUrl: "",
    devReset: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skip-build") result.skipBuild = true;
    else if (arg === "--deploy") result.deploy = true;
    else if (arg === "--check-only") result.checkOnly = true;
    else if (arg === "-h" || arg === "--help") result.help = true;
    else if (arg === "--dev-url") {
      result.devMode = true;
      const next = argv[i + 1];
      if (next && next !== "--reset" && !next.startsWith("--")) {
        result.devUrl = next;
        i += 1;
      }
    } else if (arg === "--reset") {
      if (!result.devMode) fail("--reset 必须与 --dev-url 连用（--dev-url --reset）");
      result.devReset = true;
    } else if (arg === "--env" || arg.startsWith("--env=") || arg === "--prod" || arg === "prod" || arg === "test") {
      fail(`本发布器只打插件测试底座，不接受环境参数：${arg}\n生产发布由平台管理员执行`);
    } else if (arg.startsWith("-")) fail(`无法识别的参数：${arg}`);
    else if (!result.pluginDir) result.pluginDir = arg;
    else fail(`无法识别的参数：${arg}`);
  }
  if (!result.help && !result.pluginDir) fail(`请指定包目录（如 extensions/<track>/<tier>/<pkg-id>）\n${usage()}`);
  if (result.devMode && !result.devReset && !result.devUrl) {
    fail("--dev-url 需要 URL 参数（--dev-url http://<ip>:<port>），或 --dev-url --reset 恢复正式产物");
  }
  if (result.devReset && result.devUrl) fail("--dev-url --reset 不得同时携带 URL");
  return result;
}

export function validateMenuDocument(doc, packageId) {
  const errors = [];
  if (doc?.schemaVersion !== 1) errors.push("schemaVersion 必须为 1");
  if (!doc?.packageId) errors.push("缺少 packageId");
  if (doc?.packageId !== packageId) errors.push(`packageId 与包目录不符：menu.json=${doc?.packageId}，期望=${packageId}`);
  const menus = doc?.menus;
  if (!Array.isArray(menus)) {
    errors.push("menus 必须为数组");
    return errors;
  }
  const seen = new Map();
  const ids = new Set();
  for (const [index, menu] of menus.entries()) {
    const menuId = menu?.menuId;
    const tag = `menus[${index}](menuId=${menuId})`;
    if (!Number.isInteger(menuId)) {
      errors.push(`${tag}：menuId 缺失或非整数`);
      continue;
    }
    if (seen.has(menuId)) errors.push(`${tag}：menuId 重复（首次出现于 menus[${seen.get(menuId)}]）`);
    seen.set(menuId, index);
    ids.add(menuId);
    if (menuId >= 100000 && menuId <= 999999) errors.push(`${tag}：落入 6 位隔离带（100000-999999 永不分配）`);
    if (menuId < 1 || menuId > 9999999) errors.push(`${tag}：超出合法范围 1-9999999`);
    for (const field of ["menuName", "parentId", "orderNum", "menuType"]) {
      if (menu[field] == null) errors.push(`${tag}：缺少必填字段 ${field}`);
    }
    if (!["M", "C", "F"].includes(menu.menuType)) errors.push(`${tag}：menuType 非法（仅 M/C/F）：${menu.menuType}`);
    if (["M", "C"].includes(menu.menuType) && !menu.path) errors.push(`${tag}：M/C 类菜单 path 必填`);
    if (!["0", "1"].includes(menu.visible ?? "0")) errors.push(`${tag}：visible 仅允许 '0'/'1'`);
    if (!["0", "1"].includes(menu.status ?? "0")) errors.push(`${tag}：status 仅允许 '0'/'1'`);
    if (menu.roleIds != null && !Array.isArray(menu.roleIds)) errors.push(`${tag}：roleIds 必须为数组`);
  }
  for (const menu of menus) {
    const parentId = menu?.parentId;
    if (Number.isInteger(parentId) && parentId !== 0 && parentId >= 100000 && !ids.has(parentId)) {
      errors.push(`menuId=${menu.menuId}：parentId=${parentId} 既非 0/平台侧（<100000），也不在本包菜单集内`);
    }
  }
  return errors;
}

function validateVersionConsistency(pluginDir, manifest, hasFrontend, hasAdminUi) {
  const version = manifest.version;
  const versionFile = path.join(pluginDir, "VERSION");
  if (!exists(versionFile)) fail(`缺少版本文件：${versionFile}`);
  const packageVersion = readText(versionFile).trim();
  if (packageVersion !== version) fail(`版本不一致：VERSION=${packageVersion}，manifest.json=${version}`);

  const packageFiles = [];
  if (hasFrontend) packageFiles.push(path.join(pluginDir, "frontend", "package.json"));
  if (hasAdminUi) packageFiles.push(path.join(pluginDir, "admin-ui", "package.json"));
  for (const file of packageFiles) {
    const actual = readJson(file).version;
    if (actual !== version) fail(`版本不一致：${file}=${actual ?? "缺失"}，manifest.json=${version}`);
  }

  const frontendManifest = path.join(pluginDir, "frontend", "src", "manifest.ts");
  if (exists(frontendManifest)) {
    const match = readText(frontendManifest).match(/^\s*version:\s*['"]([^'"]+)['"]/m);
    if (!match || match[1] !== version) fail(`版本不一致：${frontendManifest}=${match?.[1] ?? "未找到"}，manifest.json=${version}`);
  }

  const changelogFile = path.join(pluginDir, "CHANGELOG.md");
  if (!exists(changelogFile)) fail(`缺少必备文件：${changelogFile}`);
  const heading = readText(changelogFile).match(/^## \[([^\]]+)\]/m);
  if (!heading || heading[1] !== version) fail(`CHANGELOG.md 最新版本段与 manifest.json=${version} 不一致`);

  for (const service of manifest.backendServices ?? []) {
    if ((service.imageSource ?? "self") !== "self") continue;
    const componentVersionFile = path.join(pluginDir, "container", service.serviceId, "VERSION");
    const componentVersion = exists(componentVersionFile) ? readText(componentVersionFile).trim() : version;
    if (!componentVersion) fail(`组件版本为空：${componentVersionFile}`);
    const deployDir = path.join(pluginDir, "deploy", "k8s");
    if (!exists(deployDir)) continue;
    const yamlFiles = fs.readdirSync(deployDir).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"));
    for (const name of yamlFiles) {
      const text = readText(path.join(deployDir, name));
      const imagePattern = new RegExp(`image:\\s*\\S*/${service.serviceId}:([^\\s]+)`, "g");
      for (const match of text.matchAll(imagePattern)) {
        const tag = match[1].replace(/["']$/, "");
        if (tag === "latest") fail(`禁止 latest 镜像 tag：${path.join(deployDir, name)}`);
        if (tag !== componentVersion) {
          fail(`部署镜像 tag 与组件版本不一致：${name}=${tag}，container/${service.serviceId}/VERSION=${componentVersion}`);
        }
      }
    }
  }
}

export function resolveNetworkProfile(dcApiBase, explicit) {
  if (explicit) {
    if (!["lan", "tailscale"].includes(explicit)) fail(`AGRSEARTH_NETWORK 仅支持 lan / tailscale：${explicit}`);
    return explicit;
  }
  let hostname;
  try {
    hostname = new URL(dcApiBase).hostname;
  } catch (error) {
    fail(`DC_API_BASE 不是合法 URL：${dcApiBase}`, { cause: error });
  }
  if (hostname.startsWith("100.64.")) return "tailscale";
  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)) return "lan";
  }
  fail(`无法从网关地址推导 networkProfile（host=${hostname}）——请显式设置 AGRSEARTH_NETWORK=lan|tailscale`);
}

export function loadPackage(pluginArg, env = process.env, options = {}) {
  const pluginDir = path.resolve(REPO_ROOT, pluginArg);
  const manifestFile = path.join(pluginDir, "manifest.json");
  if (!exists(manifestFile)) fail(`未找到 manifest.json：${manifestFile}`);
  const manifest = readJson(manifestFile);
  const { id: packageId, name: packageName, version } = manifest;
  if (!packageId || !packageName || !version) fail("manifest.json 缺少必填字段 id/name/version");
  if (!VALID_TRACKS.has(manifest.track)) fail(`manifest.json 的 track 缺失或非法：${manifest.track ?? "缺失"}（仅支持 tool / system）`);
  if (!VALID_TIERS.has(manifest.tier)) fail(`manifest.json 的 tier 缺失或非法：${manifest.tier ?? "缺失"}（仅支持 platform / business）`);
  const relativeDir = toPosix(path.relative(REPO_ROOT, pluginDir));
  const expectedDir = `extensions/${manifest.track}/${manifest.tier}/${packageId}`;
  if (relativeDir !== expectedDir) {
    fail(`目录==track/tier 闸口未通过——包目录应为 ${expectedDir}，实际为 ${relativeDir}\nmanifest track=${manifest.track} tier=${manifest.tier} id=${packageId}`);
  }
  if (manifest.delivery) {
    if (!VALID_DELIVERY.has(manifest.delivery)) fail(`manifest.json 的 delivery 取值非法：${manifest.delivery}`);
    if (manifest.track !== "tool" || manifest.tier !== "business") fail("delivery 仅适用于 tool·business 象限");
  }

  const manifestType = manifest.type ?? "extension";
  const packageType = manifestType === "core" ? "0" : manifestType === "suite" ? "2" : "1";
  const hasFrontend = exists(path.join(pluginDir, "frontend", "package.json"));
  const hasAdminUi = manifestType !== "suite" && exists(path.join(pluginDir, "admin-ui", "package.json"));
  let components = null;
  let menuPath = "";
  if (manifest.components) {
    const raw = manifest.components;
    if (raw.frontend === true && !hasFrontend) fail("components.frontend=true 但包内无 frontend/package.json");
    if (raw.adminUi === true && !hasAdminUi) fail("components.adminUi=true 但包内无 admin-ui/package.json");
    if (raw.data === true && !exists(path.join(pluginDir, "data"))) fail("components.data=true 但包内无 data/ 目录");
    menuPath = raw.menu?.menuPath ?? "";
    if (raw.menu?.enabled === true && !menuPath) fail("components.menu.enabled=true 但缺少 components.menu.menuPath");
    const backendIds = raw.backend ?? [];
    const known = new Set((manifest.backendServices ?? []).map((service) => service.serviceId));
    const unknown = backendIds.filter((id) => !known.has(id));
    if (unknown.length) fail(`components.backend 声明了未在 backendServices 登记的服务：${JSON.stringify(unknown)}`);
    components = {
      frontend: raw.frontend ?? false,
      backend: backendIds,
      adminUi: raw.adminUi ?? false,
      menu: {
        enabled: raw.menu?.enabled ?? false,
        ...(menuPath ? { menuPath } : {}),
      },
      data: raw.data ?? false,
    };
  }

  const menuFile = path.join(pluginDir, "data", "menu.json");
  const hasMenu = exists(menuFile);
  let menuJson = null;
  if (hasMenu) {
    menuJson = readJson(menuFile);
    const errors = validateMenuDocument(menuJson, packageId);
    if (errors.length) fail(`data/menu.json 未通过校验：\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  } else if (menuPath) {
    fail("components.menu.enabled=true 但包内无 data/menu.json——请补菜单声明文件");
  }
  if (!manifest.icon) fail("manifest.json 缺少 icon 字段（Element Plus 图标名，如 MapLocation）");
  validateVersionConsistency(pluginDir, manifest, hasFrontend, hasAdminUi);

  const dcApiBase = env.DC_API_BASE || DEFAULT_DC_API_BASE;
  const networkProfile = resolveNetworkProfile(dcApiBase, env.AGRSEARTH_NETWORK || "");
  let token = env.AGRSEARTH_TOKEN || "";
  if (!token && env.RM_TOKEN) token = env.RM_TOKEN;
  if (!token && options.requireToken !== false) fail("请经环境变量提供 AGRSEARTH_TOKEN（团队 token，申请方式见 test-env/README.md §2）");

  return {
    pluginDir,
    relativeDir,
    manifestFile,
    manifest,
    manifestType,
    packageId,
    packageName,
    packageType,
    version,
    components,
    menuPath,
    menuFile,
    menuJson,
    hasMenu,
    hasFrontend,
    hasAdminUi,
    hasAdminUiDecl: Boolean(manifest.adminUi),
    distDir: path.join(pluginDir, "frontend", "dist"),
    adminDistDir: path.join(pluginDir, "admin-ui", "dist"),
    dcApiBase,
    registry: env.REGISTRY || "localhost:32000",
    token,
    tokenFallback: !env.AGRSEARTH_TOKEN && Boolean(env.RM_TOKEN),
    networkProfile,
  };
}

class TraceRecorder {
  constructor(file) {
    this.file = file ? path.resolve(file) : "";
    this.entries = [];
    if (this.file) fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  record(entry) {
    this.entries.push(entry);
    if (this.file) writeJson(this.file, this.entries);
  }
}

function parseSocksProxy(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    fail(`SOCKS5 代理地址非法：${value}`, { cause: error });
  }
  if (!["socks5:", "socks5h:"].includes(parsed.protocol)) fail(`AGRSEARTH_SOCKS_PROXY 仅支持 socks5:// 或 socks5h://：${value}`);
  const port = parsed.port ? Number(parsed.port) : 1080;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`SOCKS5 代理端口非法：${parsed.port}`);
  const options = { type: 5, host: parsed.hostname, port };
  if (parsed.username) options.userId = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  return options;
}

function createDispatcher(env) {
  const options = parseSocksProxy(env.AGRSEARTH_SOCKS_PROXY || env.SOCKS_PROXY || "");
  return options ? socksDispatcher(options) : null;
}

function fetchOptions(dispatcher, timeoutMs) {
  return {
    signal: AbortSignal.timeout(timeoutMs),
    ...(dispatcher ? { dispatcher } : {}),
  };
}

async function apiCall(context, dispatcher, trace, step, method, apiPath, body) {
  trace.record({ step, method, path: apiPath, bodyJSON: body ?? null });
  let response;
  let text;
  try {
    response = await fetch(`${context.dcApiBase}${apiPath}`, {
      method,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${context.token}`,
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
      ...fetchOptions(dispatcher, 120000),
    });
    text = await response.text();
  } catch (error) {
    fail(`无法连接 developer-center（${context.dcApiBase}）：${error.message}\n请确认测试底座可达，或经 DC_API_BASE / AGRSEARTH_SOCKS_PROXY 配置网络`, { cause: error });
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    fail(`API ${method} ${apiPath} 返回非 JSON（HTTP ${response.status}）：${text.slice(0, 1000)}`, { cause: error });
  }
  if (payload.code !== 200) {
    const hint = response.status === 401 || text.includes("401") ? "\n请经 AGRSEARTH_TOKEN 环境变量提供有效团队 token" : "";
    fail(`API ${method} ${apiPath} 返回异常：${text}${hint}`);
  }
  return payload;
}

function artifactTypeOf(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".json")) return "manifest-json";
  if (/\.umd\./.test(lower)) return "umd-js";
  return "esm-js";
}

function adminArtifactTypeOf(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".css")) return "admin-css";
  if (/\.umd\./.test(lower)) return "admin-umd-js";
  return "admin-esm-js";
}

function directFiles(directory) {
  if (!exists(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function assertFlatAdminDist(directory) {
  if (!exists(directory)) return;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && path.dirname(full) !== directory) {
        fail(`admin-ui 产物含子目录资产（如 ${toPosix(path.relative(directory, full))}）——upload-sessions 通道仅支持平铺文件名`);
      }
    }
  };
  walk(directory);
}

async function uploadArtifact(context, dispatcher, trace, artifacts, file, artifactType, filename, logger) {
  const sizeBytes = fs.statSync(file).size;
  const digest = fileSha256(file);
  const body = {
    version: context.version,
    filename,
    sizeBytes,
    sha256: digest,
    artifactType,
    networkProfile: context.networkProfile,
  };
  const session = await apiCall(context, dispatcher, trace, "upload-sessions", "POST", `/packages/${context.packageId}/upload-sessions`, body);
  const { uploadId, postUrl, formFields } = session.data ?? {};
  if (!uploadId || !postUrl) fail(`upload-sessions 未返回 uploadId/postUrl：${JSON.stringify(session)}\n发布已中止，不会执行 release-complete`);

  trace.record({
    step: "minio-upload",
    method: "POST",
    path: new URL(postUrl).pathname,
    bodyJSON: null,
    file: { filename, sizeBytes, sha256: digest },
    formFields: Object.fromEntries(Object.entries(formFields ?? {}).map(([key, value]) => [key, sha256(String(value))])),
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(formFields ?? {})) form.append(key, String(value));
  form.append("file", new Blob([await fsp.readFile(file)]), filename);
  try {
    const response = await fetch(postUrl, {
      method: "POST",
      body: form,
      ...fetchOptions(dispatcher, 300000),
    });
    await response.text();
    if (response.status < 200 || response.status >= 300) {
      fail(`MinIO 直传失败（HTTP ${response.status}）：${filename}——会话 ${uploadId} 未 complete，不会执行 release-complete`);
    }
  } catch (error) {
    if (error instanceof PublishError) throw error;
    fail(`无法连接 MinIO 上传端（${postUrl}）：${error.message}\n发布已中止，不会执行 release-complete`, { cause: error });
  }

  const completed = await apiCall(context, dispatcher, trace, "upload-complete", "POST", `/packages/${context.packageId}/upload-sessions/${encodeURIComponent(uploadId)}/complete`);
  const artifactUrl = completed.data?.artifactUrl;
  if (!artifactUrl) fail(`upload-sessions/${uploadId}/complete 未返回 artifactUrl：${JSON.stringify(completed)}`);
  artifacts.push({ filename, artifactType, artifactUrl, sizeBytes, sha256: digest });
  logger.log(`  已上传 ${filename}（${artifactType}，${sizeBytes} 字节）→ ${artifactUrl}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === "win32",
      stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", (error) => reject(new PublishError(`无法执行 ${command}：${error.message}`, { cause: error })));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new PublishError(`${command} ${args.join(" ")} 执行失败（退出码 ${code}）${stderr ? `：${stderr.trim()}` : ""}`));
    });
  });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function ensureAndBuild(context, args, logger) {
  if (context.manifestType === "suite") {
    logger.log("[1/5] suite 虚拟聚合包：零产物，跳过构建");
    return;
  }
  const build = async (directory, label) => {
    if (args.skipBuild) {
      logger.log(`[1/5] --skip-build，跳过 ${label} 构建`);
      return;
    }
    logger.log(`[1/5] 构建 ${label} ...`);
    if (!exists(path.join(REPO_ROOT, "node_modules"))) await runCommand(npmCommand(), ["install"], { cwd: REPO_ROOT });
    await runCommand(npmCommand(), ["run", "build"], { cwd: directory });
  };
  if (context.hasFrontend) await build(path.join(context.pluginDir, "frontend"), "前端");
  else logger.log("[1/5] 无 frontend/package.json，跳过前端构建");
  if (context.hasFrontend && !isNonEmptyDirectory(context.distDir)) fail(`前端产物目录 ${context.distDir} 不存在或为空`);
  if (context.hasAdminUi) {
    await build(path.join(context.pluginDir, "admin-ui"), "管理端远程页面（admin-ui）");
    if (!isNonEmptyDirectory(context.adminDistDir)) fail(`admin-ui 产物目录 ${context.adminDistDir} 不存在或为空`);
  }
}

function latestChangelog(context, env) {
  if (env.CHANGELOG) return env.CHANGELOG;
  const file = path.join(context.pluginDir, "CHANGELOG.md");
  if (exists(file)) {
    const lines = readText(file).split(/\r?\n/);
    const start = lines.findIndex((line) => /^## \[/.test(line));
    if (start >= 0) {
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        if (/^## \[/.test(lines[i])) { end = i; break; }
      }
      const section = lines.slice(start + 1, end).join("\n").trim();
      if (section) return section;
    }
  }
  return context.manifest.description ?? "";
}

export function topoSortServices(services) {
  const ids = services.map((service) => service.serviceId);
  if (new Set(ids).size !== ids.length) fail("backendServices 存在重复 serviceId");
  const known = new Set(ids);
  for (const service of services) {
    const unknown = (service.dependsOn ?? []).filter((id) => !known.has(id));
    if (unknown.length) fail(`服务 ${service.serviceId} 的 dependsOn 引用了未声明服务：${unknown.join(", ")}`);
  }
  const remaining = new Set(ids);
  const order = [];
  while (remaining.size) {
    let progressed = false;
    for (const service of services) {
      if (!remaining.has(service.serviceId)) continue;
      if ((service.dependsOn ?? []).every((dependency) => !remaining.has(dependency))) {
        order.push(service.serviceId);
        remaining.delete(service.serviceId);
        progressed = true;
      }
    }
    if (!progressed) fail("backendServices 的 dependsOn 存在循环依赖，请检查 manifest.json");
  }
  return order.map((id) => services.find((service) => service.serviceId === id));
}

function backendResources(context) {
  const services = context.manifest.backendServices ?? [];
  return topoSortServices(services).map((service, index) => {
    const imageSource = service.imageSource ?? "self";
    let image;
    if (imageSource === "self") {
      const versionFile = path.join(context.pluginDir, "container", service.serviceId, "VERSION");
      const serviceVersion = exists(versionFile) ? readText(versionFile).trim() : context.version;
      if (!serviceVersion) fail(`${versionFile} 内容为空`);
      image = `${context.registry}/gis-platform/${context.manifest.track}/${context.manifest.tier}/${context.packageId}/${service.serviceId}:${serviceVersion}`;
    } else if (imageSource === "upstream") {
      image = service.image;
      if (!image) fail(`backendServices[${service.serviceId}] imageSource=upstream 但未声明 image 字段`);
    } else fail(`backendServices[${service.serviceId}] imageSource 取值非法：${imageSource}（仅支持 self/upstream）`);
    return {
      resourceType: "backend",
      resourceName: service.name ?? service.serviceId,
      artifactType: "docker-image",
      artifactUrl: image,
      artifactVersion: service.minVersion ?? "",
      serviceId: service.serviceId,
      apiPrefix: service.apiPrefix ?? "",
      healthEndpoint: service.healthEndpoint ?? "",
      required: service.required ? 1 : 0,
      sortNo: index + 1,
    };
  });
}

function releasePrepareBody(context, env) {
  const manifest = context.manifest;
  const metadata = {
    packageName: context.packageName,
    packageType: context.packageType,
    track: manifest.track,
    tier: manifest.tier,
    description: manifest.description ?? "",
    icon: manifest.icon,
    author: manifest.author ?? "",
    changelog: latestChangelog(context, env),
    isDefault: 1,
    ...(manifest.domain ? { domain: manifest.domain } : {}),
    ...(manifest.delivery ? { delivery: manifest.delivery } : {}),
    ...(context.menuPath ? { menuPath: context.menuPath } : {}),
    ...(context.components ? { components: context.components } : {}),
  };
  if (manifest.defaultConfig != null) metadata.defaultConfig = JSON.stringify(manifest.defaultConfig);
  for (const field of ["platformMinVersion", "platformMaxVersion", "repoUrl"]) {
    if (manifest[field]) metadata[field] = manifest[field];
  }
  if (manifest.aiCapabilities) {
    metadata.aiCapabilities = typeof manifest.aiCapabilities === "string" ? manifest.aiCapabilities : JSON.stringify(manifest.aiCapabilities);
  }
  const resources = backendResources(context);
  return {
    version: context.version,
    metadata,
    ...(resources.length ? { backendResources: resources } : {}),
  };
}

function mergeYamlDocuments(files) {
  let output = "";
  files.forEach((file, index) => {
    const content = readText(file).replace(/\r\n/g, "\n");
    const nextHasSeparator = content.split("\n").find((line) => line.trim())?.trim() === "---";
    if (index > 0 && !output.trimEnd().endsWith("---") && !nextHasSeparator) output += "---\n";
    output += content;
    if (!output.endsWith("\n")) output += "\n";
  });
  return output;
}

async function createK8sBundle(context, tempDir) {
  const bundleDir = path.join(context.pluginDir, "deploy", "k8s");
  if (!exists(bundleDir) || context.manifest.k8sBundle === false) return null;
  const bundleYaml = path.join(tempDir, "k8s-bundle.yaml");
  const hasKustomization = exists(path.join(bundleDir, "kustomization.yaml")) || exists(path.join(bundleDir, "kustomization.yml"));
  if (hasKustomization) {
    const output = await runCommand("kubectl", ["kustomize", bundleDir], { capture: true });
    fs.writeFileSync(bundleYaml, output, "utf8");
  } else {
    const files = fs.readdirSync(bundleDir)
      .filter((name) => name.endsWith(".yaml"))
      .sort()
      .map((name) => path.join(bundleDir, name));
    if (!files.length) fail("deploy/k8s/ 既无 kustomization.yaml 也无 *.yaml 文件");
    fs.writeFileSync(bundleYaml, mergeYamlDocuments(files), "utf8");
  }
  const bundleFile = path.join(tempDir, "k8s-bundle.tar.gz");
  await tar.c({
    file: bundleFile,
    cwd: tempDir,
    gzip: true,
    format: "ustar",
    portable: true,
    noMtime: true,
    mode: 0o644,
  }, ["k8s-bundle.yaml"]);
  return bundleFile;
}

function filledManifest(context, artifacts) {
  const manifest = structuredClone(context.manifest);
  const ensureEntry = (group, entry) => {
    manifest[group] ??= {};
    manifest[group][entry] ??= {};
    return manifest[group][entry];
  };
  for (const artifact of artifacts) {
    if (artifact.artifactType === "esm-js") ensureEntry("entries", "esm").url = artifact.artifactUrl;
    else if (artifact.artifactType === "umd-js") ensureEntry("entries", "umd").url = artifact.artifactUrl;
    else if (artifact.artifactType === "css") ensureEntry("entries", "css").url = artifact.artifactUrl;
    else if (context.hasAdminUiDecl && artifact.artifactType === "admin-esm-js") {
      manifest.adminUi ??= {};
      manifest.adminUi.url = artifact.artifactUrl;
    } else if (context.hasAdminUiDecl && artifact.artifactType === "admin-css") {
      manifest.adminUi ??= {};
      manifest.adminUi.cssUrl = artifact.artifactUrl;
    }
  }
  manifest.version = context.version;
  return manifest;
}

function registryManifestPath(image) {
  const value = image.trim().replace(/^https?:\/\//, "");
  const firstSlash = value.indexOf("/");
  if (firstSlash <= 0) fail(`镜像引用缺 registry/repository：${image}`);
  const remainder = value.slice(firstSlash + 1);
  const digestAt = remainder.indexOf("@");
  if (digestAt > 0) return `/v2/${remainder.slice(0, digestAt)}/manifests/${remainder.slice(digestAt + 1)}`;
  const colon = remainder.lastIndexOf(":");
  if (colon <= 0 || colon === remainder.length - 1) fail(`镜像引用缺 tag/digest：${image}`);
  return `/v2/${remainder.slice(0, colon)}/manifests/${remainder.slice(colon + 1)}`;
}

async function precheckRegistryImages(context, resources, dispatcher, trace, env, logger) {
  if (!resources?.length) return;
  const dc = new URL(context.dcApiBase);
  const registryBase = env.AGRSEARTH_REGISTRY_API_BASE || `${dc.protocol}//${dc.hostname}:32000`;
  for (const resource of resources) {
    const path = registryManifestPath(resource.artifactUrl);
    trace.record({ step: "image-precheck", method: "HEAD", path, bodyJSON: null, serviceId: resource.serviceId });
    try {
      const response = await fetch(`${registryBase}${path}`, {
        method: "HEAD",
        headers: { Accept: "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" },
        ...fetchOptions(dispatcher, 20000),
      });
      if (response.status === 200) {
        logger.log(`  镜像预检通过：${resource.serviceId} → ${resource.artifactUrl}`);
      } else {
        logger.log(`  警告：镜像预检返回 HTTP ${response.status}（${resource.artifactUrl}）；如未推送，请先执行 container/${resource.serviceId}/build.sh，服务端将拒绝缺失镜像的部署`);
      }
    } catch (error) {
      logger.log(`  警告：本地无法确认镜像 ${resource.artifactUrl}（${error.message}）；如未推送，请先执行 container/${resource.serviceId}/build.sh，最终以服务端预检为准`);
    }
  }
}

function dependencies(context) {
  if (context.manifestType === "suite") {
    const members = context.manifest.members ?? [];
    if (!members.length) fail("suite 包 manifest.json 缺少 members（[{packageId,version}]，至少 1 个成员）");
    return members.map((member) => ({
      dependsOnPackageId: member.packageId,
      minVersion: member.version,
      maxVersion: member.version,
    }));
  }
  return (context.manifest.dependsOnPackages ?? []).map((dependency) => ({
    dependsOnPackageId: dependency.packageId,
    minVersion: dependency.minVersion ?? null,
    maxVersion: dependency.maxVersion ?? null,
  }));
}

function logReleaseResult(response, deploy, logger) {
  const data = response.data ?? {};
  logger.log(`  版本已发布（publishStatus=${data.publishStatus ?? "?"}，dependenciesRegistered=${data.dependenciesRegistered ?? "?"}）`);
  const menu = data.menuResult;
  if (menu) {
    logger.log(`  菜单布设结果：total=${menu.total} inserted=${menu.inserted} updated=${menu.updated} unchanged=${menu.unchanged} roleBindingsAdded=${menu.roleBindingsAdded}`);
    for (const warning of menu.warnings ?? []) logger.log(`  菜单布设告警：${warning}`);
  }
  if (data.imagePrecheck) logger.log(`  镜像存在性预检：${data.imagePrecheck.length} 个镜像已在 registry 就位`);
  if (data.gatewayRoutes?.length) {
    logger.log(`  网关路由已自动收敛：${data.gatewayRoutes.map((route) => `${route.apiPrefix}→${route.serviceId}`).join("、")}`);
  }
  if (data.dataResult) {
    logger.log(`  数据布设：applied=${JSON.stringify(data.dataResult.applied ?? [])} skipped=${JSON.stringify(data.dataResult.skipped ?? [])}`);
  }
  if (!deploy) {
    logger.log("  未指定 --deploy，跳过部署");
    return;
  }
  const bundle = data.bundleResult;
  if (!bundle) {
    logger.log("  未指定 --deploy 或服务端未执行部署段（bundleResult=null）");
    return;
  }
  logger.log(`  bundle 部署结果：${bundle.message ?? ""}（namespace=${bundle.namespace ?? ""}，docs=${bundle.docCount ?? 0}）`);
  for (const error of bundle.errors ?? []) logger.error(`     错误：${error}`);
  for (const doc of bundle.docs ?? []) {
    logger.log(`     ${doc.kind ?? "-"}/${doc.name ?? "-"}: ${doc.error ?? "通过"}`);
    for (const warning of doc.warnings ?? []) logger.log(`        告警：${warning}`);
  }
  if (bundle.passed === false) fail("bundle 部署失败——版本发布态与部署结果以服务端为准，请联系平台方核对");
}

async function smoke(context, dispatcher, trace, artifacts, logger) {
  logger.log("[5/5] 发布冒烟 ...");
  const failures = [];
  if (context.manifestType !== "suite" && !artifacts.length) failures.push("无产物上传记录——发布流程异常");
  let manifestText = null;
  for (const artifact of artifacts) {
    trace.record({ step: "smoke", method: "GET", path: new URL(artifact.artifactUrl).pathname, bodyJSON: null, artifactType: artifact.artifactType });
    try {
      const response = await fetch(artifact.artifactUrl, fetchOptions(dispatcher, 20000));
      const text = await response.text();
      if (response.status !== 200) failures.push(`artifact_url 不可达（HTTP ${response.status}）：${artifact.filename} -> ${artifact.artifactUrl}`);
      if (artifact.artifactType === "manifest-json") manifestText = text;
    } catch (error) {
      failures.push(`artifact_url 请求失败：${artifact.filename} -> ${artifact.artifactUrl}（${error.message}）`);
    }
  }
  logger.log(`  artifact_url 可达性：${artifacts.length} 个产物已逐一校验`);
  if (context.manifestType !== "suite") {
    if (manifestText == null) failures.push("产物清单中未找到可读取的 manifest-json——manifest 上传缺失或拉取失败");
    else {
      let published;
      try {
        published = JSON.parse(manifestText);
      } catch {
        failures.push("manifest.json 拉取或解析失败");
      }
      if (published) {
        const expected = { id: context.packageId, version: context.version, track: context.manifest.track, tier: context.manifest.tier };
        for (const [field, value] of Object.entries(expected)) {
          if (published[field] !== value) failures.push(`manifest.json 字段不一致：${field} 发布侧=${published[field]}，发布参数=${value}`);
        }
        logger.log("  manifest.json 字段比对：id/version/track/tier 已核对");
      }
    }
  }
  if (failures.length) {
    fail(`发布冒烟未通过（${failures.length} 项）：\n${failures.map((failure) => `  - ${failure}`).join("\n")}\n版本已置发布态；更新产物须递增版本号后重发`);
  }
  logger.log("  冒烟通过");
}

async function devUrl(context, args, dispatcher, trace, logger) {
  logger.log(`dev-url 模式：${context.packageId}@${context.version}`);
  const body = args.devReset
    ? { version: context.version, reset: true }
    : { version: context.version, esmUrl: args.devUrl, reset: false };
  const response = await apiCall(context, dispatcher, trace, "dev-url", "POST", `/packages/${context.packageId}/dev-url`, body);
  const data = response.data ?? {};
  if (data.changed === false) logger.log(`  幂等短路：entries.esm.url 已是 ${data.esmUrl ?? "目标地址"}`);
  else logger.log(`  改写完成：${data.previousUrl || "∅"} → ${data.esmUrl ?? ""}`);
  if (data.objectKey) logger.log(`  manifest 对象：${data.objectKey}`);
  if (!args.devReset) {
    const frontendDir = path.join(context.pluginDir, "frontend");
    logger.log(`HMR 调试回路已建立：cd ${frontendDir} && npm run dev（watch 构建）`);
    logger.log(`静态伺服：cd ${frontendDir} && npx vite preview --outDir dist --host 0.0.0.0 --port <端口> --strictPort`);
    logger.log(`调试完恢复：./tools/publish.sh ${context.relativeDir} --dev-url --reset`);
  }
}

export async function runPublish(argv, options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const args = parseArgs(argv);
  if (args.help) {
    logger.log(usage());
    return;
  }
  const context = loadPackage(args.pluginDir, env, { requireToken: !args.checkOnly });
  const apiContract = checkApiContract(context.pluginDir);
  logger.log(formatApiContractReport(apiContract));
  if (args.checkOnly) {
    logger.log(`发布预检通过：${context.packageId}@${context.version}（目录、manifest、菜单、版本、组件版本轴与 URL 契约一致）`);
    return;
  }
  if (context.tokenFallback) logger.log("提示：RM_TOKEN 已过渡映射为 AGRSEARTH_TOKEN，请尽快改用 AGRSEARTH_TOKEN");
  if (context.packageId.endsWith("-demo")) logger.log(`提示：${context.packageId} 为官方演示包（*-demo），仅用于环境通路验证，禁止提测`);
  const trace = new TraceRecorder(options.traceFile ?? env.PUBLISH_TRACE_FILE);
  const dispatcher = options.dispatcher ?? createDispatcher(env);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agrsearth-publish-"));
  try {
    if (args.devMode) {
      await devUrl(context, args, dispatcher, trace, logger);
      return;
    }
    logger.log("==========================================");
    logger.log(`发布扩展能力包 ${context.packageId}@${context.version}（scope=${context.manifest.track}/${context.manifest.tier}，env=test）`);
    logger.log(`控制 API：${context.dcApiBase}（networkProfile=${context.networkProfile}）`);
    logger.log("==========================================");
    await ensureAndBuild(context, args, logger);

    logger.log("[2/5] release-prepare（developer-center 注册包/版本）...");
    const prepareBody = releasePrepareBody(context, env);
    const prepare = await apiCall(context, dispatcher, trace, "release-prepare", "POST", `/packages/${context.packageId}/release-prepare`, prepareBody);
    const prepareData = prepare.data ?? {};
    logger.log(`  release-prepare 完成：packageCreated=${prepareData.packageCreated ?? false} packageUpdated=${prepareData.packageUpdated ?? false} versionCreated=${prepareData.versionCreated ?? false} versionUpdated=${prepareData.versionUpdated ?? false} publishStatus=${prepareData.publishStatus ?? "?"}（0=草稿）`);

    const artifacts = [];
    const dataSql = [];
    if (context.manifestType !== "suite") {
      logger.log("[3/5] 产物上传（developer-center upload-sessions + MinIO 直传）...");
      const names = new Map([["manifest.json", "内置 manifest"]]);
      if (context.hasMenu) names.set("menu.json", "内置 menu.json");
      const reserve = (filename, owner) => {
        if (names.has(filename)) fail(`产物文件名跨组重名「${filename}」（${names.get(filename)} 与 ${owner}）——对象 key 平铺，禁止覆盖`);
        names.set(filename, owner);
      };
      for (const file of directFiles(context.distDir)) {
        const filename = path.basename(file);
        reserve(filename, "frontend/dist");
        await uploadArtifact(context, dispatcher, trace, artifacts, file, artifactTypeOf(filename), filename, logger);
      }
      assertFlatAdminDist(context.adminDistDir);
      for (const file of directFiles(context.adminDistDir)) {
        const filename = path.basename(file);
        reserve(filename, "admin-ui/dist");
        await uploadArtifact(context, dispatcher, trace, artifacts, file, adminArtifactTypeOf(filename), filename, logger);
      }
      const sqlDir = path.join(context.pluginDir, "data", "sql");
      for (const file of directFiles(sqlDir).filter((file) => file.toLowerCase().endsWith(".sql"))) {
        const filename = path.basename(file);
        reserve(filename, "data/sql");
        const content = readText(file);
        dataSql.push({ filename, content, sha256: fileSha256(file) });
        await uploadArtifact(context, dispatcher, trace, artifacts, file, "data-sql", filename, logger);
      }
      const bundleFile = options.replayBundleFile ?? await createK8sBundle(context, tempDir);
      const manifestFile = path.join(tempDir, "manifest.json");
      writeJson(manifestFile, filledManifest(context, artifacts));
      await uploadArtifact(context, dispatcher, trace, artifacts, manifestFile, "manifest-json", "manifest.json", logger);
      if (bundleFile) await uploadArtifact(context, dispatcher, trace, artifacts, bundleFile, "k8s-bundle", "k8s-bundle.tar.gz", logger);
      if (context.hasMenu) await uploadArtifact(context, dispatcher, trace, artifacts, context.menuFile, "menu-json", "menu.json", logger);
    } else logger.log("[3/5] suite 虚拟聚合包：零产物，跳过上传");

    if (args.deploy) await precheckRegistryImages(context, prepareBody.backendResources, dispatcher, trace, env, logger);
    logger.log("[4/5] release-complete（发布版本）...");
    const completeBody = {
      version: context.version,
      dependencies: dependencies(context),
      menuJson: context.menuJson,
      deploy: args.deploy,
      ...(dataSql.length ? { dataSql } : {}),
    };
    let complete;
    try {
      complete = await apiCall(context, dispatcher, trace, "release-complete", "POST", `/packages/${context.packageId}/release-complete`, completeBody);
    } catch (error) {
      fail(`release-complete 失败——发布未完成；前置成功时版本保持草稿态可重放：${error.message}`, { cause: error });
    }
    logReleaseResult(complete, args.deploy, logger);
    if (!options.skipSmoke) await smoke(context, dispatcher, trace, artifacts, logger);
    logger.log("==========================================");
    logger.log(`发布完成：${context.packageId}@${context.version}（测试底座）`);
    if (!args.deploy) logger.log("  提示：联调部署可加 --deploy；HMR 调试回路见 --dev-url");
    logger.log("  生产发布由平台管理员执行（本发布器不触达生产）");
    logger.log("==========================================");
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
    if (!options.dispatcher && dispatcher?.close) await dispatcher.close();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runPublish(process.argv.slice(2)).catch((error) => {
    console.error(`错误：${error.message}`);
    if (process.env.PUBLISH_DEBUG && error.cause) console.error(error.cause);
    process.exitCode = 1;
  });
}
