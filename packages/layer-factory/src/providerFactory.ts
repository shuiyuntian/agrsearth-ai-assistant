/**
 * 文件作用：Cesium 图层/地形/3D Tiles Provider 工厂（_shared 共享版）
 * 说明：根据资源记录 providerType 创建对应 Cesium 实例，统一处理凭据、配置、错误提示。
 *       自 basemap 扩展下沉（原 extensions/core/basemap，现 extensions/tool/business/basemap），宿主与 basemap 扩展共用同一份建层代码。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-14
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-07-14) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { BaseLayer, BaseLayerOptions, HttpClientLike, WmtsCapabilitiesParsed } from './types'
import { capabilitiesToCesiumOptions, loadWmtsCapabilities } from './wmtsCapabilities'
import { createTiandituWmtsProvider } from './tiandituProvider'

const Cesium = () => (window as any).Cesium

function parseOptions(layer: BaseLayer): BaseLayerOptions {
  if (!layer.optionsJson) return {}
  try {
    return JSON.parse(layer.optionsJson) as BaseLayerOptions
  } catch {
    return {}
  }
}

function token(layer: BaseLayer): string {
  return layer.tokenValue || ''
}

/**
 * 确保 Cesium Ion Token 已设置（优先使用凭据表值，其次宿主已设值）
 */
function ensureIonToken(value: string) {
  const C = Cesium()
  if (value && C && C.Ion) {
    C.Ion.defaultAccessToken = value
  }
}

/**
 * 创建影像 Provider
 */
export async function createImageryProvider(
  layer: BaseLayer,
  http: HttpClientLike
): Promise<any> {
  const C = Cesium()
  if (!C) throw new Error('Cesium 未加载')

  const options = parseOptions(layer)

  switch (layer.providerType) {
    case 'osm':
      return new C.OpenStreetMapImageryProvider({
        url: layer.urlTemplate || 'https://a.tile.openstreetmap.org/',
        fileExtension: options.fileExtension || 'png'
      })

    case 'tianditu': {
      const tk = token(layer)
      const url = (layer.urlTemplate || '').replace('{token}', tk)
      if (!url) throw new Error(`${layer.layerName} 缺少 URL 模板`)
      return createTiandituWmtsProvider({
        url,
        layer: options.layer || 'img',
        style: options.style || 'default',
        tileMatrixSetID: options.tileMatrixSetID || 'w',
        format: options.format || 'image/jpeg'
      })
    }

    case 'arcgis_online':
      return new C.UrlTemplateImageryProvider({
        url: layer.urlTemplate || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      })

    case 'cesium_ion': {
      const ionToken = token(layer)
      if (!ionToken) throw new Error(`${layer.layerName} 缺少 Cesium Ion Token，请在凭据管理配置`)
      ensureIonToken(ionToken)
      const assetId = options.assetId ?? 2
      // 新版 Cesium 必须用 fromAssetId 工厂（直接 new 会缺 tilingScheme 报错）
      if (!C.IonImageryProvider?.fromAssetId) throw new Error('当前 Cesium 版本不支持 IonImageryProvider.fromAssetId')
      return await C.IonImageryProvider.fromAssetId(assetId)
    }

    case 'local_wmts': {
      if (!layer.urlTemplate) throw new Error(`${layer.layerName} 缺少 Capabilities URL`)
      const parsed: WmtsCapabilitiesParsed = await loadWmtsCapabilities(layer.urlTemplate, http)
      return createTiandituWmtsProvider(capabilitiesToCesiumOptions(parsed), parsed.limits)
    }

    case 'bing': {
      const key = token(layer)
      if (!key) throw new Error(`${layer.layerName} 缺少 Bing Key，请在凭据管理配置`)
      return new C.BingMapsImageryProvider({
        key,
        mapStyle: C.BingMapsStyle[options.mapStyle || 'AERIAL']
      })
    }

    case 'satellite':
      return new C.TileMapServiceImageryProvider({
        url: C.buildModuleUrl('Assets/Textures/NaturalEarthII')
      })

    default:
      throw new Error(`不支持的影像 provider 类型: ${layer.providerType}`)
  }
}

/**
 * 创建地形 Provider
 */
export async function createTerrainProvider(layer: BaseLayer): Promise<any> {
  const C = Cesium()
  if (!C) throw new Error('Cesium 未加载')

  switch (layer.providerType) {
    case 'ion_world_terrain': {
      const ionToken = token(layer)
      // 无 token 时 fromWorldTerrain 会拿到错误页数据，地形畸形导致全屏渲染变黑，
      // 与 bing/google 一样前置校验，避免异步失败拖垮底图
      if (!ionToken) throw new Error(`${layer.layerName} 缺少 Cesium Ion Token，请在凭据管理配置`)
      ensureIonToken(ionToken)
      // Terrain.fromWorldTerrain() 返回的是 Terrain 包装器（只适用于 viewer.terrain），
      // 赋给 viewer.terrainProvider 会因缺 availability 而全屏黑；
      // createWorldTerrainAsync 才返回真正的 CesiumTerrainProvider
      if (C.createWorldTerrainAsync) {
        return await C.createWorldTerrainAsync()
      }
      if (C.CesiumTerrainProvider?.fromIonAssetId) {
        return await C.CesiumTerrainProvider.fromIonAssetId(1)
      }
      throw new Error('当前 Cesium 版本不支持创建世界地形')
    }

    case 'ellipsoid':
      return new C.EllipsoidTerrainProvider()

    case 'cesium_terrain': {
      const options = parseOptions(layer)
      if (!layer.urlTemplate) throw new Error(`${layer.layerName} 缺少地形服务 URL`)
      return new C.CesiumTerrainProvider({
        url: layer.urlTemplate,
        requestVertexNormals: options.requestVertexNormals ?? false,
        requestWaterMask: options.requestWaterMask ?? false
      })
    }

    default:
      throw new Error(`不支持的地形 provider 类型: ${layer.providerType}`)
  }
}

/**
 * 创建 3D Tiles Tileset
 */
export async function createTiles3d(layer: BaseLayer): Promise<any> {
  const C = Cesium()
  if (!C || !C.Cesium3DTileset || !C.Cesium3DTileset.fromUrl) {
    throw new Error('当前 Cesium 版本不支持 Cesium3DTileset.fromUrl')
  }

  const options = parseOptions(layer)
  let url = layer.urlTemplate
  if (layer.providerType === 'google_tiles') {
    const key = token(layer)
    if (!key) throw new Error(`${layer.layerName} 缺少 Google API Key，请在凭据管理配置`)
    url = url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key)
  }
  if (!url) throw new Error(`${layer.layerName} 缺少 3D Tiles URL`)

  return await C.Cesium3DTileset.fromUrl(url, options)
}
