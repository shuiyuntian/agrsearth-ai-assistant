/**
 * 文件作用：layer-factory 共享类型定义
 * 说明：自 basemap 下沉的底图资源/Provider 类型，宿主与 basemap 扩展共用同一份定义；
 *       不依赖任何扩展包内部类型，保持本目录自包含。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-14) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/** 平台侧 http 上下文的最小契约（CapabilityContext.http 的结构子集） */
export interface HttpClientLike {
  get: <T = any>(url: string, params?: Record<string, any>) => Promise<T>
  post: <T = any>(url: string, body?: any) => Promise<T>
}

export type BaseLayerCategory = 'imagery' | 'terrain' | 'annotation' | 'tiles3d'
export type BaseLayerSourceType = 'online' | 'local' | 'builtin'
export type ImageryProviderType =
  | 'osm'
  | 'tianditu'
  | 'arcgis_online'
  | 'cesium_ion'
  | 'local_wmts'
  | 'bing'
  | 'satellite'
export type TerrainProviderType = 'ion_world_terrain' | 'ellipsoid' | 'cesium_terrain'
export type Tiles3dProviderType = 'google_tiles' | 'url'

export interface BaseLayer {
  id: number
  layerName: string
  layerCode: string
  category: BaseLayerCategory
  sourceType: BaseLayerSourceType
  providerType: ImageryProviderType | TerrainProviderType | Tiles3dProviderType | string
  urlTemplate: string
  previewUrl?: string
  tokenConfigKey?: string
  tokenValue?: string
  optionsJson?: string
  isDefault: string
  sortOrder: number
  status: string
  icon?: string
  remark?: string
}

export interface BaseLayerOptions {
  fileExtension?: string
  layer?: string
  style?: string
  tileMatrixSetID?: string
  format?: string
  mapStyle?: string
  assetId?: number
  requestVertexNormals?: boolean
  requestWaterMask?: boolean
  [key: string]: any
}

export interface WmtsCapabilitiesParsed {
  layer: string
  title?: string
  style?: string
  tileMatrixSetID?: string
  format?: string
  urlTemplate: string
  minLevel?: number
  maxLevel?: number
  bounds?: { west: number; south: number; east: number; north: number }
  /**
   * 覆盖范围声明：level -> 矩形数组 [minCol, maxCol, minRow, maxRow]
   * 来自 capabilities 中多个 TileMatrixSetLink/TileMatrixSetLimits；
   * 未声明（旧版 XML 无 limits）时为 undefined，表示不限制。
   */
  limits?: Record<number, Array<[number, number, number, number]>>
}
