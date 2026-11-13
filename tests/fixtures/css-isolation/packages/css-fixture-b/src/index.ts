// 文件作用：CSS 隔离测试夹具 B 的面板、弹层与生命周期
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-13
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-13) B1 测试夹具
// 版权所有 (C) 2026 AGRSEarth 项目

import { defineComponent, h } from 'vue'
import { manifest } from './manifest'
import './panel.css'

const Panel = defineComponent({
  setup: () => () => h('div', { class: 'shared-card text-sm' }, 'B panel')
})

let panel: { show: () => void; hide: () => void; close: () => void; el: HTMLElement } | null = null
let overlay: HTMLElement | null = null
let active = false

function onWindowResize() {
  if (active && overlay) overlay.dataset.resized = 'true'
}

const plugin = {
  manifest,
  activate(ctx: any) {
    active = true
    if (!panel || !panel.el.isConnected) {
      panel = ctx.ui.createPanel({
        id: 'css-fixture-b-panel',
        title: manifest.name,
        component: Panel,
        mode: 'native',
        x: 420,
        y: 80,
        width: 280,
        height: 160
      })
    }
    panel.show()
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.className = 'shared-fixture-overlay'
      overlay.setAttribute('data-cap-package', manifest.id)
      const content = document.createElement('div')
      content.className = 'shared-overlay fixed'
      content.textContent = 'B overlay'
      overlay.appendChild(content)
      document.body.appendChild(overlay)
    }
    overlay.style.display = 'block'
    window.removeEventListener('resize', onWindowResize)
    window.addEventListener('resize', onWindowResize)
  },
  deactivate() {
    active = false
    panel?.hide()
    if (overlay) overlay.style.display = 'none'
    window.removeEventListener('resize', onWindowResize)
  },
  destroy() {
    active = false
    window.removeEventListener('resize', onWindowResize)
    panel?.close()
    panel = null
    overlay?.remove()
    overlay = null
  }
}

export default plugin
export { manifest }
