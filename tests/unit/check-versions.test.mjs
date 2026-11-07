//
// 文件作用：Node 版本校验器边界行为回归测试（空仓、计数、字节宽表格列）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（版本校验 Node 化）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../tools/check-extension-versions.mjs";

const UNIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.resolve(UNIT_DIR, "../fixtures/check-versions-golden/cases");

test("extensions/ 不存在或为空时零包通过", (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "check-versions-empty-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const result = runCheck({ rootDir: empty });
  assert.equal(result.passCount, 0);
  assert.equal(result.failCount, 0);
  assert.ok(result.output.includes("共 0 个包：通过 0，失败 0"));
  assert.ok(!result.output.includes("失败详情"));
});

test("pass/fail 计数与结论列", () => {
  const caseDir = path.join(CASES, "pass-minimal");
  const pass = runCheck({ rootDir: caseDir });
  assert.equal(pass.passCount, 1);
  assert.equal(pass.failCount, 0);
  assert.ok(pass.output.includes("✔ 通过"));
  const fail = runCheck({ rootDir: path.join(CASES, "mismatch-manifest") });
  assert.equal(fail.passCount, 0);
  assert.equal(fail.failCount, 1);
  assert.ok(fail.output.includes("✘ 失败"));
  assert.ok(fail.output.includes("失败详情：\n  [extensions/tool/business/mismatch-manifest-demo] 版本不一致"));
});

test("表格列宽按 UTF-8 字节计（bash printf 语义）", () => {
  const result = runCheck({ rootDir: path.join(CASES, "pass-full") });
  const header = result.output.split("\n")[3];
  // "包" 为 3 字节：%-32s 补 29 字节 + 字段间 1 空格 = 包 后 30 个空格
  assert.ok(header.startsWith(`包${" ".repeat(30)}版本一致`));
});
