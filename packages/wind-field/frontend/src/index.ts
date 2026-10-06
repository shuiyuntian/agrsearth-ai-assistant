/**
 * 文件作用：风场球端插件入口（CapabilityPackage 默认导出契约；样例数据 → 风向箭头/粒子点渲染，
 *          面板含开关/图例/数据时间戳；ADR-006 实体一律走 ctx.entities，宿主 deactivate 整组隐藏）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本（面板 + 样例风场渲染 + 图层开关回环）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 *
 * 契约红线（违反将被平台方验收打回）：
 * - 必须默认导出 CapabilityPackage【实例】（非工厂函数）；
 * - 实体只走 ctx.entities（ADR-006 现场分组隔离），禁止 viewer.entities.add 直加；
 * - vue/element-plus/cesium 等宿主依赖由 external 排除，禁止打进产物；
 * - Cesium 对象经 getCesium() 取 window.Cesium（import map 无 cesium 键，禁止裸 import 'cesium'）。
 */
import { manifest } from './manifest'
import WindFieldPanel from './panel/WindFieldPanel.vue'
import { createWindFieldController } from './panel/controller'
import { renderWindLayer } from './composables/useWindLayer'
import { getCesium } from './utils/cesium'
import sampleJson from './assets/wind-sample.json'
import type { CapabilityContextLike, WindSample } from './types'

const sample = sampleJson as unknown as WindSample

// 面板定位几何约定（L10-UI规范）：右侧贴齐工具条、上下留空
const PANEL_WIDTH = 440
const RIGHT_MARGIN = 64
const TOP_MARGIN = 80
const BOTTOM_MARGIN = 112

function computePanelRect() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    x: vw - PANEL_WIDTH - RIGHT_MARGIN,
    y: TOP_MARGIN,
    width: PANEL_WIDTH,
    height: vh - TOP_MARGIN - BOTTOM_MARGIN
  }
}

let panel: { show: () => void; hide: () => void; close: () => void; update: (o: object) => void; el?: HTMLElement } | null = null
let resizeHandler: (() => void) | null = null
let currentCtx: CapabilityContextLike | null = null
let controller: ReturnType<typeof createWindFieldController> | null = null
/** 当前图层是否已渲染（关闭=已 removeAll） */
let rendered = false

/** 渲染风场图层并回写面板统计 */
function renderLayer(ctx: CapabilityContextLike) {
  if (rendered || !controller) return
  controller.busy = true
  try {
    controller.stats = renderWindLayer(ctx, sample)
    rendered = true
  } finally {
    controller.busy = false
  }
}

/** 图层开关：关=整组清理（ctx.entities.removeAll），开=按缓存数据重渲染 */
function toggleLayer(visible: boolean) {
  const ctx = currentCtx
  if (!ctx || !controller) return
  controller.layerVisible = visible
  if (visible) {
    renderLayer(ctx)
  } else if (rendered) {
    ctx.entities.removeAll()
    rendered = false
    controller.stats = null
  }
}

/** 首次激活时初始化面板控制器（数据描述来自样例元信息） */
function initController(ctx: CapabilityContextLike) {
  const { grid, validTime, source, speedRange } = sample.meta
  controller = createWindFieldController(toggleLayer)
  controller.validTimeLabel = validTime.replace('T', ' ').replace('+08:00', ' (北京时)')
  controller.gridLabel = `${grid.nx}×${grid.ny} · 步长 ${grid.step}°`
  controller.boundsLabel = `${grid.lonMin}–${grid.lonMax}°E, ${grid.latMin}–${grid.latMax}°N`
  controller.legendMax = Math.ceil(speedRange[1])
  controller.sourceLabel = source
  void ctx
}

const plugin = {
  manifest,
  activate: (ctx: CapabilityContextLike) => {
    currentCtx = ctx
    if (!controller) initController(ctx)

    if (!panel || !panel.el || !panel.el.isConnected) {
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
        resizeHandler = null
      }
      panel = ctx.ui.createPanel({
        id: 'wind-field-panel',
        title: manifest.name,
        component: WindFieldPanel,
        props: { controller },
        mode: 'native',
        ...computePanelRect(),
        draggable: false,
        resizable: false,
        constrainToSafeArea: false
      })
      resizeHandler = () => panel?.update(computePanelRect())
      window.addEventListener('resize', resizeHandler)
    }
    panel?.show()

    // 默认开图层：渲染样例风场并飞到数据范围
    if (controller && !controller.layerVisible) controller.layerVisible = true
    renderLayer(ctx)
    if (rendered) {
      const { grid } = sample.meta
      const C = getCesium()
      ctx.camera.flyTo({
        destination: C.Rectangle.fromDegrees(
          grid.lonMin - 1.5,
          grid.latMin - 1.5,
          grid.lonMax + 1.5,
          grid.latMax + 1.5
        ),
        duration: 1.2
      })
    }

    ctx.notify(`${manifest.name} 已激活`, 'success')
  },
  deactivate: () => {
    // 宿主侧会整组隐藏本包 CustomDataSource；面板随 deactivate 收起
    panel?.hide()
  },
  destroy: () => {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler)
      resizeHandler = null
    }
    panel?.close()
    panel = null
    currentCtx?.entities.removeAll()
    currentCtx = null
    rendered = false
    controller = null
  }
}

export default plugin
export { manifest }
