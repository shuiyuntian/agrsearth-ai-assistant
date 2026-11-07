//
// 文件作用：目录树快照工具——golden master 捕获与重放共用的文件清单 + 哈希计算
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-07) 初始创建（脚手架/版本校验 Node 化 golden master 基础设施）
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 快照口径：
//   - 跳过 node_modules/ 目录（骨架内的 node_modules 是本地 npm install 产物，gitignored，
//     不随仓分发，不属于脚手架契约行为）与 .DS_Store；符号链接不入快照
//   - 哈希对内容做 CRLF→LF 归一后再取 SHA-256（.gitattributes text=auto，防 Windows 检出差异）
//   - 同时记录 exec 位（脚手架对 container/<svc>/build.sh 有 chmod +x 契约）

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function hashTree(rootDir) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(rootDir, full).split(path.sep).join("/");
      const text = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
      entries.push([rel, {
        sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
        exec: Boolean(fs.statSync(full).mode & 0o111),
      }]);
    }
  };
  walk(rootDir);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}
