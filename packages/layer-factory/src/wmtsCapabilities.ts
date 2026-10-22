/**
 * 文件作用：本地 WMTS Capabilities XML 解析（_shared 共享版）
 * 说明：优先前端直读 SeaweedFS XML（CORS 已开放），失败时回落后端代理解析接口。
 *       自 basemap 扩展下沉（原 extensions/core/basemap，现 extensions/tool/business/basemap），宿主与 basemap 扩展共用。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-14
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-07-14) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { HttpClientLike, WmtsCapabilitiesParsed } from './types'

interface CapabilitiesJson {
  layer: string
  title?: string
  style?: string
  tileMatrixSetID?: string
  format?: string
  urlTemplate: string
  minLevel?: number
  maxLevel?: number
  bounds?: { west: number; south: number; east: number; north: number }
}

function extractFirstElement(
  parent: Element,
  localName: string,
  namespace = '*'
): Element | null {
  const list = parent.getElementsByTagNameNS(namespace, localName)
  for (let i = 0; i < list.length; i++) {
    if (list[i].nodeType === Node.ELEMENT_NODE) {
      return list[i] as Element
    }
  }
  return null
}

function text(el: Element | null): string | undefined {
  const v = el?.textContent?.trim()
  return v ? v : undefined
}

function parseXml(xmlText: string): WmtsCapabilitiesParsed {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('XML 解析失败: ' + parseError.textContent?.slice(0, 100))
  }

  // GetTile 模板
  let urlTemplate: string | undefined
  const operations = doc.getElementsByTagNameNS('*', 'Operation')
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i] as Element
    if (op.getAttribute('name') !== 'GetTile') continue
    const getEl = extractFirstElement(op, 'Get')
    if (!getEl) continue
    const href =
      getEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      getEl.getAttribute('xlink:href') ||
      getEl.getAttribute('href')
    urlTemplate = href || undefined
    if (urlTemplate) break
  }
  if (!urlTemplate) {
    throw new Error('Capabilities 中未找到 GetTile URL 模板')
  }

  // 第一个 Layer
  const layerEl = extractFirstElement(doc.documentElement, 'Layer')
  if (!layerEl) {
    throw new Error('Capabilities 中未找到 Layer')
  }

  const layer = text(extractFirstElement(layerEl, 'Identifier')) || ''
  const title = text(extractFirstElement(layerEl, 'Title'))

  const styleEl = extractFirstElement(layerEl, 'Style')
  const style = text(extractFirstElement(styleEl || layerEl, 'Identifier'))
  const format =
    text(extractFirstElement(styleEl || layerEl, 'Format')) || 'image/png'

  const tmsLink = extractFirstElement(layerEl, 'TileMatrixSetLink')
  const tileMatrixSetID = text(extractFirstElement(tmsLink || layerEl, 'TileMatrixSet'))

  // 覆盖范围声明：遍历 Layer 下所有 TileMatrixSetLink，收集 TileMatrixSetLimits
  // （coverage-rebuild 生成的 XML 中每个 link 声明一个矩形范围的某层级；
  //   旧版 XML 只有一个无 limits 的 link，此时 limits 保持 undefined = 不限制）
  let limits: WmtsCapabilitiesParsed['limits']
  const linkEls = layerEl.getElementsByTagNameNS('*', 'TileMatrixSetLink')
  for (let i = 0; i < linkEls.length; i++) {
    const limitEls = (linkEls[i] as Element).getElementsByTagNameNS('*', 'TileMatrixLimits')
    for (let j = 0; j < limitEls.length; j++) {
      const le = limitEls[j] as Element
      const tmId = text(extractFirstElement(le, 'TileMatrix'))
      const minCol = parseInt(text(extractFirstElement(le, 'MinTileCol')) || '', 10)
      const maxCol = parseInt(text(extractFirstElement(le, 'MaxTileCol')) || '', 10)
      const minRow = parseInt(text(extractFirstElement(le, 'MinTileRow')) || '', 10)
      const maxRow = parseInt(text(extractFirstElement(le, 'MaxTileRow')) || '', 10)
      const lvl = tmId ? parseInt(tmId.split(':').pop() || '', 10) : NaN
      if ([lvl, minCol, maxCol, minRow, maxRow].every((n) => !isNaN(n))) {
        if (!limits) limits = {}
        ;(limits[lvl] || (limits[lvl] = [])).push([minCol, maxCol, minRow, maxRow])
      }
    }
  }

  // 层级范围
  let minLevel: number | undefined
  let maxLevel: number | undefined
  if (tileMatrixSetID) {
    const tmsList = doc.getElementsByTagNameNS('*', 'TileMatrixSet')
    for (let i = 0; i < tmsList.length; i++) {
      const tms = tmsList[i] as Element
      const id = text(extractFirstElement(tms, 'Identifier'))
      if (id !== tileMatrixSetID) continue
      const tmList = tms.getElementsByTagNameNS('*', 'TileMatrix')
      const levels: number[] = []
      for (let j = 0; j < tmList.length; j++) {
        const tmId = text(extractFirstElement(tmList[j] as Element, 'Identifier'))
        if (!tmId) continue
        const parts = tmId.split(':')
        const last = parts[parts.length - 1]
        const lvl = parseInt(last, 10)
        if (!isNaN(lvl)) levels.push(lvl)
      }
      if (levels.length) {
        minLevel = Math.min(...levels)
        maxLevel = Math.max(...levels)
      }
      break
    }
  }

  // Bounds
  let bounds: WmtsCapabilitiesParsed['bounds']
  const bbox = extractFirstElement(layerEl, 'WGS84BoundingBox')
  if (bbox) {
    const lower = text(extractFirstElement(bbox, 'LowerCorner'))
    const upper = text(extractFirstElement(bbox, 'UpperCorner'))
    if (lower && upper) {
      const [west, south] = lower.split(/\s+/).map(Number)
      const [east, north] = upper.split(/\s+/).map(Number)
      if ([west, south, east, north].every((n) => !isNaN(n))) {
        bounds = { west, south, east, north }
      }
    }
  }

  return {
    layer,
    title,
    style,
    tileMatrixSetID,
    format,
    urlTemplate,
    minLevel,
    maxLevel,
    bounds,
    limits
  }
}

/**
 * 解析结果缓存：同一 capabilitiesUrl 只解析一次。
 * 本地缓存的 XML 可能达 20MB（含覆盖声明），重复下载+解析会明显拖慢切换。
 * capabilities 重新生成后刷新页面即可生效。
 */
const parsedCache = new Map<string, Promise<WmtsCapabilitiesParsed>>()

/**
 * 解析 Capabilities，支持前端直读 + 后端代理回落
 */
export function loadWmtsCapabilities(
  capabilitiesUrl: string,
  http: HttpClientLike
): Promise<WmtsCapabilitiesParsed> {
  let cached = parsedCache.get(capabilitiesUrl)
  if (!cached) {
    cached = doLoad(capabilitiesUrl, http)
    parsedCache.set(capabilitiesUrl, cached)
  }
  return cached
}

async function doLoad(
  capabilitiesUrl: string,
  http: HttpClientLike
): Promise<WmtsCapabilitiesParsed> {
  // 1) 优先前端直读（no-cache：capabilities 会被 coverage-rebuild 流水线重新生成，
  //    强制 revalidate 以拿到最新版本；SeaweedFS 带 ETag，未变更时返回 304 开销很小）
  try {
    const resp = await fetch(capabilitiesUrl, { method: 'GET', cache: 'no-cache' })
    if (resp.ok) {
      const xml = await resp.text()
      return parseXml(xml)
    }
  } catch (e: any) {
    console.warn('[basemap] 前端直读 Capabilities 失败，尝试后端代理:', e.message)
  }

  // 2) 回落后端代理解析（注意：该路径不返回 limits，本地图层将不做覆盖拦截）
  const json = await http.get<CapabilitiesJson>('/gis/baselayer/local-wmts/capabilities', {
    url: capabilitiesUrl
  })
  if (!json || !json.urlTemplate) {
    throw new Error('后端代理解析 Capabilities 返回数据不完整')
  }
  return {
    layer: json.layer,
    title: json.title,
    style: json.style,
    tileMatrixSetID: json.tileMatrixSetID,
    format: json.format,
    urlTemplate: json.urlTemplate,
    minLevel: json.minLevel,
    maxLevel: json.maxLevel,
    bounds: json.bounds
  }
}

/**
 * 预解析 Capabilities 转为 Cesium WebMapTileServiceImageryProvider 可识别的 RESTful 模板
 * Capabilities 模板示例：.../tiles/{TileMatrix}/{TileCol}/{TileRow}.png
 *
 * 层级对齐说明：天地图 TileMatrix 标识符 1..22 的网格为 2^N（z1=2×2、z2=4×4），
 * 与 Cesium WebMercatorTilingScheme 的 level N（网格同为 2^N）一一对应。
 * 因此【不传 tileMatrixLabels】，让 Cesium 用 level 数字本身做恒等替换；
 * 传错（如字符串 'w' 或 ['1',...,'22']）会导致占位符保留或整体偏移一级。
 * minimumLevel 取 Capabilities 中的最小层级（天地图无 z0 的 1×1，从 1 开始）。
 * maximumLevel 直接取 XML 声明值——由 coverage-rebuild 流水线按实际库存生成，
 * 不再在代码里硬编码钳制（缓存同步后重建 XML 即自动生效）。
 */
export function capabilitiesToCesiumOptions(parsed: WmtsCapabilitiesParsed): any {
  return {
    url: parsed.urlTemplate,
    layer: parsed.layer,
    style: parsed.style || 'default',
    tileMatrixSetID: parsed.tileMatrixSetID || 'w',
    format: parsed.format || 'image/png',
    minimumLevel: parsed.minLevel ?? 0,
    maximumLevel: parsed.maxLevel ?? 18,
    rectangle: parsed.bounds
      ? (window as any).Cesium.Rectangle.fromDegrees(
          parsed.bounds.west,
          parsed.bounds.south,
          parsed.bounds.east,
          parsed.bounds.north
        )
      : undefined
  }
}
