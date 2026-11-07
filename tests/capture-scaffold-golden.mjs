#!/usr/bin/env node
//
// 文件作用：脚手架 golden master 捕获——用现行 bash 版 tools/create-extension.sh 跑 6 组
//          参数组合，把生成树（文件清单+哈希+exec 位）与 stdout 落为 fixtures
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（脚手架 Node 化 golden master 捕获端）
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 硬约束：被捕获的 bash 版按 SCRIPT_DIR 自定位仓根，因此参考实现必须位于
// tools/create-extension.sh。bash 版退役后重新捕获：先从 git 历史恢复旧版到该路径
// （git show <Node化前commit>:tools/create-extension.sh > tools/create-extension.sh），
// 跑本脚本，再恢复薄 shim。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashTree } from "./lib/tree-snapshot.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = path.join(REPO_ROOT, "tools", "create-extension.sh");
const OUT_DIR = path.join(REPO_ROOT, "tests", "fixtures", "scaffold-golden");

const COMBOS = [
  ["golden-tool-min", "--track", "tool", "--tier", "platform", "--name", "金样最小工具"],
  ["golden-tool-admin", "--track", "tool", "--tier", "business", "--name", "金样管理工具", "--with-admin-ui"],
  ["golden-tool-backend", "--track", "tool", "--tier", "business", "--name", "金样后端工具", "--with-backend"],
  ["golden-tool-full", "--track", "tool", "--tier", "business", "--delivery", "bundled",
    "--name", "金样全配工具", "--icon", "Sunny", "--with-admin-ui", "--backend", "golden-svc"],
  ["golden-sys-biz", "--track", "system", "--tier", "business", "--name", "金样业务系统"],
  ["golden-sys-plat", "--track", "system", "--tier", "platform", "--name", "金样平台系统",
    "--backend", "golden-alpha", "--backend", "golden-beta", "--backend", "golden-gamma"],
];

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const capturedAt = localToday();
for (const args of COMBOS) {
  const id = args[0];
  const track = argValue(args, "--track");
  const tier = argValue(args, "--tier");
  const pkgDir = path.join(REPO_ROOT, "extensions", track, tier, id);
  if (fs.existsSync(pkgDir)) throw new Error(`捕获前目录已存在，先清理：${pkgDir}`);
  const run = spawnSync("bash", [REF, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`参考实现运行失败（${id}，退出码 ${run.status}）：\n${run.stdout}${run.stderr}`);
  }
  // stdout 归一：bash 版 cp -R 会把骨架内本地 npm install 产生的 node_modules（gitignored、
  // 不随仓分发）一并复制并进文件清单——非契约行为；Node 版不复制（依赖由仓根 npm install
  // 重建），故快照剔除 node_modules 清单行，与 files 哈希口径一致
  const stdout = run.stdout.split("\n").filter((line) => !line.includes("/node_modules/")).join("\n");
  const fixture = {
    combo: id,
    args,
    capturedAt,
    exitCode: run.status,
    stdout,
    files: hashTree(pkgDir),
  };
  fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  fs.rmSync(pkgDir, { recursive: true, force: true });
  console.log(`已捕获 ${id}：${Object.keys(fixture.files).length} 个文件`);
}
// 清理可能遗留的空 track/tier 父目录
for (const args of COMBOS) {
  const tierDir = path.join(REPO_ROOT, "extensions", argValue(args, "--track"), argValue(args, "--tier"));
  if (fs.existsSync(tierDir) && fs.readdirSync(tierDir).length === 0) fs.rmdirSync(tierDir);
}
console.log(`golden 捕获完成（capturedAt=${capturedAt}）→ tests/fixtures/scaffold-golden/`);
