#!/usr/bin/env node
//
// 文件作用：版本校验 golden master 捕获——把现行 bash 版 check-extension-versions.sh 与
//          menujson.py 注入各夹具根运行，把 stdout 原文与退出码落为 expected.json
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（版本校验 Node 化 golden master 捕获端）
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 硬约束：被捕获的 bash 版按 SCRIPT_DIR 自定位仓根（REPO_ROOT=<case>，menujson.py 取
// <case>/tools/menujson.py），因此捕获时把参考实现与 menujson.py 拷入夹具根的 tools/，
// 跑完即删。bash 版退役后重新捕获：先从 git 历史恢复旧版 check-extension-versions.sh 到
// 本仓 tools/ 再运行本脚本。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF_CHECK = path.join(REPO_ROOT, "tools", "check-extension-versions.sh");
const REF_MENUJSON = path.join(REPO_ROOT, "tools", "menujson.py");
const CASES_DIR = path.join(REPO_ROOT, "tests", "fixtures", "check-versions-golden", "cases");

const cases = fs.readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const caseName of cases) {
  const caseDir = path.join(CASES_DIR, caseName);
  const toolsDir = path.join(caseDir, "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.copyFileSync(REF_CHECK, path.join(toolsDir, "check-extension-versions.sh"));
  fs.copyFileSync(REF_MENUJSON, path.join(toolsDir, "menujson.py"));
  try {
    const run = spawnSync("bash", [path.join(toolsDir, "check-extension-versions.sh")], {
      cwd: caseDir,
      encoding: "utf8",
    });
    const expected = { case: caseName, exitCode: run.status ?? 1, stdout: run.stdout };
    fs.writeFileSync(path.join(caseDir, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`, "utf8");
    console.log(`已捕获 ${caseName}：exitCode=${expected.exitCode}，stdout ${run.stdout.length} 字符`);
  } finally {
    fs.rmSync(toolsDir, { recursive: true, force: true });
  }
}
console.log("check-versions golden 捕获完成");
