//
// 文件作用：Node 脚手架参数校验、派生命名与目录红线回归测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（脚手架 Node 化：唯一实现 + golden master 组合快照）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolvePlan, deriveNames, runCreate, ScaffoldError } from "../../tools/create-extension.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const silentLogger = { log() {} };

test("parseArgs 解析全部开关与可重复 --backend", () => {
  assert.deepEqual(parseArgs([
    "demo-pkg", "--track", "system", "--tier", "platform", "--name", "演示",
    "--icon", "Sunny", "--with-backend", "--with-admin-ui",
    "--backend", "svc-a", "--backend", "svc-b",
  ]), {
    pkgId: "demo-pkg", track: "system", tier: "platform", delivery: "", name: "演示",
    icon: "Sunny", withBackend: true, withAdminUi: true, backends: ["svc-a", "svc-b"], help: false,
  });
});

test("参数校验规则与 bash 版逐项一致", () => {
  assert.throws(() => resolvePlan(parseArgs([])), /用法：/);
  assert.throws(() => resolvePlan(parseArgs(["Bad_Id", "--track", "tool", "--tier", "business"])), /只能包含小写字母、数字和中划线/);
  assert.throws(() => resolvePlan(parseArgs(["demo", "--track", "x", "--tier", "business"])), /--track 仅支持/);
  assert.throws(() => resolvePlan(parseArgs(["demo", "--track", "tool", "--tier", "x"])), /--tier 仅支持/);
  assert.throws(
    () => resolvePlan(parseArgs(["demo", "--track", "tool", "--tier", "business", "--delivery", "x"])),
    /--delivery 仅支持 bundled（标配）\/ optional（选装）：x/,
  );
  assert.throws(
    () => resolvePlan(parseArgs(["demo", "--track", "system", "--tier", "business", "--delivery", "bundled"])),
    /--delivery 仅适用于 --track tool --tier business 组合/,
  );
  assert.throws(
    () => resolvePlan(parseArgs(["demo", "--track", "tool", "--tier", "business", "--backend", "a", "--backend", "b"])),
    /工具轨（tool）至多一个后台微服务（--backend 重复 2 次）/,
  );
  assert.throws(
    () => resolvePlan(parseArgs(["demo", "--track", "system", "--tier", "business", "--backend", "Bad_Svc"])),
    /--backend service-id 只能包含小写字母、数字和中划线：Bad_Svc/,
  );
  assert.throws(() => parseArgs(["demo", "--bogus"]), /无法识别的参数：--bogus/);
  assert.throws(() => parseArgs(["a", "b"]), /多余的参数：b/);
});

test("默认值推导：delivery/name 与服务名注入", () => {
  const tool = resolvePlan(parseArgs(["demo", "--track", "tool", "--tier", "business", "--with-backend"]));
  assert.equal(tool.delivery, "optional");
  assert.equal(tool.name, "demo");
  assert.deepEqual(tool.backends, ["demo-server"]);
  const system = resolvePlan(parseArgs(["demo", "--track", "system", "--tier", "platform"]));
  assert.deepEqual(system.backends, ["demo-server", "demo-worker"]);
  assert.equal(system.delivery, "");
  // --with-backend 已注入默认服务时，系统轨不再追加骨架双服务
  const systemWith = resolvePlan(parseArgs(["demo", "--track", "system", "--tier", "platform", "--with-backend"]));
  assert.deepEqual(systemWith.backends, ["demo-server"]);
});

test("派生 UMD 全局名", () => {
  assert.deepEqual(deriveNames("my-cool-tool"), {
    globalName: "Capability_my_cool_tool",
    adminGlobalName: "AdminUI_mycooltool",
  });
});

test("目录已存在拒绝且不覆盖", (t) => {
  const pkgDir = path.join(REPO_ROOT, "extensions", "tool", "platform", "scaffold-test-collision");
  fs.mkdirSync(pkgDir, { recursive: true });
  t.after(() => fs.rmSync(pkgDir, { recursive: true, force: true }));
  assert.throws(
    () => runCreate(["scaffold-test-collision", "--track", "tool", "--tier", "platform"], { logger: silentLogger }),
    (error) => error instanceof ScaffoldError && /目录已存在：extensions\/tool\/platform\/scaffold-test-collision/.test(error.message),
  );
});

test("--help 输出用法且不建目录", () => {
  const lines = [];
  const result = runCreate(["--help"], { logger: { log: (line) => lines.push(line) } });
  assert.equal(result, null);
  assert.ok(lines[0].includes("用法："));
});
