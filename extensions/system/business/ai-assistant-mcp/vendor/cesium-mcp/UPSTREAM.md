<!--
  文件作用：cesium-mcp vendor 块上游 pin 说明——上游仓库/pin 版本/fork 性质/同步与校验流程/红线
  作者：JasonLee <shuiyuntian@foxmail.com>
  创建日期：2026-10-03
  版本：1.0.2
  修改记录：
    - 1.0.2 (2026-11-10) CI 环境不再自动使用本机代理
    - 1.0.1 (2026-11-10) 同步与 pristine 校验明确保留本地 UPSTREAM.md
    - 1.0.0 (2026-10-03) 初始创建（vendor 块 UPSTREAM.md 统一治理，机器可读 pin 仍为 .upstream）

  版权所有 (C) 2026 CesiumAI 项目
-->
# UPSTREAM — cesium-mcp（CesiumGS/cesium-ai-integrations mcp/ 子树）

## 上游与 pin

| 项 | 值 |
|:--|:--|
| 上游仓库 | <https://github.com/CesiumGS/cesium-ai-integrations> |
| 同步子树 | `mcp/`（仅同步该子树，非整仓） |
| 当前 pin commit | `2606b49646c216f5670ede368ac678a7c880bb75` |
| 同步时间 | 2026-07-22 20:49:28 +0800 |
| fork 性质 | **pristine**（零修改，无补丁） |

机器可读 pin 文件为同目录 [`.upstream`](./.upstream)（repo / subtree / commit / synced_at 四行，
格式仿 `.kimi-code/skills/.cesiumjs-skills-upstream`）。**同步脚本读写它以它为唯一事实源，
本文件只是人类可读说明，改 pin 一律走同步脚本，禁止手改 `.upstream`。**

## 同步 / 升级流程

```bash
scripts/tools/sync-mcp-upstream.sh [commit-sha]   # 不传 sha 取上游 main 最新
```

脚本行为：下载上游 tarball → `mcp/` 子树 rsync --delete pristine 覆盖本目录（保留本地
`UPSTREAM.md` 治理说明）→ 同步上游 LICENSE → 重写 `.upstream` pin。幂等可重复执行。
本地代理默认 `http://127.0.0.1:7890`，可用 `HTTPS_PROXY` 覆盖；CI 不自动设置代理。

## 漂移校验

```bash
scripts/tools/sync-mcp-upstream.sh --check
```

按 `.upstream` 的 commit 拉取上游，与本目录做零 diff 校验（排除 `.upstream`、本地
`UPSTREAM.md`、LICENSE、node_modules/dist 等产物），非零退出即存在漂移。

## 补丁清单

无。本块为 pristine fork，不持有任何补丁；若未来出现本地修改需求，先评估能否落
桥接层，确需改源码时参照 `extensions/system/platform/sso/vendor/casdoor/` 的
patches/ 一补丁一文机制再立项。

## 红线

- **vendor 内禁止手改任何三方源码文件**——所有定制一律进桥接层（如
  `extensions/system/business/geolocation-services/` 的 geolocation-http 桥）；
  手改会在下次 `sync-mcp-upstream.sh` 被 `--delete` 静默覆盖，且 `--check` 会判漂移。
- 目录内 `node_modules/`、`dist/`、`pnpm-workspace.yaml`、`.DS_Store` 为本机/构建
  副产物，不属于 pin 内容，校验时排除。
