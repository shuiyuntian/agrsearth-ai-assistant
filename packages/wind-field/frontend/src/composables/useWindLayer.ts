/**
 * 文件作用：风场图层渲染（样例数据 → ctx.entities 风向箭头/粒子点；ADR-006 现场分组隔离：
 *          实体一律经 ctx.entities 落本包 CustomDataSource，宿主 deactivate 整组隐藏）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本：网格点粒子 + 风向箭头（杆+双翼折线），
 *     颜色按风速 HSL 映射（绿→红）；Cesium 对象一律经 getCesium() 取 window.Cesium
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import { getCesium } from '../utils/cesium'
import type { CapabilityContextLike, WindLayerStats, WindSample } from '../types'

/** 静止/微风的判定阈值（m/s）：低于此值只画点不画箭头 */
const CALM_SPEED = 0.3
/** 箭头半长占网格间距的比例（两端各占 0.36，留空避免相邻箭头相碰） */
const ARROW_HALF_RATIO = 0.36
/** 箭头翼线相对半长的比例、翼线张角（度） */
const WING_RATIO = 0.45
const WING_ANGLE_DEG = 28

/** 风速 → 颜色（HSL 绿(低速)→红(高速)，与面板图例同一映射） */
export function speedColor(speed: number, maxSpeed: number): any {
  const C = getCesium()
  const t = maxSpeed > 0 ? Math.min(Math.max(speed / maxSpeed, 0), 1) : 0
  const hue = (1 - t) * 0.38
  return C.Color.fromHsl(hue, 0.85, 0.55, 1.0)
}

/** 角度制工具（本地小函数，避免依赖 CesiumMath） */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 把样例数据渲染为本包实体（点 + 箭头），返回渲染统计。
 * 调用方负责 ctx.entities.removeAll() 清理（destroy/deactivate 路径）。
 */
export function renderWindLayer(ctx: CapabilityContextLike, sample: WindSample): WindLayerStats {
  const C = getCesium()
  const { grid, speedRange } = sample.meta
  const maxSpeed = Math.max(speedRange[1], 1)
  const half = grid.step * ARROW_HALF_RATIO
  const wingLen = half * WING_RATIO
  const wingAngle = toRad(WING_ANGLE_DEG)

  let sum = 0
  let min = Infinity
  let max = 0
  let pointCount = 0

  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const u = sample.u[j][i]
      const v = sample.v[j][i]
      const speed = Math.hypot(u, v)
      const lon = grid.lonMin + i * grid.step
      const lat = grid.latMin + j * grid.step
      const color = speedColor(speed, maxSpeed)

      sum += speed
      min = Math.min(min, speed)
      max = Math.max(max, speed)
      pointCount += 1

      // 网格点粒子（点实体，颜色按风速映射）
      ctx.entities.add({
        id: `windfield-pt-${i}-${j}`,
        position: C.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 4.5,
          color,
          outlineColor: C.Color.BLACK,
          outlineWidth: 1
        }
      })

      // 微风以下只留点，避免零长/抖动箭头
      if (speed < CALM_SPEED) continue

      const du = u / speed
      const dv = v / speed
      const headLon = lon + du * half
      const headLat = lat + dv * half
      const tailLon = lon - du * half
      const tailLat = lat - dv * half

      // 箭杆
      ctx.entities.add({
        id: `windfield-shaft-${i}-${j}`,
        polyline: {
          positions: C.Cartesian3.fromDegreesArray([tailLon, tailLat, headLon, headLat]),
          width: 1.8,
          material: color,
          arcType: C.ArcType.GEODESIC
        }
      })

      // 双翼（head 处向两侧张开）
      const baseAngle = Math.atan2(dv, du)
      for (let w = 0; w < 2; w++) {
        const sign = w === 0 ? 1 : -1
        const wingAngleRad = baseAngle + Math.PI - sign * wingAngle
        const wingLon = headLon + (wingLen * Math.cos(wingAngleRad)) / Math.max(Math.cos(toRad(headLat)), 0.3)
        const wingLat = headLat + wingLen * Math.sin(wingAngleRad)
        ctx.entities.add({
          id: `windfield-wing-${w}-${i}-${j}`,
          polyline: {
            positions: C.Cartesian3.fromDegreesArray([headLon, headLat, wingLon, wingLat]),
            width: 1.5,
            material: color,
            arcType: C.ArcType.GEODESIC
          }
        })
      }
    }
  }

  return {
    pointCount,
    minSpeed: Number(min.toFixed(1)),
    maxSpeed: Number(max.toFixed(1)),
    avgSpeed: Number((sum / pointCount).toFixed(1))
  }
}
