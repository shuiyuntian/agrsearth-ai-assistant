/**
 * 文件作用：<pkg> 球端插件入口（CapabilityPackage 默认导出契约）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 *
 * 契约红线（违反将被平台方验收打回）：
 * - 必须默认导出 CapabilityPackage【实例】（非工厂函数）；
 * - 实体只走 ctx.entities（ADR-006 现场分组隔离），禁止 viewer.entities.add 直加；
 * - vue/element-plus/cesium/echarts 等宿主依赖由 external 排除，禁止打进产物；
 * - 面板定位遵循 docs/L10-UI规范.md 几何约定。
 */
import { defineComponent, h } from 'vue'
import { manifest } from './manifest'
import type { CapabilityPackage, CapabilityContext } from '@cesiumai/sdk-types'

// 面板内容组件骨架：实现期替换为真实面板（可参考 docs/L5-开发Recipes.md）
const ExamplePanel = defineComponent({
  name: 'ExampleToolPanel',
  setup() {
    return () =>
      h('div', { class: 'p-4 text-sm text-gray-300' }, [
        h('p', `${manifest.name} v${manifest.version} 面板骨架`),
        h('p', { class: 'text-gray-500 mt-2' }, '在此实现面板内容；实体/图层/事件一律经 ctx.* 入口。')
      ])
  }
})

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

let panel: { show: () => void; hide: () => void; close: () => void; update: (o: object) => void } | null = null

function onWindowResize() {
  panel?.update(computePanelRect())
}

const plugin: CapabilityPackage = {
  manifest,
  activate: (ctx: CapabilityContext) => {
    panel = ctx.ui.createPanel({
      id: 'example-tool-panel',
      title: manifest.name,
      component: ExamplePanel,
      mode: 'native',
      ...computePanelRect(),
      draggable: false,
      resizable: false,
      constrainToSafeArea: false
    })
    panel.show()
    window.addEventListener('resize', onWindowResize)
    ctx.notify(`${manifest.name} 已激活`, 'success')
  },
  deactivate: () => {
    panel?.hide()
  },
  destroy: () => {
    window.removeEventListener('resize', onWindowResize)
    panel?.close()
    panel = null
  }
}

export default plugin
export { manifest }
