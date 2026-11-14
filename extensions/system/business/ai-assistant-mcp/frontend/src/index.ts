/**
 * 文件作用：AI 助手插件入口
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-12
 * 版本：1.2.0
 * 修改记录：
 *   - 1.2.0 (2026-11-14) 独立仓迁移：自产作用域 CSS，补齐悬浮入口停用/恢复/销毁与资源所有权
 *   - 1.1.1 (2026-10-05) 包更名收口 ai-assistant→ai-assistant-mcp
 *   - 1.1.0 (2026-07-20) 默认导出 CapabilityPackage 实例
 *   - 1.0.0 (2026-07-12) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { effectScope, markRaw, reactive } from 'vue'
import { manifest } from './manifest'
import AIAssistantPanel from './AIAssistantPanel.vue'
import { useAIAssistant } from './composables/useAIAssistant'
import './panel-inject.css'
import type { CapabilityPackage, CapabilityContextLike, FloatingPanelHandle } from './types'

export { manifest }

function createAIAssistantPlugin(): CapabilityPackage {
  let panelHandle: FloatingPanelHandle | null = null
  let assistant: ReturnType<typeof useAIAssistant> | null = null
  let scope: ReturnType<typeof effectScope> | null = null
  const lifecycle = reactive({ active: true, panelOpen: false })

  const onOpen = () => {
    lifecycle.panelOpen = true
    if (lifecycle.active) panelHandle?.show()
  }
  const onClose = () => {
    lifecycle.panelOpen = false
    panelHandle?.hide()
  }

  return {
    manifest,
    activate: (ctx: CapabilityContextLike) => {
      if (panelHandle && assistant) {
        lifecycle.active = true
        if (lifecycle.panelOpen) panelHandle.show()
        void assistant.resume()
        return
      }

      lifecycle.active = true
      lifecycle.panelOpen = false
      window.addEventListener('ai-assistant-mcp:open', onOpen)
      window.addEventListener('ai-assistant-mcp:close', onClose)

      const config = {
        orchestratorBaseUrl: ctx.manifest.config?.orchestratorBaseUrl || '',
        channelResultBaseUrl: ctx.manifest.config?.channelResultBaseUrl,
        enabledTools: ctx.manifest.config?.enabledTools
      }
      scope = effectScope()
      assistant = scope.run(() => useAIAssistant(ctx.viewer, config, ctx))!

      panelHandle = ctx.ui.createPanel({
        id: 'ai-assistant-mcp-panel',
        title: '',
        component: AIAssistantPanel,
        props: { assistant: markRaw(assistant), lifecycle },
        resizable: false,
        draggable: false,
        closable: false,
        modal: false,
        constrainToSafeArea: false,
        mode: 'shadow',
        width: 520,
        height: window.innerHeight - 192,
        anchor: 'right-top',
        offsetX: 64,
        offsetY: 80,
        className: 'ai-assistant-mcp-plugin-panel',
        style: { background: 'transparent', border: 'none', boxShadow: 'none', overflow: 'visible', pointerEvents: 'none' }
      })
      panelHandle.hide()
    },
    deactivate: () => {
      lifecycle.active = false
      panelHandle?.hide()
      assistant?.suspend()
    },
    destroy: (ctx: CapabilityContextLike) => {
      lifecycle.active = false
      window.removeEventListener('ai-assistant-mcp:open', onOpen)
      window.removeEventListener('ai-assistant-mcp:close', onClose)
      assistant?.destroy()
      scope?.stop()
      panelHandle?.close()
      panelHandle = null
      assistant = null
      scope = null
      ctx.cleanup()
    }
  }
}

const aiAssistantPlugin = createAIAssistantPlugin()
export default aiAssistantPlugin
