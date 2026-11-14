<!--
文件作用：ToolCallCard Vue 组件（工具调用状态卡）
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-07-22
版本：1.1.0
修改记录：
  - 1.1.0 (2026-07-22) P3-B：codegen 分支——cesium_execute_code 展示生成代码折叠
                      （CodeBlock）与执行结果（已执行/执行失败/已拦截 blocked 态）；
                      结果 JSON 剥离 code 字段避免重复展示。
  - 1.0.0 (2026-07-22) P1-B：el-tag 标签升级为状态卡：图标 + 工具名 + 状态
                      （executing/success/error/pending-approval/denied）+ 参数/结果 el-collapse 折叠。

版权所有 (C) 2026 AGRSEarth 项目
-->
<template>
  <div class="tool-call-card rounded border px-2 py-1.5" :class="cardClass">
    <!-- 卡片头：状态图标 + 工具名 + 状态文本 -->
    <div class="flex items-center gap-1.5 min-w-0">
      <el-icon class="text-xs flex-shrink-0" :class="iconClass">
        <Loading v-if="toolCall.status === 'executing'" class="animate-spin" />
        <CircleCheck v-else-if="toolCall.status === 'success'" />
        <CircleClose v-else-if="toolCall.status === 'error' || toolCall.status === 'blocked'" />
        <Warning v-else-if="toolCall.status === 'pending-approval'" />
        <Remove v-else />
      </el-icon>
      <span class="text-xs font-mono text-gray-200 truncate" :title="toolCall.toolName">{{ toolCall.toolName }}</span>
      <span class="text-[10px] flex-shrink-0" :class="iconClass">{{ statusText }}</span>
    </div>

    <!-- codegen：执行结果行（已执行 / 执行失败 / 已拦截） -->
    <div v-if="isCodegen && execution" class="mt-1 text-[11px]" :class="executionTextClass">
      {{ executionText }}
    </div>

    <!-- 参数 / 结果 / 生成代码折叠（左侧 2px 状态色竖条，与卡片状态一致） -->
    <el-collapse
      v-if="hasParams || hasResult || codeText"
      class="tool-call-collapse mt-1"
      :style="{ borderLeft: `2px solid ${statusColor}` }"
    >
      <el-collapse-item v-if="hasParams" title="参数" name="params">
        <pre class="tool-call-json">{{ formatJson(toolCall.params) }}</pre>
      </el-collapse-item>
      <el-collapse-item v-if="codeText" :title="`生成代码（${codeLineCount} 行）`" name="code">
        <CodeBlock :code="codeText" />
      </el-collapse-item>
      <el-collapse-item v-if="hasResult" title="结果" name="result">
        <pre class="tool-call-json">{{ formatJson(displayResult) }}</pre>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Loading, CircleCheck, CircleClose, Warning, Remove } from '@element-plus/icons-vue'
import CodeBlock from './CodeBlock.vue'
import { CODEGEN_TOOL_NAME, type CodegenExecutionResult } from '../executors'
import type { ToolCallUI } from '../composables/useAIAssistant'

/**
 * 组件 Props
 * @property {ToolCallUI} toolCall - 工具调用卡片数据
 */
const props = defineProps<{
  toolCall: ToolCallUI
}>()

/** 是否 codegen 工具（cesium_execute_code） */
const isCodegen = computed(() => props.toolCall.toolName === CODEGEN_TOOL_NAME)

/** 是否有参数可展示（undefined/null 不展示） */
const hasParams = computed(() => props.toolCall.params !== undefined && props.toolCall.params !== null)
/** 是否有结果可展示 */
const hasResult = computed(() => props.toolCall.result !== undefined && props.toolCall.result !== null)

/** codegen 生成代码全文（result.code） */
const codeText = computed(() => {
  const result = props.toolCall.result as any
  return result && typeof result.code === 'string' && result.code ? result.code : ''
})

/** 代码行数 */
const codeLineCount = computed(() => (codeText.value ? codeText.value.split('\n').length : 0))

/** codegen 执行结果（result.execution，由 useAIAssistant 在主页面执行后写入） */
const execution = computed((): CodegenExecutionResult | null => {
  const result = props.toolCall.result as any
  return result?.execution && typeof result.execution === 'object' ? result.execution : null
})

/** 执行结果文本 */
const executionText = computed(() => {
  const exec = execution.value
  if (!exec) return ''
  if (exec.status === 'success') return `代码已执行${exec.durationMs !== undefined ? `（${exec.durationMs}ms）` : ''}`
  if (exec.status === 'blocked') return `已拦截：${exec.error || '命中前端防御黑名单'}`
  return `执行失败：${exec.error || 'unknown error'}`
})

/** 执行结果文本颜色 */
const executionTextClass = computed(() => {
  const exec = execution.value
  if (!exec) return 'text-gray-400'
  if (exec.status === 'success') return 'text-green-400'
  if (exec.status === 'blocked') return 'text-orange-400'
  return 'text-red-400'
})

/** 结果区展示内容：codegen 时剥离 code 字段（已由代码块展示） */
const displayResult = computed(() => {
  const result = props.toolCall.result as any
  if (!result || typeof result !== 'object' || !codeText.value) return props.toolCall.result
  const { code: _code, ...rest } = result
  return rest
})

/** 状态文本映射 */
const statusText = computed(() => ({
  executing: '执行中',
  success: '成功',
  error: '失败',
  'pending-approval': '待审批',
  denied: '已拒绝',
  blocked: '已拦截'
} as Record<string, string>)[props.toolCall.status])

/** 状态图标颜色 */
const iconClass = computed(() => {
  switch (props.toolCall.status) {
    case 'executing': return 'text-blue-400'
    case 'success': return 'text-green-400'
    case 'error': return 'text-red-400'
    case 'blocked': return 'text-orange-400'
    case 'pending-approval': return 'text-yellow-400'
    case 'denied': return 'text-orange-400'
    default: return 'text-gray-400'
  }
})

/** 卡片边框/底色随状态微染 */
const cardClass = computed(() => {
  switch (props.toolCall.status) {
    case 'executing': return 'border-blue-500/40 bg-blue-900/20'
    case 'success': return 'border-green-500/30 bg-green-900/10'
    case 'error': return 'border-red-500/40 bg-red-900/20'
    case 'blocked': return 'border-orange-500/50 bg-orange-900/20'
    case 'pending-approval': return 'border-yellow-500/50 bg-yellow-900/20'
    case 'denied': return 'border-orange-500/40 bg-orange-900/10'
    default: return 'border-gray-700 bg-gray-800/40'
  }
})

/** 状态色（折叠区左侧竖条用，与 iconClass 同色板） */
const statusColor = computed(() => {
  switch (props.toolCall.status) {
    case 'executing': return '#60a5fa'
    case 'success': return '#4ade80'
    case 'error': return '#f87171'
    case 'blocked': return '#fb923c'
    case 'pending-approval': return '#facc15'
    case 'denied': return '#fb923c'
    default: return '#6b7280'
  }
})

/**
 * 格式化 JSON 展示（超长截断，避免巨型结果撑爆面板）
 * @param val - 待展示值
 */
const formatJson = (val: unknown): string => {
  let text: string
  try {
    text = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
  } catch {
    text = String(val)
  }
  return text.length > 2000 ? text.slice(0, 2000) + '\n…(截断)' : text
}
</script>
<!-- 组件样式统一收拢于 src/panel-inject.css（远程加载链下 scoped CSS 不进宿主资产，activate 时运行时注入） -->
