# packages/ 目录：平台供给包（只读勿改）

`packages/` 下是 `@agrsearth/*` 平台供给包，由平台仓 `packages/` 经 `sync-template.sh`
单向同步下发（vendored）。**勿改勿删**——手工改动会在下次同步丢失；发现问题报平台管理员，
由平台仓源头修改后重新同步。

| 包 | 说明 |
|:---|:---|
| `@agrsearth/sdk-types` | Capability 类型契约（`CapabilityPackage` / `CapabilityContext` / manifest 类型） |
| `@agrsearth/vite-config` | 双端构建工厂（`defineExtensionConfig` 球端 / `defineAdminUiConfig` 管理端），内置宿主依赖 external 与 host-contract 构建期硬校验；`contracts/` 为双宿主契约快照 |
| `@agrsearth/ui-utils` | 前端共享 UI 工具（简繁转换等） |
| `@agrsearth/admin-sdk` | 管理端远程扩展页运行时契约（ADR-007）：`getBaseApi()` / 能力桥接，**替代** `createApp` 与 `import.meta.env` |
| `@agrsearth/icon-kit` | 共享图标库组件（AppIcon：EP 图标名 / iconlib: / calcite: 统一渲染） |
| `@agrsearth/layer-factory` | 影像/地形/注记/3D Tiles provider 工厂 |
| `ts-config` | 公共 tsconfig（纯配置目录，非 npm 包） |

你的扩展包不放这里——去 `extensions/<track>/<tier>/<pkg-id>/`（见 `extensions/README.md`）。

## 验收红线（供给物相关）

- 提测 PR 中 `packages/` 必须零 diff
- 宿主依赖（vue / vue-router / pinia / element-plus / @element-plus/icons-vue / cesium /
  echarts / opencc-js / `@/utils/request`）一律 external，不打进产物——构建必须经
  `@agrsearth/vite-config[/admin]`，禁止自研 vite 配置
