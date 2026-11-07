# scaffold golden master

- `<combo>.json`：2026-11-07 在 macOS 用 bash 版 `tools/create-extension.sh`（1.1.1，Node 化前最后一个版本）跑 6 组参数组合的真实生成记录：`args`（入参）、`capturedAt`（日期锚点）、`stdout`（完整输出）、`files`（相对路径 → SHA-256 + exec 位）。
- 组合覆盖：tool·platform 最小 / tool·business+admin-ui / tool·business+backend / tool·business 全配（bundled+自定义名/图标/服务名）/ system·business 默认双服务 / system·platform 三自定义服务。
- 哈希口径：内容 CRLF→LF 归一后取 SHA-256；跳过 `node_modules/` 与 `.DS_Store`；符号链接不入快照。

**有意差异记录**：bash 版 `cp -R` 会把骨架内本地 `npm install` 产生的 `node_modules/`（gitignored、不随仓分发）一并复制进新包并列入 stdout 文件清单——属本地环境污染而非契约行为。快照的 files/stdout 均已剔除 node_modules 条目；Node 版脚手架不复制 node_modules（新包依赖经仓根 `npm install` 重建）。

确定性锚点：重放经 `AGRSEARTH_TODAY=<capturedAt>` 固定日期（CHANGELOG 与文件头日期）。

固定 fixture 的自动比较由 `tests/unit/scaffold-golden.test.mjs` 执行；手动重放全部组合：

```bash
node tests/replay-scaffold-golden.mjs
```

重新捕获（骨架或脚手架行为有意变更后）：参考实现必须位于 `tools/create-extension.sh`——先从 git 历史恢复 bash 版，跑 `node tests/capture-scaffold-golden.mjs`，再恢复薄 shim。若属 Node 版有意行为变更，直接以 `tests/capture-scaffold-golden.mjs` 同款逻辑改为调 Node 版重录（改动须在 CHANGELOG 说明）。
