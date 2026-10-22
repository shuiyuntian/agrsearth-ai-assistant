# contracts/ — 宿主共享依赖契约快照（vendored，sync-template.sh 生成，勿手改）

本目录两份文件是平台仓宿主契约的同步快照：

- `gis-platform-ui.host-contract.json` ← 平台仓 `platform/frontend/gis-platform-ui/host-contract.json`
- `ruoyi-admin.host-contract.json` ← 平台仓 `platform/frontend/ruoyi-admin/host-contract.json`

模板仓独立于平台仓分发，构建期硬校验（`packages/vite-config/host-contract.js` → `../contracts/` 候选位）读本目录快照。
**平台侧升级宿主共享依赖（改 host-contract.json）后，须重跑 `scripts/build/sync-template.sh` 刷新本目录**，
否则插件团队按旧契约构建的包上线后可能与新宿主不兼容。

同步方：平台管理员 ｜ 建立：2026-10-04（批4-P0）｜ 版权所有 (C) 2026 AGRSEarth 项目
