/**
 * 文件作用：天地图专用影像 Provider（在线/本地统一封装）
 * 说明：
 * - 在线层（providerType=tianditu）：直通 WebMapTileServiceImageryProvider，无覆盖限制。
 * - 本地层（providerType=local_wmts）：按 capabilities.xml 中 TileMatrixSetLimits
 *   声明的真实缓存范围，在 requestImage 前拦截——范围外瓦片直接 rejected（不发请求），
 *   Cesium 重试一次后标记 FAILED 并自动用上级瓦片拉伸显示，从源头消除 404 洪水。
 * - errorEvent 监听说明：Cesium 的 TileProviderError.reportError 在【无监听器】时
 *   会 console.log 每条瓦片错误（此前控制台洪水的另一半来源）；注册监听器后走
 *   raiseEvent 路径不再打印。noTile（声明范围外）静默吞掉；其他错误去重后限量打印。
 *   - 2026-07-20 自 extensions/core/basemap 下沉至 _shared/layer-factory，宿主与 basemap 共用。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-20
 * 版本：1.3.0
 * 修改记录：
 *   - 1.3.0 (2026-07-20) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { WmtsCapabilitiesParsed } from './types'

type Rect = [number, number, number, number] // [minCol, maxCol, minRow, maxRow]

/** 把声明矩形展开为 level -> Map<col, y 区间数组> 索引，查询为 O(1)+小区间扫描 */
function buildLimitsIndex(limits: Record<number, Rect[]>): Map<number, Map<number, Array<[number, number]>>> {
  const index = new Map<number, Map<number, Array<[number, number]>>>()
  for (const [lvlStr, rects] of Object.entries(limits)) {
    const lvl = Number(lvlStr)
    let colMap = index.get(lvl)
    if (!colMap) {
      colMap = new Map()
      index.set(lvl, colMap)
    }
    for (const [x0, x1, y0, y1] of rects) {
      for (let x = x0; x <= x1; x++) {
        let arr = colMap.get(x)
        if (!arr) {
          arr = []
          colMap.set(x, arr)
        }
        arr.push([y0, y1])
      }
    }
  }
  return index
}

function tileCovered(index: Map<number, Map<number, Array<[number, number]>>>, x: number, y: number, level: number): boolean {
  const colMap = index.get(level)
  if (!colMap) return false // 该层级无任何声明 → 全部拦截
  const arr = colMap.get(x)
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (y >= arr[i][0] && y <= arr[i][1]) return true
  }
  return false
}

/**
 * 创建天地图 WMTS Provider。
 * @param options capabilitiesToCesiumOptions 的输出（或在线层的等价参数）
 * @param limits  本地缓存覆盖声明；不传/undefined = 不限制（在线层）
 */
export function createTiandituWmtsProvider(
  options: any,
  limits?: WmtsCapabilitiesParsed['limits']
): any {
  const Cesium = (window as any).Cesium
  const provider = new Cesium.WebMapTileServiceImageryProvider(options)

  // 错误静音：注册 errorEvent 监听器，阻断 Cesium 默认的逐瓦片 console.log
  const loggedMessages = new Set<string>()
  provider.errorEvent.addEventListener((e: any) => {
    const details: any = e?.error
    if (details?.noTile) return // 声明范围外：预期行为，静默
    // 其他错误（网络 404/500 等，多为缓存空洞）：去重后限量打印，避免刷屏
    const msg = e?.message || String(details || e)
    if (loggedMessages.has(msg)) return
    if (loggedMessages.size >= 5) return
    loggedMessages.add(msg)
    console.warn('[tianditu] tile error (deduped):', msg)
  })

  if (limits && Object.keys(limits).length > 0) {
    const index = buildLimitsIndex(limits)
    const origRequestImage = provider.requestImage.bind(provider)
    provider.requestImage = function (x: number, y: number, level: number, request?: any) {
      if (!tileCovered(index, x, y, level)) {
        const err: any = new Error(`tile ${level}/${x}/${y} 不在本地缓存覆盖声明内`)
        err.noTile = true
        return Promise.reject(err)
      }
      return origRequestImage(x, y, level, request)
    }
  }

  return provider
}
