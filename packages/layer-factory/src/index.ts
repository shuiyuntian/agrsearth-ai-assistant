/**
 * 文件作用：layer-factory 统一导出
 * 说明：宿主与 basemap 扩展共用同一份建层代码（provider 工厂 / WMTS 解析 / 天地图 Provider）。
 * 使用方式（对照 packages/ui-utils 的引用模式）：
 *   vite alias / tsconfig paths 配置 '@shared/layer-factory' 指向本文件，然后：
 *   import { createImageryProvider, createTerrainProvider, createTiles3d } from '@shared/layer-factory'
 *   import type { BaseLayer, WmtsCapabilitiesParsed } from '@shared/layer-factory'
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-21
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-21) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

export * from './types'
export * from './providerFactory'
export * from './wmtsCapabilities'
export * from './tiandituProvider'
