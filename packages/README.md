# packages — 能力包共享层

本目录存放所有能力包（`extensions/<track>/<tier>/<pkg>/`，含 tool/system 两轨）共享的脚手架与类型契约，本身不直接产生业务价值。

## 目录说明

| 目录 | 用途 |
|:---|:---|
| `sdk-types/` | 插件 ↔ 平台 `CapabilityContext`、`CapabilityManifest` 等 TypeScript 类型契约 |
| `ts-config/` | 扩展包公共 TypeScript 配置 |
| `vite-config/` | 扩展包公共 Vite Library 配置（`defineExtensionConfig`，支持 `alias`/`extraGlobals`/`exports` 参数） |
| `ui-utils/` | 扩展包公共 UI 工具（含简繁转换 `convertText`，opencc-js 经平台 import map 提供） |
| `layer-factory/` | 影像/地形/注记/3D Tiles provider 工厂（宿主与 basemap 共用，自 basemap 抽出） |
| `admin-sdk/` | 管理端远程扩展页运行时契约（ADR-007）：宿主能力桥接（`getAdminRequest`/`getBaseApi`）+ 通用类型 |
| `icon-kit/` | 共享图标库组件（`AppIcon`：EP 图标名 / `iconlib:` / `calcite:` 引用统一渲染） |

## 使用方式

依赖安装走**仓根统一 `pnpm install`**（2026-10-04 批4 起：仓根 `pnpm-workspace.yaml` 把 `platform/frontend/*`、`extensions/*/*/*/{frontend,admin-ui}`、`packages/*` 纳为成员，单一根 lockfile；成员目录内执行 `pnpm install` 会自动上溯仓根，效果等价。`ts-config/` 为纯配置目录非 npm 包）。

扩展包内部仍通过相对路径引用（源码级共享，产物预打包，未切换 workspace: 协议——决策见批4 根 workspace 回报）：

```ts
import type { CapabilityContext, CapabilityManifest } from '../../../../../packages/sdk-types/src'
```

后续可考虑将 `sdk-types` 发布为内部 npm 包 `@agrsearth/sdk-types`，但目前 monorepo 内相对路径最简单、最稳定。

图标渲染统一使用 `AppIcon`，模板仓直接声明 workspace 依赖 `@agrsearth/icon-kit`：

```vue
<script setup lang="ts">
import { AppIcon } from '@agrsearth/icon-kit'
</script>

<template>
  <AppIcon name="calcite:measure" :size="20" />
</template>
```

`name` 支持 EP 组件名、`calcite:<name>` 与 `iconlib:<instanceId>`；资产名通过 dev-mcp `icon_search` 实查，不要猜名。自定义副本由管理面 IconPicker 确认签发。
