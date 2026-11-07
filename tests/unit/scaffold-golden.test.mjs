//
// 文件作用：bash 脚手架 golden master 与 Node 重放逐组合对拍（文件树哈希 + exec 位 + stdout）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（脚手架 Node 化 golden master 回归）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCreate } from "../../tools/create-extension.mjs";
import { hashTree } from "../lib/tree-snapshot.mjs";
import { replayCombo } from "../replay-scaffold-golden.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(REPO_ROOT, "tests", "fixtures", "scaffold-golden");

const fixtures = fs.readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const name of fixtures) {
  test(`脚手架 golden 对拍：${name.replace(/\.json$/, "")}`, (t) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
    const replayed = replayCombo(fixture);
    t.after(() => fs.rmSync(replayed.pkgDir, { recursive: true, force: true }));
    assert.deepEqual(hashTree(replayed.pkgDir), fixture.files);
    assert.equal(replayed.stdout, fixture.stdout);
  });
}
