//
// 文件作用：bash 版本校验 golden master 与 Node 重放逐用例对拍（stdout 字节级 + 退出码）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（版本校验 Node 化 golden master 回归）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../tools/check-extension-versions.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CASES = path.join(REPO_ROOT, "tests", "fixtures", "check-versions-golden", "cases");

const cases = fs.readdirSync(CASES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const caseName of cases) {
  test(`版本校验 golden 对拍：${caseName}`, () => {
    const caseDir = path.join(CASES, caseName);
    const expected = JSON.parse(fs.readFileSync(path.join(caseDir, "expected.json"), "utf8"));
    const result = runCheck({ rootDir: caseDir });
    assert.equal(result.output, expected.stdout);
    assert.equal(result.failCount > 0 ? 1 : 0, expected.exitCode);
  });
}
