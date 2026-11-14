/**
 * 文件作用：admin-api.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMySQL, staticUpManager, type SqlExecutor } from "../src/store/mysql.js";
import { createAdminRouter, PERMS } from "../src/admin/router.js";
import { RuntimeConfig, runtimeConfigSchema, makeConfigPersister } from "../src/config/runtime.js";
import type { Config } from "../src/config.js";

/**
 * admin API 集成测试：真实 MySQL（本地 3307，AI MySQL 8）。
 * 不可达时整体 skip（CI 无 MySQL 场景）。
 */
const MYSQL_TEST_URL =
  process.env.MYSQL_TEST_URL ?? "mysql://root@127.0.0.1:3307/ai_admin";

let mysql: SqlExecutor | null = null;
let server: Server | null = null;
let base = "";

function runtimeDefaults() {
  return runtimeConfigSchema.parse({
    llmBaseUrl: "http://127.0.0.1:8003/v1",
    llmModel: "test-model",
    agentMaxSteps: 8,
    rateLimitRpm: 20,
    approvalPolicy: ["entity_remove"],
  });
}

function buildApp(runtime: RuntimeConfig, permissions: string[]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userKey: "t", username: "tester", permissions, via: "dev" };
    next();
  });
  app.use(
    "/admin",
    createAdminRouter({
      config: { AUTH_ENABLED: true } as Config,
      runtime,
      mysql: mysql ? staticUpManager(mysql) : null,
      persistConfig: makeConfigPersister(mysql ? staticUpManager(mysql) : null),
    }),
  );
  return app;
}

async function api(path: string, init?: RequestInit) {
  const resp = await fetch(`${base}${path}`, init);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await resp.json().catch(() => null);
  return { status: resp.status, body };
}

let savedConfigRow: string | null = null;

beforeAll(async () => {
  mysql = await createMySQL(MYSQL_TEST_URL, { info: () => {}, warn: () => {} });
  if (!mysql) return;
  // 保存现场：测试结束恢复 ai_config 原行（测试会覆盖它）
  const existing = await mysql.query("SELECT config_json FROM ai_config WHERE id = 1");
  savedConfigRow = existing[0]
    ? typeof existing[0].config_json === "string"
      ? existing[0].config_json
      : JSON.stringify(existing[0].config_json)
    : null;
  // 清出测试数据域
  await mysql.execute("DELETE FROM ai_operation_log WHERE session_id LIKE 'vitest-%'");
  await mysql.execute("DELETE FROM ai_config WHERE id = 1");
  await mysql.execute(
    "INSERT INTO ai_config (id, config_json, update_by) VALUES (1, CAST(? AS JSON), 'vitest')",
    [JSON.stringify(runtimeDefaults())],
  );

  const app = buildApp(new RuntimeConfig(runtimeDefaults()), ["*:*:*"]);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  if (mysql) {
    await mysql.execute("DELETE FROM ai_operation_log WHERE session_id LIKE 'vitest-%'");
    // 恢复 ai_config 原行
    if (savedConfigRow) {
      await mysql.execute(
        "INSERT INTO ai_config (id, config_json, update_by) VALUES (1, CAST(? AS JSON), 'vitest-restore') ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)",
        [savedConfigRow],
      );
    }
    await mysql.close();
  }
});

describe("admin API（真实 MySQL）", () => {
  it("GET /config 返回生效配置且 llmApiKeyRef 脱敏", async (_ctx) => {
    if (!mysql) return _ctx.skip();
    const { status, body } = await api("/admin/config");
    expect(status).toBe(200);
    expect(body.data.agentMaxSteps).toBe(8);
    expect(body.data.llmApiKeyRef).toBeNull();
  });

  it("PUT /config 热更：落库 + 进程内即时生效", async (_ctx) => {
    if (!mysql) return _ctx.skip();
    const runtime = new RuntimeConfig(runtimeDefaults());
    const app = buildApp(runtime, ["*:*:*"]);
    const srv = app.listen(0);
    await new Promise<void>((r) => srv.once("listening", r));
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const put = await fetch(`${b}/admin/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentMaxSteps: 3, llmApiKeyRef: "secret-ref-1" }),
      });
      expect(put.status).toBe(200);
      const putBody: any = await put.json();
      // 脱敏回显
      expect(putBody.data.llmApiKeyRef).toBe("******");
      // 进程内即时生效
      expect(runtime.snapshot().agentMaxSteps).toBe(3);
      // 落库
      const rows = await mysql!.query(
        "SELECT JSON_EXTRACT(config_json,'$.agentMaxSteps') AS steps, JSON_EXTRACT(config_json,'$.llmApiKeyRef') AS ref, update_by FROM ai_config WHERE id=1",
      );
      expect(Number(rows[0]?.steps)).toBe(3);
      expect(rows[0]?.ref).toBe("secret-ref-1");
      expect(rows[0]?.update_by).toBe("tester");
      // 无效 patch → 400
      const bad = await fetch(`${b}/admin/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentMaxSteps: 0 }),
      });
      expect(bad.status).toBe(400);
    } finally {
      srv.close();
    }
  });

  it("权限校验：无权限串 403，有 *:*:* 放行", async (_ctx) => {
    if (!mysql) return _ctx.skip();
    for (const [perms, expectStatus] of [
      [[], 403],
      [["some:other:perm"], 403],
      [[PERMS.logList], 200],
      [["*:*:*"], 200],
    ] as Array<[string[], number]>) {
      const app = buildApp(new RuntimeConfig(runtimeDefaults()), perms);
      const srv = app.listen(0);
      await new Promise<void>((r) => srv.once("listening", r));
      const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const resp = await fetch(`${b}/admin/logs`);
      expect(resp.status).toBe(expectStatus);
      srv.close();
    }
  });

  it("stats/logs 聚合对账（插入已知数据）", async (_ctx) => {
    if (!mysql) return _ctx.skip();
    // 已知数据：2 llm（同 session 不同 user）、3 tool（2 成 1 败）、2 approval（1 批 1 拒）
    const insert =
      "INSERT INTO ai_operation_log (kind, username, session_id, tool_name, risk_level, args_summary, outcome, approval_status, duration_ms, model, prompt_tokens, completion_tokens, ip, created_at) VALUES ?";
    const rows = [
      ["llm", "u1", "vitest-s1", null, null, null, "success", null, 1000, "m1", 100, 50, "127.0.0.1", "2026-01-01 10:00:00"],
      ["llm", "u2", "vitest-s1", null, null, null, "success", null, 3000, "m1", 200, 100, "127.0.0.1", "2026-01-01 10:01:00"],
      ["tool", "u1", "vitest-s1", "camera_fly_to", "write", "{}", "success", null, 100, null, null, null, "127.0.0.1", "2026-01-01 10:00:10"],
      ["tool", "u1", "vitest-s1", "camera_fly_to", "write", "{}", "success", null, 300, null, null, null, "127.0.0.1", "2026-01-01 10:00:20"],
      ["tool", "u2", "vitest-s1", "entity_list", "read", "{}", "error", null, 500, null, null, null, "127.0.0.1", "2026-01-01 10:00:30"],
      ["approval", "u1", "vitest-s1", "entity_remove", "destructive", "{}", "approval_approved", "approved", 2000, null, null, null, "127.0.0.1", "2026-01-01 10:02:00"],
      ["approval", "u1", "vitest-s1", "entity_remove", "destructive", "{}", "approval_denied", "denied", 4000, null, null, null, "127.0.0.1", "2026-01-01 10:03:00"],
    ];
    await mysql!.query(insert, [rows]);

    const range = "beginTime=2026-01-01 00:00:00&endTime=2026-01-02 00:00:00";
    const sum = await api(`/admin/stats/summary?${range}`);
    expect(sum.status).toBe(200);
    expect(sum.body.data).toMatchObject({
      requests: 2,
      sessions: 1,
      activeUsers: 2,
      promptTokens: 300,
      completionTokens: 150,
    });
    expect(sum.body.data.approvalRate).toBeCloseTo(0.5);
    expect(sum.body.data.errorRate).toBeCloseTo(1 / 3);
    // duration 集合 {1000,3000,100,300,500,2000,4000}：avg=10900/7≈1557.14，p95=4000
    expect(sum.body.data.avgDurationMs).toBeCloseTo(10900 / 7);
    expect(sum.body.data.p95DurationMs).toBe(4000);

    const tools = await api(`/admin/stats/tools?topN=10&${range}`);
    expect(tools.body.data[0]).toMatchObject({ toolName: "camera_fly_to", calls: 2 });
    expect(Number(tools.body.data[0].successRate)).toBeCloseTo(1);
    expect(Number(tools.body.data[0].avgDurationMs)).toBeCloseTo(200);
    expect(tools.body.data[1]).toMatchObject({ toolName: "entity_list", calls: 1 });

    // logs 分页 total
    const page1 = await api(`/admin/logs?pageNum=1&pageSize=5&${range}`);
    expect(page1.body.total).toBe(7);
    expect(page1.body.rows).toHaveLength(5);
    const page2 = await api(`/admin/logs?pageNum=2&pageSize=5&${range}`);
    expect(page2.body.rows).toHaveLength(2);
    // 过滤
    const filtered = await api(`/admin/logs?username=u2&toolName=entity_list&${range}`);
    expect(filtered.body.total).toBe(1);

    await mysql!.execute("DELETE FROM ai_operation_log WHERE session_id LIKE 'vitest-%'");
  });
});

// ---------------------------------------------------------------------------
// MySQL 降级粘性修复验收：真实 3307 重连演练（本文件独占 MySQL，放文件尾部串行执行）
// ---------------------------------------------------------------------------
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { createMySQLManager, type MySQLManager } from "../src/store/mysql.js";
import { reloadRuntimeFromDb } from "../src/config/runtime.js";

const execFileP = promisify(execFile);
const MYSQLD = "/tmp/ai-mysql/bin/mysqld";
const MYSQLADMIN = "/tmp/ai-mysql/bin/mysqladmin";
const MYSQL_SOCKET = "/tmp/ai-mysql.sock";
const MYSQLD_ARGS = [
  `--datadir=/tmp/ai-mysql-data`,
  "--port=3307",
  `--socket=${MYSQL_SOCKET}`,
  "--mysqlx=0",
  "--bind-address=127.0.0.1",
  "--pid-file=/tmp/ai-mysql.pid",
];

async function mysqlAlive(): Promise<boolean> {
  try {
    await execFileP(MYSQLADMIN, ["-uroot", `--socket=${MYSQL_SOCKET}`, "ping"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number, intervalMs = 300): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function startMysqld(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const child = spawn(MYSQLD, MYSQLD_ARGS, { detached: true, stdio: "ignore" });
  child.unref();
  const ok = await waitFor(mysqlAlive, 30_000, 500);
  if (!ok) throw new Error("mysqld did not come up within 30s");
}

describe("MySQL 重连演练（真实 3307：up → 停 → down → 起 → 自动回 up）", () => {
  it("探测驱动状态迁移 + onRecovery + 恢复后配置可读", async (ctx) => {
    if (!fs.existsSync(MYSQLD)) return ctx.skip();
    if (!(await mysqlAlive())) await startMysqld();

    const mgr = (await createMySQLManager(MYSQL_TEST_URL, {
      healthIntervalMs: 200,
      logger: { info: () => {}, warn: () => {} },
    })) as MySQLManager;
    expect(mgr).not.toBeNull();
    let recovered = 0;
    mgr!.onRecovery(() => {
      recovered++;
    });

    try {
      // 1. 起始 up
      expect(mgr!.isUp()).toBe(true);
      expect(mgr!.executor()).not.toBeNull();

      // 2. 停 MySQL → 探测自动置 down
      await execFileP(MYSQLADMIN, ["-uroot", `--socket=${MYSQL_SOCKET}`, "shutdown"], { timeout: 10_000 });
      expect(await waitFor(async () => !mgr!.isUp(), 10_000)).toBe(true);
      expect(mgr!.executor()).toBeNull();

      // 3. 起 MySQL → 探测自动回 up（不调任何操作，纯探测驱动）
      await startMysqld();
      expect(await waitFor(async () => mgr!.isUp(), 15_000)).toBe(true);
      expect(recovered).toBeGreaterThanOrEqual(1);

      // 4. 恢复后：executor 可用、配置 reload 链路工作
      const rows = await mgr!.executor()!.query("SELECT 1 AS one");
      expect(Number(rows[0]?.one)).toBe(1);
      const rc = new RuntimeConfig(runtimeDefaults());
      await expect(reloadRuntimeFromDb(rc, mgr, { info: () => {}, warn: () => {} })).resolves.toBeTypeOf("boolean");
    } finally {
      await mgr!.close();
      // 兜底：无论成败都把 mysqld 拉起来（不拖累后续本地开发）
      if (!(await mysqlAlive())) await startMysqld();
    }
  }, 90_000);
});
