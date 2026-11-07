#!/usr/bin/env node
//
// 文件作用：以 Node 脚手架重放 scaffold-golden 夹具组合并校验文件树/stdout（可独立运行）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（脚手架 Node 化 golden master 重放端）
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 用法：node tests/replay-scaffold-golden.mjs [fixture.json ...]
//   不传参数时重放 tests/fixtures/scaffold-golden/ 下全部组合；重放生成的包目录在
//   校验后自动清理。确定性锚点：以夹具 capturedAt 经 AGRSEARTH_TODAY 注入日期。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCreate } from "../tools/create-extension.mjs";
import { hashTree } from "./lib/tree-snapshot.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function replayCombo(fixture) {
  const lines = [];
  const result = runCreate(fixture.args, {
    env: { AGRSEARTH_TODAY: fixture.capturedAt },
    logger: { log: (line) => lines.push(line) },
  });
  return { pkgDir: result.pkgDir, stdout: `${lines.join("\n")}\n` };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fixturesDir = path.join(REPO_ROOT, "tests", "fixtures", "scaffold-golden");
  const names = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, path.basename(name)), "utf8"));
    const replayed = replayCombo(fixture);
    try {
      assert.deepEqual(hashTree(replayed.pkgDir), fixture.files);
      assert.equal(replayed.stdout, fixture.stdout);
      console.log(`golden master 对拍通过：${fixture.combo}（${Object.keys(fixture.files).length} 个文件，stdout 一致）`);
    } finally {
      fs.rmSync(replayed.pkgDir, { recursive: true, force: true });
    }
  }
}
