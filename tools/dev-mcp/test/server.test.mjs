// =============================================================================
// 文件作用：agrsearth-dev MCP 轻量测试（node:test，无新框架）——
//   ① PKCE/端口段等纯函数单测（含 RFC 7636 官方测试向量）；② 令牌落盘/读取/清理
//   （0600 权限）回环测试；③ JSON-RPC tools/list 冒烟：子进程起 server.mjs，
//   initialize + tools/list 握手，断言 28 个统一命名工具全部注册；④ 登录/DC 配置覆盖；
//   ⑤ 图标库三工具经本地 mock DC 完成真实 MCP 调用。
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-10-24
// 版本：1.8.2
// 修改记录：
//   - (2026-11-10) 1.8.2 覆盖 PG 账号返回字段及轮换/吊销指引
//   - (2026-11-10) 1.8.1 serverInfo 版本随 docs_read 指南范围修正同步
//   - (2026-11-09) 1.8.0 新增图标检索/详情/无状态烘焙工具及 mock DC 回环
//   - (2026-11-08) 1.7.0 覆盖 HMR 随包 CSS 指引并同步 serverInfo.version
//   - (2026-11-07) 1.6.2 覆盖 package_scaffold 直调 Node 脚手架（两模式 .mjs，不经 bash）
//     与平台模式 withAdminUi 显式报错；serverInfo.version 断言随包版本升 1.6.2
//   - (2026-11-07) 1.6.1 覆盖 listenLoopback 瞬态错误重试：EACCES 首败后重试成功、
//     全程瞬态失败耗尽聚合报错文案（30 次/最后错误码/重调提示）、EPERM 非瞬态不重试
//     （模板仓 issue #11 回归）；serverInfo.version 断言随包版本升 1.6.1
//   - (2026-11-06) 1.5.0 覆盖：run() env 可选覆盖 + package_publish 先 resolveToken 后
//     仅向 publish.mjs 子进程注入 AGRSEARTH_TOKEN（本地 mock publish.mjs 只输出是否
//     匹配期待值，绝不输出令牌本体；落盘文件/环境变量两通道各验一次；令牌不进输出
//     与审计文件）；instance_logs tailLines（1-2000 默认 500，tasks=true 忽略）经本地
//     mock DC 验证 query 透传；tools/list 断言 tailLines schema 与描述新口径、
//     serverInfo.version=1.5.0
//   - (2026-11-06) package_manage remove 覆盖：action 枚举/描述断言（仅限 DC 测试环境、
//     _trash/<packageId>/<时间-短ID>/ 回收目录、审计保留）+ 本地 mock DC 真实 HTTP
//     DELETE /packages/{packageId} 透传 trashPrefix/movedObjects；reason 闸口零请求拦截
//   - 1.4.0 (2026-11-05) 覆盖两步登录完整回环、Windows ESM 导入与解释器覆盖
//   - 1.3.0 (2026-11-05) 覆盖第 23 工具注册、模板模式真实调用/失败透传与平台模式边界
//   - 1.2.2 (2026-11-04) 新增 loopback HTTP 可等待/幂等关闭回归
//   - 1.2.1 (2026-11-04) 覆盖 Windows rundll32 授权 URL 与 HMR watch/preview 指南
//   - 1.2.0 (2026-11-02) 新增 SOCKS5 地址解析、认证可选和默认直连断言
//   - 1.1.0 (2026-11-02) 新增完整登录/DC URL、clientId 与自定义回跳端口段覆盖断言
//   - 1.0.0 (2026-10-24) 初始创建（绿地 21 工具冒烟 + auth 纯函数/令牌存储单测）
//   - 1.0.2 (2026-10-24) 断言扩展：DC P1/P2 落地——资源/重试/实例工具描述无【未实现】、
//     instance_list 必填 packageId、instance_logs tasks 参数、package_publish 描述含
//     DC 发布门面四步且不再 MinIO 直传/RM 登记
//   - 1.0.3 (2026-10-24) 断言扩展：package_manage archive/transfer action 与 targetTeamId、
//     resource scope 枚举 pg-dev/pg-admin + teamId、team_manage quota_request action、
//     task_get PACKAGE_MIGRATION 说明
//   - 1.0.4 (2026-10-24) 断言扩展：team_manage quota 三 action（quota_request 真实路径
//     quota-requests、quota_approve/quota_reject）、items[].quota 枚举 MENU_POOL/PACKAGE/PG、
//     taskId 参数、task_get QUOTA_APPROVAL 说明
//
// 版权所有 (C) 2026 AGRSEarth 项目
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "server.mjs");

// 必须在 import server.mjs 之前设置：令牌文件重定向到临时目录（不碰真实 ~/.config/agrsearth）
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-test-"));
process.env.AGRSEARTH_TOKEN_FILE = path.join(tmpDir, "token.json");
process.env.AGRSEARTH_DEV_BASE = "https://gateway.example:18443";
process.env.AGRSEARTH_DC_API_BASE = "https://dc.example:19412/custom/api";
process.env.AGRSEARTH_NATIVE_SESSION_URL = "https://auth.example:19200/custom/session";
process.env.AGRSEARTH_NATIVE_CALLBACK_URL = "https://auth.example:19200/custom/callback";
process.env.AGRSEARTH_DEV_CLIENT_ID = "custom-dev-cli";
process.env.AGRSEARTH_LOOPBACK_PORT_MIN = "51000";
process.env.AGRSEARTH_LOOPBACK_PORT_MAX = "51010";

const {
  computeS256Challenge, generatePkcePair, randomLoopbackPort, listenLoopback,
  saveTokenFile, loadTokenFile, clearTokenFile, TOOL_MANIFEST, DEV_MCP_CONFIG, parseSocksProxy,
  browserLaunchCommand, closeHttpServer, bashCommand,
} = await import(pathToFileURL(SERVER).href);

process.on("exit", () => { fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });

// ---------- ① PKCE 纯函数与可覆盖配置 ----------

test("computeS256Challenge 符合 RFC 7636 官方测试向量", () => {
  // RFC 7636 §4.2 附录示例
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(computeS256Challenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("generatePkcePair 形态合法（verifier 64 位、challenge 定长 43、challenge=S256(verifier)）", () => {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  assert.match(codeVerifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.match(codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(codeChallenge, computeS256Challenge(codeVerifier));
  // 两次生成不重复
  assert.notEqual(generatePkcePair().codeVerifier, codeVerifier);
});

test("登录和 DC 连接参数均可由环境覆盖", () => {
  assert.equal(DEV_MCP_CONFIG.devBase, "https://gateway.example:18443");
  assert.equal(DEV_MCP_CONFIG.dcApi, "https://dc.example:19412/custom/api");
  assert.equal(DEV_MCP_CONFIG.nativeSessionUrl, "https://auth.example:19200/custom/session");
  assert.equal(DEV_MCP_CONFIG.nativeCallbackUrl, "https://auth.example:19200/custom/callback");
  assert.equal(DEV_MCP_CONFIG.nativeClientId, "custom-dev-cli");
  assert.equal(DEV_MCP_CONFIG.loopbackPortMin, 51000);
  assert.equal(DEV_MCP_CONFIG.loopbackPortMax, 51010);
});

test("SOCKS5 代理地址解析支持主机、端口和可选认证", () => {
  assert.equal(parseSocksProxy(""), null);
  assert.deepEqual(parseSocksProxy("socks5h://127.0.0.1:51080"), { type: 5, host: "127.0.0.1", port: 51080 });
  assert.deepEqual(parseSocksProxy("socks5://user:pass@localhost:1080"), {
    type: 5, host: "localhost", port: 1080, userId: "user", password: "pass",
  });
  assert.throws(() => parseSocksProxy("http://127.0.0.1:1080"), /仅支持 socks5/);
  assert.equal(DEV_MCP_CONFIG.socksProxyEnabled, false, "未配置代理时保持直连");
});

test("Windows 授权 URL 经 rundll32 原样传递，不经 cmd start", async () => {
  const url = "https://casdoor.example/login/oauth/authorize?client_id=dev-cli&code_challenge=abc&state=xyz";
  assert.deepEqual(browserLaunchCommand(url, "win32"), [
    "rundll32.exe", ["url.dll,FileProtocolHandler", url],
  ]);
  const source = await fs.readFile(SERVER, "utf8");
  assert.ok(!source.includes('["cmd", ["/c", "start"'));
});

test("Windows bash 支持环境变量覆盖且默认不依赖 WSL", () => {
  assert.equal(bashCommand("win32", {}), "bash.exe");
  assert.equal(bashCommand("darwin", {}), "bash");
  assert.equal(bashCommand("win32", { AGRSEARTH_BASH: "C:\\Git\\bin\\bash.exe" }), "C:\\Git\\bin\\bash.exe");
});

test("HMR 指南使用 watch + vite preview，并按需包含随包 CSS", async () => {
  const source = await fs.readFile(SERVER, "utf8");
  assert.ok(source.includes("npx vite preview --outDir dist --host 0.0.0.0 --port ${port} --strictPort"));
  assert.ok(source.includes("--dev-url http://<本机IP>:${port}/${esmFile}"));
  assert.ok(source.includes("--dev-css-url http://<本机IP>:${port}/${cssFile}"));
  assert.ok(source.includes("reset 会同时恢复 ESM 与已有的 CSS 正式入口"));
  assert.ok(!source.includes("npm run dev -- --port"));
});

test("模板仓 precheck/publish 直接走 Node，不经 bash/python", async () => {
  const source = await fs.readFile(SERVER, "utf8");
  assert.match(source, /run\(process\.execPath, \["tools\/publish\.mjs", pkgDir, "--check-only"\]/);
  assert.match(source, /run\(process\.execPath, args, \{\s*timeoutMs: 1800000,\s*env: \{ AGRSEARTH_TOKEN: resolved\.token \},\s*\}\)/);
  assert.ok(!source.includes('run("bash", ["tools/publish.sh"'));
  assert.ok(!source.includes('run("python3", ["tools/menujson.py"'));
});

test("package_scaffold 两模式直调 Node 脚手架，不经 bash", async () => {
  const source = await fs.readFile(SERVER, "utf8");
  assert.ok(source.includes('MODE === "template" ? "tools/create-extension.mjs" : "scripts/create-extension.mjs"'));
  assert.match(source, /run\(process\.execPath, args, \{ timeoutMs: 120000 \}\)/);
  assert.ok(!source.includes('run(bashCommand(), args'));
  // 平台仓模式无 admin-ui 骨架能力：显式报错而非透传
  assert.ok(source.includes("平台仓脚手架不支持管理端页面骨架"));
});

test("run() 支持可选 env 覆盖且 package_publish 仅向子进程注入 AGRSEARTH_TOKEN", async () => {
  const source = await fs.readFile(SERVER, "utf8");
  // run() 第三参支持可选 env 覆盖（与 process.env 合并后仅作用于该子进程）
  assert.match(source, /function run\(cmd, args, \{ input, timeoutMs = 60000, cwd = ROOT, env \} = \{\}\)/);
  assert.ok(source.includes("env: env ? { ...process.env, ...env } : process.env"));
  // package_publish：先 resolveToken，再仅向 publish.mjs 子进程注入令牌
  assert.ok(source.includes("resolved = await resolveToken()"));
  assert.ok(source.includes("env: { AGRSEARTH_TOKEN: resolved.token }"));
  // 红线：不得向本进程环境写令牌（注入仅限子进程，本进程环境与审计绝不沾染）
  assert.ok(!source.includes("process.env.AGRSEARTH_TOKEN ="), "不得给本进程 process.env.AGRSEARTH_TOKEN 赋值");
});

test("仓根 .env.local 可覆盖登录配置且优先于内置默认值", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-env-"));
  try {
    const moduleDir = path.join(sandbox, "mcps", "agrsearth-dev");
    await fs.mkdir(moduleDir, { recursive: true });
    const serverCopy = path.join(moduleDir, "server.mjs");
    await fs.copyFile(SERVER, serverCopy);
    await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(moduleDir, "node_modules"), "dir");
    await fs.writeFile(path.join(sandbox, ".env.local"), [
      "AGRSEARTH_DEV_BASE=https://local-gateway.example:18081",
      "AGRSEARTH_DC_API_BASE=https://local-dc.example:19001/api",
      "AGRSEARTH_NATIVE_SESSION_URL=https://local-auth.example:19002/session",
      "AGRSEARTH_NATIVE_CALLBACK_URL=https://local-auth.example:19002/callback",
      "AGRSEARTH_DEV_CLIENT_ID=local-cli",
      "AGRSEARTH_LOOPBACK_PORT=52345",
    ].join("\n"));
    const script = `import { DEV_MCP_CONFIG } from ${JSON.stringify(pathToFileURL(serverCopy).href)}; console.log(JSON.stringify(DEV_MCP_CONFIG));`;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGRSEARTH_")));
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0, stderr);
    const config = JSON.parse(stdout);
    assert.equal(config.devBase, "https://local-gateway.example:18081");
    assert.equal(config.dcApi, "https://local-dc.example:19001/api");
    assert.equal(config.nativeSessionUrl, "https://local-auth.example:19002/session");
    assert.equal(config.nativeCallbackUrl, "https://local-auth.example:19002/callback");
    assert.equal(config.nativeClientId, "local-cli");
    assert.equal(config.loopbackPortMin, 52345);
    assert.equal(config.loopbackPortMax, 52345);
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test("randomLoopbackPort 落在自定义 51000-51010 段", () => {
  for (let i = 0; i < 200; i++) {
    const p = randomLoopbackPort();
    assert.ok(p >= 51000 && p <= 51010, `端口越界: ${p}`);
  }
});

test("loopback HTTP 清理可等待且重复调用安全", async () => {
  const server = http.createServer((req, res) => res.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  assert.equal(server.listening, true);
  await closeHttpServer(server);
  assert.equal(server.listening, false);
  await closeHttpServer(server);
});

const listenError = (code, message) => Object.assign(new Error(message), { code });

test("listenLoopback 瞬态 EACCES 重试后成功（模板仓 issue #11 回归）", async () => {
  let calls = 0;
  const { server, port } = await listenLoopback((req, res) => res.end("ok"), () => {
    calls += 1;
    return calls === 1 ? listenError("EACCES", "listen EACCES: permission denied 127.0.0.1:51003") : null;
  });
  assert.equal(calls, 2, "首次 EACCES 必须重试而不是直接失败");
  assert.ok(port >= 51000 && port <= 51010, `端口越界: ${port}`);
  assert.equal(server.listening, true);
  await closeHttpServer(server);
});

test("listenLoopback 全程瞬态失败耗尽后聚合报错（含尝试次数/最后错误码/重调提示）", async () => {
  await assert.rejects(
    () => listenLoopback((req, res) => res.end("ok"),
      () => listenError("EACCES", "listen EACCES: permission denied 127.0.0.1:51003")),
    (e) => {
      assert.match(e.message, /30 个端口/);
      assert.match(e.message, /EACCES/);
      assert.match(e.message, /重调 auth_login_start/);
      return true;
    },
  );
});

test("listenLoopback 非瞬态错误码（EPERM）不重试直接抛", async () => {
  let calls = 0;
  await assert.rejects(
    () => listenLoopback((req, res) => res.end("ok"), () => {
      calls += 1;
      return listenError("EPERM", "listen EPERM: operation not permitted");
    }),
    /operation not permitted/,
  );
  assert.equal(calls, 1, "非可重试错误码不得消耗剩余重试次数");
});

// ---------- ② 令牌落盘（0600）回环 ----------

test("令牌保存/读取/清理回环（文件权限 0600）", async () => {
  assert.equal(await loadTokenFile(), null, "初始应无令牌");
  await saveTokenFile({
    access_token: "test-token-abc", expire_in: 7200,
    obtained_at: "2026-10-24T00:00:00.000Z", dev_base: "http://example", client_id: "agrsearth-dev-cli",
  });
  const loaded = await loadTokenFile();
  assert.equal(loaded.access_token, "test-token-abc");
  const stat = await fs.stat(process.env.AGRSEARTH_TOKEN_FILE);
  assert.equal((stat.mode & 0o777), 0o600, "令牌文件权限必须是 0600");
  await clearTokenFile();
  assert.equal(await loadTokenFile(), null);
});

// ---------- ③ JSON-RPC tools/list 冒烟 ----------

test("JSON-RPC tools/list：28 个统一命名工具全部注册", { timeout: 30000 }, async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGRSEARTH_TOKEN_FILE: process.env.AGRSEARTH_TOKEN_FILE },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  let stderrText = "";
  child.stderr.on("data", (d) => { stderrText += d; });
  child.stdout.on("data", (d) => {
    buffer += d;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const call = (id, method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`JSON-RPC ${method} 超时`)), 15000);
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    });
  };

  try {
    const init = await call(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "node:test", version: "1.0.0" },
    });
    assert.equal(init.result?.serverInfo?.name, "agrsearth-dev", "server 名应为 agrsearth-dev");
    assert.equal(init.result?.serverInfo?.version, "1.8.2");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await call(2, "tools/list", {});
    const tools = list.result?.tools;
    assert.ok(Array.isArray(tools), "tools/list 应返回工具数组");
    const names = tools.map((t) => t.name).sort();
    const expected = [...TOOL_MANIFEST].sort();
    assert.deepEqual(names, expected,
      `工具清单不符：缺 ${expected.filter((n) => !names.includes(n))} / 多 ${names.filter((n) => !expected.includes(n))}`);
    assert.equal(tools.length, 28, "必须恰好 28 个工具");
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 10, `${t.name} 缺描述`);
      assert.ok(t.inputSchema && t.inputSchema.type === "object", `${t.name} 缺 inputSchema`);
    }
    const iconSearch = tools.find((t) => t.name === "icon_search");
    const iconGet = tools.find((t) => t.name === "icon_get");
    const iconBake = tools.find((t) => t.name === "icon_bake");
    assert.ok(iconSearch.description.includes("不要猜图标名"), "icon_search 须引导先查库");
    assert.equal(iconSearch.inputSchema.properties.pageSize.maximum, 50);
    assert.ok(iconGet.inputSchema.required?.includes("name"), "icon_get 必填资产名");
    assert.ok(!iconBake.inputSchema.properties.reason, "无状态烘焙不是持久化写操作");
    assert.ok(!names.some((n) => /^icon_(upload|derive|delete|issue)/.test(n)), "不得开放图标资产写库工具");
    const contract = tools.find((t) => t.name === "package_contract_check");
    assert.ok(contract, "必须注册 package_contract_check");
    assert.ok(contract.description.includes("双向 diff"), "契约工具须声明前后端双向 diff");
    const templateMode = await fs.stat(path.join(HERE, "..", "..", "..", "tools", "publish.sh")).then(() => true, () => false);
    const contractResult = await call(3, "tools/call", {
      name: "package_contract_check",
      arguments: { pkgDir: "extensions/tool/business/wind-field-demo" },
    });
    if (templateMode) {
      assert.notEqual(contractResult.result?.isError, true, "模板仓官方演示包须通过真实 URL 契约对账");
      assert.match(contractResult.result?.content?.[0]?.text ?? "", /URL 契约对账通过/);
    } else {
      assert.equal(contractResult.result?.isError, true, "平台仓模式须明确拒绝，不得假成功");
      assert.match(contractResult.result?.content?.[0]?.text ?? "", /仅适用于模板仓/);
    }
    // 关键写工具必须带 reason 字段声明
    const reg = tools.find((t) => t.name === "package_register");
    assert.ok(reg.inputSchema.properties.reason, "package_register 必须声明 reason 字段");
    const pub = tools.find((t) => t.name === "package_publish");
    assert.ok(pub.inputSchema.properties.reason, "package_publish 必须声明 reason 字段");
    // P1 资源/重试工具（DC 已落地，不再占位）：声明 reason + 关键参数 + 描述无【未实现】
    for (const name of ["resource_issue", "resource_rotate", "resource_revoke", "task_retry"]) {
      const t = tools.find((x) => x.name === name);
      assert.ok(t.inputSchema.properties.reason, `${name} 必须声明 reason 字段`);
      assert.ok(!t.description.includes("【未实现】"), `${name} 已落地 DC，描述不得再标【未实现】`);
    }
    const rl = tools.find((t) => t.name === "resource_list");
    assert.ok(!rl.description.includes("【未实现】"), "resource_list 描述不得再标【未实现】");
    assert.ok(rl.inputSchema.required?.includes("packageId"), "resource_list 必填 packageId");
    const es = tools.find((t) => t.name === "environment_status");
    assert.ok(es, "必须注册 environment_status");
    assert.ok(es.inputSchema.required?.includes("packageId"), "environment_status 必填 packageId");
    assert.ok(!es.inputSchema.properties.reason, "environment_status 只读，不需要 reason");
    assert.ok(es.description.includes("不开放全集群"), "environment_status 必须声明集群边界");
    assert.ok(es.description.includes("NOT_VERIFIED"), "environment_status 必须声明未验证语义");
    const ri = tools.find((t) => t.name === "resource_issue");
    assert.equal(ri.inputSchema.properties.scope?.default, "pg-dev", "resource_issue scope 默认 pg-dev");
    assert.deepEqual(ri.inputSchema.properties.scope?.enum, ["pg-dev", "pg-admin"], "resource_issue scope 枚举须含 pg-dev/pg-admin");
    assert.ok(ri.inputSchema.properties.teamId, "resource_issue 须声明 teamId 参数（pg-admin 锚点）");
    for (const field of ["roleName", "database", "schema", "jdbcUrl", "password", "expireTime", "newlyIssued"]) {
      assert.ok(ri.description.includes(field), `resource_issue 描述须说明返回字段 ${field}`);
    }
    assert.ok(ri.description.includes("resource_rotate"), "resource_issue 须指引忘记密码或续期时轮换");
    assert.ok(ri.description.includes("resource_revoke"), "resource_issue 须指引结束调试后吊销");
    const tr = tools.find((t) => t.name === "task_retry");
    assert.ok(tr.inputSchema.required?.includes("taskId"), "task_retry 必填 taskId");
    // P3 生命周期/团队管理账号：package_manage 增 archive/transfer；team_manage 增 quota_request
    const pm = tools.find((t) => t.name === "package_manage");
    const pmActions = pm.inputSchema.properties.action?.enum || [];
    for (const a of ["archive", "transfer"]) assert.ok(pmActions.includes(a), `package_manage action 枚举须含 ${a}`);
    assert.ok(pm.inputSchema.properties.targetTeamId, "package_manage 须声明 targetTeamId（transfer）");
    assert.ok(pm.description.includes("/packages/{packageId}/archive"), "package_manage 描述须含 archive 真实路径");
    assert.ok(pm.description.includes("/packages/{packageId}/transfer"), "package_manage 描述须含 transfer 真实路径");
    // remove（DC 测试环境移除测试包）：枚举 + 描述语义（回收目录/测试环境限定/审计保留/真实响应）
    assert.ok(pmActions.includes("remove"), "package_manage action 枚举须含 remove");
    assert.ok(pm.description.includes("DELETE /packages/{packageId}"), "remove 描述须含 DELETE /packages/{packageId} 真实路径");
    assert.ok(pm.description.includes("_trash/<packageId>/<时间-短ID>/"), "remove 描述须含 _trash 回收目录语义");
    assert.ok(/仅限 DC 测试环境/.test(pm.description), "remove 须声明仅限 DC 测试环境");
    assert.ok(pm.description.includes("trashPrefix") && pm.description.includes("movedObjects"), "remove 须声明透传 trashPrefix/movedObjects");
    const tm = tools.find((t) => t.name === "team_manage");
    const tmActions = tm.inputSchema.properties.action?.enum || [];
    for (const a of ["quota_request", "quota_approve", "quota_reject"]) {
      assert.ok(tmActions.includes(a), `team_manage action 枚举须含 ${a}`);
    }
    assert.ok(tm.description.includes("quota-requests"), "team_manage 描述须含 quota-requests 真实路径");
    assert.ok(tm.description.includes("quota-approve") && tm.description.includes("quota-reject"),
      "team_manage 描述须含 quota-approve/quota-reject 审批路径");
    assert.ok(tm.inputSchema.properties.items, "team_manage 须声明 items 参数（quota_request）");
    assert.deepEqual(
      tm.inputSchema.properties.items?.items?.properties?.quota?.enum,
      ["MENU_POOL", "PACKAGE", "PG"],
      "items[].quota 枚举须为 MENU_POOL/PACKAGE/PG（服务端真实字段名 quota）");
    assert.ok(tm.inputSchema.properties.taskId, "team_manage 须声明 taskId 参数（quota_approve/quota_reject）");
    const tg = tools.find((t) => t.name === "task_get");
    assert.ok(tg.description.includes("PACKAGE_MIGRATION"), "task_get 描述须含 PACKAGE_MIGRATION 迁移状态说明");
    assert.ok(tg.description.includes("QUOTA_APPROVAL"), "task_get 描述须含 QUOTA_APPROVAL 配额审批任务说明");
    // P2 实例门面（DC 已落地，不再占位）：描述无【未实现】+ 参数面
    for (const name of ["instance_list", "instance_logs"]) {
      const t = tools.find((x) => x.name === name);
      assert.ok(!t.description.includes("【未实现】"), `${name} 已落地 DC，描述不得再标【未实现】`);
    }
    const il = tools.find((t) => t.name === "instance_list");
    assert.ok(il.inputSchema.required?.includes("packageId"), "instance_list 必填 packageId（授权锚点）");
    const ilog = tools.find((t) => t.name === "instance_logs");
    assert.ok(ilog.inputSchema.required?.includes("instanceId"), "instance_logs 必填 instanceId");
    assert.equal(ilog.inputSchema.properties.tasks?.default, false, "instance_logs tasks 默认 false（查日志）");
    // v1.5.0：tailLines 可选（1-2000 默认 500，tasks=true 忽略），描述走 query 参数口径
    const tail = ilog.inputSchema.properties.tailLines;
    assert.ok(tail, "instance_logs 须声明 tailLines 参数");
    assert.equal(tail.type, "integer", "tailLines 必须为整数");
    assert.equal(tail.minimum, 1, "tailLines 下限 1");
    assert.equal(tail.maximum, 2000, "tailLines 上限 2000");
    assert.equal(tail.default, 500, "tailLines 默认 500");
    assert.ok(ilog.description.includes("/logs?tailLines"), "instance_logs 描述须含 tailLines query 参数");
    assert.ok(ilog.description.includes("1-2000"), "instance_logs 描述须含 1-2000 区间");
    assert.ok(!ilog.description.includes("服务端固定"), "instance_logs 描述不得再含「服务端固定」旧口径");
    // 全工具描述不应再有【未实现】占位
    for (const t of tools) {
      assert.ok(!t.description.includes("【未实现】"), `${t.name} 描述不应含【未实现】（全部 28 工具已落地）`);
    }
    // package_publish 描述应体现 DC 发布门面四步、不再 MinIO 直传/RM 登记
    assert.ok(pub.description.includes("release-prepare"), "package_publish 描述应含 release-prepare");
    assert.ok(pub.description.includes("upload-sessions"), "package_publish 描述应含 upload-sessions 预签名直传");
    assert.ok(pub.description.includes("release-complete"), "package_publish 描述应含 release-complete");
    assert.ok(!pub.description.includes("MinIO 直传"), "package_publish 描述不应再写 MinIO 直传");
    assert.ok(!/RM 登记|resource-manager 登记/.test(pub.description), "package_publish 描述不应再写 RM 登记");
    // v1.5.0：令牌仅注入 publish.mjs 子进程（不打印/不进审计）
    assert.ok(pub.description.includes("AGRSEARTH_TOKEN"), "package_publish 描述须声明 AGRSEARTH_TOKEN 子进程注入");
    assert.ok(pub.description.includes("resolveToken"), "package_publish 描述须声明执行前 resolveToken");
  } catch (e) {
    throw new Error(`${e.message}\n[server stderr]\n${stderrText}`);
  } finally {
    child.kill("SIGKILL");
  }
});

test("package_contract_check 在模板模式执行 Node 对账并透传失败", { timeout: 30000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-template-contract-")));
  const serverDir = path.join(root, "tools", "dev-mcp");
  const script = path.join(root, "tools", "check-api-contract.mjs");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.copyFile(SERVER, path.join(serverDir, "server.mjs"));
  await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(serverDir, "node_modules"), "junction");
  await fs.writeFile(path.join(root, "tools", "publish.sh"), "#!/usr/bin/env sh\n", "utf8");
  await fs.writeFile(script, 'console.log("URL 契约对账通过：mock");\n', "utf8");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const client = new Client({ name: "node:test-template-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: { ...process.env, AGRSEARTH_TOKEN_FILE: process.env.AGRSEARTH_TOKEN_FILE },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => console.error(chunk.toString()));
  await client.connect(transport);
  try {
    const passed = await client.callTool({
      name: "package_contract_check",
      arguments: { pkgDir: "extensions/tool/business/demo" },
    });
    assert.notEqual(passed.isError, true);
    assert.match(passed.content?.[0]?.text ?? "", /URL 契约对账通过：mock/);

    await fs.writeFile(script, 'console.error("错误：URL 契约对账失败：mock"); process.exitCode = 1;\n', "utf8");
    const failed = await client.callTool({
      name: "package_contract_check",
      arguments: { pkgDir: "extensions/tool/business/demo" },
    });
    assert.equal(failed.isError, true, "对账脚本非零退出必须返回 MCP isError");
    assert.match(failed.content?.[0]?.text ?? "", /URL 契约对账失败：mock/);
  } finally {
    await client.close();
  }
});

test("auth_login_start/wait 完成回跳、令牌落盘与有效期兼容", { timeout: 30000 }, async (t) => {
  let sessionBody = null;
  const mock = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/me") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 200, data: { userId: 7, username: "tester" } }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (req.method === "POST" && req.url === "/session") {
      sessionBody = body;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        code: 200,
        data: { state: "state-test", authorizeUrl: "http://example.invalid/authorize", expiresIn: 600 },
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/callback") {
      assert.equal(body.code, "auth-code");
      assert.equal(body.state, "state-test");
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        code: 200,
        data: { access_token: "test-token", expires_in: 7200 },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${mock.address().port}`;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-two-step-login-")));
  const serverDir = path.join(root, "tools", "dev-mcp");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.copyFile(SERVER, path.join(serverDir, "server.mjs"));
  await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(serverDir, "node_modules"), "junction");
  await fs.writeFile(path.join(root, "tools", "publish.sh"), "#!/usr/bin/env sh\n", "utf8");
  const tokenFile = path.join(root, "token.json");
  t.after(async () => {
    await new Promise((resolve) => mock.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const client = new Client({ name: "node:test-two-step-login", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: {
      ...process.env,
      AGRSEARTH_NATIVE_SESSION_URL: `${origin}/session`,
      AGRSEARTH_NATIVE_CALLBACK_URL: `${origin}/callback`,
      AGRSEARTH_DC_API_BASE: origin,
      AGRSEARTH_TOKEN_FILE: tokenFile,
      AGRSEARTH_SOCKS_PROXY: "",
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    const started = await client.callTool({
      name: "auth_login_start",
      arguments: { openBrowser: false, timeoutSeconds: 30 },
    });
    const text = started.content?.[0]?.text ?? "";
    const loginId = text.match(/loginId=([0-9a-f-]{36})/)?.[1];
    assert.ok(loginId, text);
    assert.ok(sessionBody?.redirectUri, "start 应已创建 loopback 与服务端会话");
    const callback = await fetch(`${sessionBody.redirectUri}?code=auth-code&state=state-test`);
    assert.equal(callback.status, 200);

    const completed = await client.callTool({
      name: "auth_login_wait",
      arguments: { loginId },
    });
    assert.notEqual(completed.isError, true, completed.content?.[0]?.text);
    assert.match(completed.content?.[0]?.text ?? "", /userId=7 username=tester/);
    assert.match(completed.content?.[0]?.text ?? "", /7200 秒/);
    const saved = JSON.parse(await fs.readFile(tokenFile, "utf8"));
    assert.equal(saved.access_token, "test-token");
    assert.equal(saved.expire_in, 7200);
  } finally {
    await client.close();
  }
});

test("package_manage remove：reason 闸口先拦截，通过后发真实 HTTP DELETE 透传 trashPrefix/movedObjects（本地 mock DC，零真实服务器/凭据）", { timeout: 30000 }, async (t) => {
  const requests = [];
  const mock = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    if (req.method === "DELETE" && req.url === "/packages/wind-field-demo") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        code: 200,
        data: {
          packageId: "wind-field-demo",
          trashPrefix: "_trash/wind-field-demo/20261106-153012-a1b2c3/",
          movedObjects: 7,
          registrationDeleted: true,
        },
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 404, msg: "not found" }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${mock.address().port}`;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-remove-")));
  const serverDir = path.join(root, "tools", "dev-mcp");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.copyFile(SERVER, path.join(serverDir, "server.mjs"));
  await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(serverDir, "node_modules"), "junction");
  t.after(async () => {
    await new Promise((resolve) => mock.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const client = new Client({ name: "node:test-remove", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: {
      ...process.env,
      AGRSEARTH_DC_API_BASE: origin, // 指向本地 mock，绝不触达真实 DC
      AGRSEARTH_TOKEN: "fake-test-token", // 假令牌仅验证透传，不读真实凭据
      AGRSEARTH_TOKEN_FILE: path.join(root, "token.json"),
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    // ① 缺 reason：handler 闸口拒绝，且不得发起任何 DC 请求
    const denied = await client.callTool({
      name: "package_manage",
      arguments: { action: "remove", packageId: "wind-field-demo" },
    });
    assert.equal(denied.isError, true, "remove 缺 reason 必须拒绝");
    assert.match(denied.content?.[0]?.text ?? "", /必须携带 reason/);
    assert.equal(requests.length, 0, "reason 闸口必须在任何 DC 请求之前拦截（零请求）");

    // ② 带 reason：真实 DELETE /packages/{packageId}，透传 trashPrefix/movedObjects 不假成功
    const removed = await client.callTool({
      name: "package_manage",
      arguments: { action: "remove", packageId: "wind-field-demo", reason: "DC 测试环境清理演示包" },
    });
    assert.notEqual(removed.isError, true, removed.content?.[0]?.text);
    const text = removed.content?.[0]?.text ?? "";
    assert.match(text, /HTTP 200/);
    assert.ok(text.includes("_trash/wind-field-demo/20261106-153012-a1b2c3/"), "须透传服务端 trashPrefix");
    assert.ok(text.includes('"movedObjects": 7'), "须透传服务端 movedObjects");
    assert.equal(requests.length, 1, "恰好一次 DC 请求");
    assert.equal(requests[0].method, "DELETE", "必须真实发 HTTP DELETE");
    assert.equal(requests[0].url, "/packages/wind-field-demo", "dcFetch base 已含 /api/v1，路径不得带前缀");
    assert.equal(requests[0].authorization, "Bearer fake-test-token");
  } finally {
    await client.close();
  }
});


test("instance_logs tailLines 透传 /logs?tailLines=N 且 tasks=true 忽略（本地 mock DC，零真实服务器/凭据）", { timeout: 30000 }, async (t) => {
  const requests = [];
  const mock = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.method === "GET" && (req.url.startsWith("/instances/svc-1/logs") || req.url === "/instances/svc-1/tasks")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 200, data: {
        instanceId: "svc-1", packageId: "demo", tailLines: 7,
        lines: Array.from({ length: 7 }, (_, i) => `第 ${i + 1} 行日志`),
      } }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 404, msg: "not found" }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${mock.address().port}`;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-logtails-")));
  const serverDir = path.join(root, "tools", "dev-mcp");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.copyFile(SERVER, path.join(serverDir, "server.mjs"));
  await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(serverDir, "node_modules"), "junction");
  t.after(async () => {
    await new Promise((resolve) => mock.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const client = new Client({ name: "node:test-logtails", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: {
      ...process.env,
      AGRSEARTH_DC_API_BASE: origin, // 指向本地 mock，绝不触达真实 DC
      AGRSEARTH_TOKEN: "fake-test-token", // 假令牌仅验证透传，不读真实凭据
      AGRSEARTH_TOKEN_FILE: path.join(root, "token.json"),
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    // ① 显式 tailLines=7 必须原样出现在 query
    const custom = await client.callTool({
      name: "instance_logs",
      arguments: { instanceId: "svc-1", tailLines: 7 },
    });
    assert.notEqual(custom.isError, true, custom.content?.[0]?.text);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/instances/svc-1/logs?tailLines=7", "tailLines 必须作为 query 参数透传");
    const customText = custom.content?.[0]?.text || "";
    assert.ok(!customText.includes("dev-mcp 截断"), "日志 JSON 不得按 tailLines 二次截断");
    const customBody = JSON.parse(customText.slice(customText.indexOf("{")));
    assert.equal(customBody.data.lines.length, 7);
    assert.equal(customBody.data.lines[6], "第 7 行日志");

    // ② 缺省 tailLines → 默认 500
    const defaulted = await client.callTool({
      name: "instance_logs",
      arguments: { instanceId: "svc-1" },
    });
    assert.notEqual(defaulted.isError, true, defaulted.content?.[0]?.text);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, "/instances/svc-1/logs?tailLines=500", "缺省 tailLines 必须发默认 500");

    // ③ tasks=true：走 /tasks 且忽略 tailLines（query 不得出现 tailLines）
    const tasks = await client.callTool({
      name: "instance_logs",
      arguments: { instanceId: "svc-1", tasks: true, tailLines: 42 },
    });
    assert.notEqual(tasks.isError, true, tasks.content?.[0]?.text);
    assert.equal(requests.length, 3);
    assert.equal(requests[2].url, "/instances/svc-1/tasks", "tasks=true 必须忽略 tailLines（不得拼进 query）");

    // ④ schema 钳制：tailLines 越界在客户端侧拒绝，不得发起 DC 请求
    const rejected = await client.callTool({
      name: "instance_logs",
      arguments: { instanceId: "svc-1", tailLines: 0 },
    });
    assert.equal(rejected.isError, true, "tailLines=0 必须被 schema 拒绝");
    assert.equal(requests.length, 3, "schema 拒绝不得发起任何 DC 请求");
  } finally {
    await client.close();
  }
});

test("package_publish 先 resolveToken 并仅向 publish.mjs 子进程注入 AGRSEARTH_TOKEN（模板沙箱 mock，两通道各验一次，零真实服务器）", { timeout: 60000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-pubtoken-")));
  const serverDir = path.join(root, "tools", "dev-mcp");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.copyFile(SERVER, path.join(serverDir, "server.mjs"));
  await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(serverDir, "node_modules"), "junction");
  await fs.writeFile(path.join(root, "tools", "publish.sh"), "#!/usr/bin/env sh\n", "utf8");
  // 测试辅助 mock publish.mjs：对比子进程 AGRSEARTH_TOKEN 与期待值，只输出是否匹配，绝不输出令牌本体
  await fs.writeFile(path.join(root, "tools", "publish.mjs"), [
    "const actual = process.env.AGRSEARTH_TOKEN || \"\";",
    "const expected = process.env.AGRSEARTH_DEV_MOCK_EXPECT_TOKEN || \"\";",
    "console.log(JSON.stringify({",
    "  tokenPresent: actual.length > 0,",
    "  tokenMatch: actual.length > 0 && actual === expected,",
    "  pkgDir: process.argv[2],",
    "}));",
    "",
  ].join("\n"), "utf8");
  const tokenFile = path.join(root, "token.json");
  const FILE_CHANNEL_TOKEN = "file-channel-token-xyz";
  const ENV_CHANNEL_TOKEN = "env-channel-token-abc";
  await fs.writeFile(tokenFile, JSON.stringify({
    access_token: FILE_CHANNEL_TOKEN, expire_in: 7200,
    obtained_at: "2026-11-06T00:00:00.000Z", dev_base: "http://example", client_id: "agrsearth-dev-cli",
  }), { mode: 0o600 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "AGRSEARTH_TOKEN" && key !== "AGRSEARTH_DEV_MOCK_EXPECT_TOKEN"),
  );
  const auditFiles = async () => {
    const dir = path.join(root, "logs", "operations");
    try {
      const names = await fs.readdir(dir);
      return (await Promise.all(names.map((n) => fs.readFile(path.join(dir, n), "utf8")))).join("\n");
    } catch { return ""; }
  };

  // 通道一：AGRSEARTH_TOKEN 环境变量（resolveToken 第一优先级，CI 覆盖通道）
  const envChannelClient = new Client({ name: "node:test-pubtoken-env", version: "1.0.0" });
  const envChannelTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: {
      ...baseEnv,
      AGRSEARTH_TOKEN: ENV_CHANNEL_TOKEN,
      AGRSEARTH_TOKEN_FILE: tokenFile, // 落盘文件同存异值：命中环境变量通道的证明
      AGRSEARTH_DEV_MOCK_EXPECT_TOKEN: ENV_CHANNEL_TOKEN,
      AGRSEARTH_DEV_BASE: "http://127.0.0.1:9", // 双保险：mock publish.mjs 零网络，绝不触达真实 DC
    },
    stderr: "pipe",
  });
  await envChannelClient.connect(envChannelTransport);
  try {
    const published = await envChannelClient.callTool({
      name: "package_publish",
      arguments: { pkgDir: "extensions/tool/business/wind-field", reason: "验证 CI 通道令牌子进程注入" },
    });
    assert.notEqual(published.isError, true, published.content?.[0]?.text);
    const text = published.content?.[0]?.text ?? "";
    assert.match(text, /"tokenPresent":true/, "子进程必须收到 AGRSEARTH_TOKEN");
    assert.match(text, /"tokenMatch":true/, "环境变量通道令牌必须原样注入 publish.mjs 子进程");
    assert.match(text, /"pkgDir":"extensions\/tool\/business\/wind-field"/, "pkgDir 参数须透传给 publish.mjs");
    assert.ok(!text.includes(ENV_CHANNEL_TOKEN), "工具输出绝不出现令牌本体");
    assert.ok(!text.includes(FILE_CHANNEL_TOKEN), "工具输出绝不出现任何通道令牌");
  } finally {
    await envChannelClient.close();
  }

  // 通道二：auth_login 落盘文件（环境变量缺席时 resolveToken 读文件）——本批修复主场景
  const fileChannelClient = new Client({ name: "node:test-pubtoken-file", version: "1.0.0" });
  const fileChannelTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: {
      ...baseEnv, // 关键：不含 AGRSEARTH_TOKEN
      AGRSEARTH_TOKEN_FILE: tokenFile,
      AGRSEARTH_DEV_MOCK_EXPECT_TOKEN: FILE_CHANNEL_TOKEN,
      AGRSEARTH_DEV_BASE: "http://127.0.0.1:9",
    },
    stderr: "pipe",
  });
  await fileChannelClient.connect(fileChannelTransport);
  try {
    const published = await fileChannelClient.callTool({
      name: "package_publish",
      arguments: { pkgDir: "extensions/tool/business/wind-field", skipBuild: true, reason: "验证落盘通道令牌子进程注入" },
    });
    assert.notEqual(published.isError, true, published.content?.[0]?.text);
    const text = published.content?.[0]?.text ?? "";
    assert.match(text, /"tokenPresent":true/, "子进程必须收到 AGRSEARTH_TOKEN");
    assert.match(text, /"tokenMatch":true/, "登录落盘令牌必须经 AGRSEARTH_TOKEN 注入 publish.mjs 子进程（本批修复主判据）");
    assert.ok(!text.includes(FILE_CHANNEL_TOKEN), "工具输出绝不出现令牌本体");
    assert.ok(!text.includes(ENV_CHANNEL_TOKEN), "工具输出绝不出现任何通道令牌");
  } finally {
    await fileChannelClient.close();
  }

  // 审计红线：两通道令牌均不得出现在审计文件（审计只记参数与结果码）
  const audited = await auditFiles();
  assert.ok(audited.length > 0, "写操作必须留有审计记录");
  assert.ok(!audited.includes(ENV_CHANNEL_TOKEN), "审计文件不得出现环境变量通道令牌");
  assert.ok(!audited.includes(FILE_CHANNEL_TOKEN), "审计文件不得出现落盘通道令牌");
});


test("icon_search/icon_get/icon_bake 经本地 mock DC 完成真实 MCP 调用", { timeout: 30000 }, async (t) => {
  const requests = [];
  const mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
      const json = (data) => res.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ code: 200, data }));
      if (req.method === "GET" && req.url.startsWith("/icons?")) {
        return json({ total: 1, rows: [{ name: "calcite-measure", nameZh: "测量", source: "calcite", iconRef: "calcite:measure" }] });
      }
      if (req.method === "GET" && req.url === "/icons/by-name/calcite-measure") {
        return json({ name: "calcite-measure", iconRef: "calcite:measure", variants: [{ size: "24", variant: "outline" }] });
      }
      if (req.method === "GET" && req.url.startsWith("/icons/by-name/calcite-measure/svg")) {
        return json("<svg><path/></svg>");
      }
      if (req.method === "GET" && req.url === "/icons/palette") {
        return json([{ key: "primary", hex: "#409EFF", usage: "主色" }]);
      }
      if (req.method === "POST" && req.url === "/icons/bake") {
        return json("<svg fill=\"#409EFF\"/>");
      }
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 404, msg: "not found" }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${mock.address().port}`;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agrsearth-dev-icons-")));
  const serverDir = path.join(root, "tools", "dev-mcp");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.copyFile(SERVER, path.join(serverDir, "server.mjs"));
  await fs.symlink(path.join(HERE, "..", "node_modules"), path.join(serverDir, "node_modules"), "junction");
  t.after(async () => {
    await new Promise((resolve) => mock.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const client = new Client({ name: "node:test-icons", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDir, "server.mjs")],
    cwd: root,
    env: {
      ...process.env,
      AGRSEARTH_DC_API_BASE: origin,
      AGRSEARTH_TOKEN: "fake-test-token",
      AGRSEARTH_TOKEN_FILE: path.join(root, "token.json"),
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    const searched = await client.callTool({ name: "icon_search", arguments: { keyword: "测量" } });
    assert.notEqual(searched.isError, true, searched.content?.[0]?.text);
    assert.match(searched.content?.[0]?.text ?? "", /calcite:measure/);
    assert.equal(requests[0].authorization, "Bearer fake-test-token");

    const detail = await client.callTool({
      name: "icon_get",
      arguments: { name: "calcite-measure", size: "24", includeSvg: true, includePalette: true },
    });
    assert.notEqual(detail.isError, true, detail.content?.[0]?.text);
    const detailBody = JSON.parse(detail.content?.[0]?.text ?? "{}");
    assert.equal(detailBody.iconRef, "calcite:measure");
    assert.equal(detailBody.svg, "<svg><path/></svg>");
    assert.equal(detailBody.palette[0].hex, "#409EFF");

    const baked = await client.callTool({
      name: "icon_bake",
      arguments: { name: "calcite-measure", color: "#409EFF", size: 24 },
    });
    assert.notEqual(baked.isError, true, baked.content?.[0]?.text);
    assert.equal(baked.content?.[0]?.text, "<svg fill=\"#409EFF\"/>");
    assert.equal(JSON.parse(requests.at(-1).body).name, "calcite-measure");

    const count = requests.length;
    const rejected = await client.callTool({ name: "icon_bake", arguments: {} });
    assert.equal(rejected.isError, true);
    assert.equal(requests.length, count, "缺少 name/layers 时不得发起 DC 请求");
  } finally {
    await client.close();
  }
});
