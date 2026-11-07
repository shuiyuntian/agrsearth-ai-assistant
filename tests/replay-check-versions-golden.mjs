#!/usr/bin/env node
//
// 文件作用：以 Node 校验器重放 check-versions-golden 各夹具用例并对拍（可独立运行）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（版本校验 Node 化 golden master 重放端）
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 用法：node tests/replay-check-versions-golden.mjs [case ...]
//   不传参数时重放 tests/fixtures/check-versions-golden/cases/ 下全部用例。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../tools/check-extension-versions.mjs";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "check-versions-golden", "cases");
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(CASES, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

for (const name of names) {
  const caseDir = path.join(CASES, name);
  const expected = JSON.parse(fs.readFileSync(path.join(caseDir, "expected.json"), "utf8"));
  const result = runCheck({ rootDir: caseDir });
  assert.equal(result.output, expected.stdout);
  assert.equal(result.failCount > 0 ? 1 : 0, expected.exitCode);
  console.log(`golden master 对拍通过：${name}（exitCode=${expected.exitCode}，stdout ${expected.stdout.length} 字符一致）`);
}
