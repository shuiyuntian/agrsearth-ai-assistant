// =============================================================================
// 文件作用：agrsearth-dev MCP 轻量测试（node:test，无新框架）——
//   ① PKCE/端口段等纯函数单测（含 RFC 7636 官方测试向量）；② 令牌落盘/读取/清理
//   （0600 权限）回环测试；③ JSON-RPC tools/list 冒烟：子进程起 server.mjs，
//   initialize + tools/list 握手，断言 22 个统一命名工具全部注册；④ 登录/DC 配置覆盖。
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-10-24
// 版本：1.2.0
// 修改记录：
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
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
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
  computeS256Challenge, generatePkcePair, randomLoopbackPort,
  saveTokenFile, loadTokenFile, clearTokenFile, TOOL_MANIFEST, DEV_MCP_CONFIG, parseSocksProxy,
} = await import(SERVER);

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

test("JSON-RPC tools/list：22 个统一命名工具全部注册", { timeout: 30000 }, async () => {
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
    assert.equal(init.result?.serverInfo?.version, "1.2.1");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await call(2, "tools/list", {});
    const tools = list.result?.tools;
    assert.ok(Array.isArray(tools), "tools/list 应返回工具数组");
    const names = tools.map((t) => t.name).sort();
    const expected = [...TOOL_MANIFEST].sort();
    assert.deepEqual(names, expected,
      `工具清单不符：缺 ${expected.filter((n) => !names.includes(n))} / 多 ${names.filter((n) => !expected.includes(n))}`);
    assert.equal(tools.length, 22, "必须恰好 22 个工具");
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 10, `${t.name} 缺描述`);
      assert.ok(t.inputSchema && t.inputSchema.type === "object", `${t.name} 缺 inputSchema`);
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
    const tr = tools.find((t) => t.name === "task_retry");
    assert.ok(tr.inputSchema.required?.includes("taskId"), "task_retry 必填 taskId");
    // P3 生命周期/团队管理账号：package_manage 增 archive/transfer；team_manage 增 quota_request
    const pm = tools.find((t) => t.name === "package_manage");
    const pmActions = pm.inputSchema.properties.action?.enum || [];
    for (const a of ["archive", "transfer"]) assert.ok(pmActions.includes(a), `package_manage action 枚举须含 ${a}`);
    assert.ok(pm.inputSchema.properties.targetTeamId, "package_manage 须声明 targetTeamId（transfer）");
    assert.ok(pm.description.includes("/packages/{packageId}/archive"), "package_manage 描述须含 archive 真实路径");
    assert.ok(pm.description.includes("/packages/{packageId}/transfer"), "package_manage 描述须含 transfer 真实路径");
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
    // 全工具描述不应再有【未实现】占位
    for (const t of tools) {
      assert.ok(!t.description.includes("【未实现】"), `${t.name} 描述不应含【未实现】（全部 22 工具已落地）`);
    }
    // package_publish 描述应体现 DC 发布门面四步、不再 MinIO 直传/RM 登记
    assert.ok(pub.description.includes("release-prepare"), "package_publish 描述应含 release-prepare");
    assert.ok(pub.description.includes("upload-sessions"), "package_publish 描述应含 upload-sessions 预签名直传");
    assert.ok(pub.description.includes("release-complete"), "package_publish 描述应含 release-complete");
    assert.ok(!pub.description.includes("MinIO 直传"), "package_publish 描述不应再写 MinIO 直传");
    assert.ok(!/RM 登记|resource-manager 登记/.test(pub.description), "package_publish 描述不应再写 RM 登记");
  } catch (e) {
    throw new Error(`${e.message}\n[server stderr]\n${stderrText}`);
  } finally {
    child.kill("SIGKILL");
  }
});
