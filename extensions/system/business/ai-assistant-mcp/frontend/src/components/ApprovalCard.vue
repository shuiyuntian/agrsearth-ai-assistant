<!--
文件作用：ApprovalCard Vue 组件（工具调用人工审批卡）
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-07-22
版本：1.0.0
修改记录：
  - 1.0.0 (2026-07-22) P1-B：orchestrator 流中 data-tool-approval 触发的审批 UI：
                      展示工具名/风险等级/理由/格式化参数，批准/拒绝按钮回执 POST /chat/approval；
                      支持 pending（高亮闪动 + 倒计时）/ approved / denied / timeout 四态展示。

版权所有 (C) 2026 AGRSEarth 项目
-->
<template>
  <div
    class="approval-card rounded border px-2.5 py-2"
    :class="approval.status === 'pending' ? 'border-yellow-500/60 bg-yellow-900/20 approval-pending' : 'border-gray-700 bg-gray-800/40'"
  >
    <!-- 标题行：图标 + 工具名 + 风险等级 + 状态 -->
    <div class="flex items-center gap-1.5 min-w-0">
      <el-icon class="text-sm flex-shrink-0" :class="iconClass">
        <Warning v-if="approval.status === 'pending'" />
        <CircleCheck v-else-if="approval.status === 'approved'" />
        <Remove v-else-if="approval.status === 'denied'" />
        <Clock v-else />
      </el-icon>
      <span class="text-xs font-medium text-gray-100 truncate">
        {{ approval.status === 'pending' ? '需要审批' : statusText }}：{{ approval.tool }}
      </span>
      <el-tag
        v-if="approval.riskLevel"
        size="small"
        :type="riskTagType"
        :style="riskTagStyle"
        effect="dark"
        class="flex-shrink-0"
      >
        {{ approval.riskLevel }}
      </el-tag>
    </div>

    <!-- 审批理由 -->
    <div v-if="approval.reason" class="mt-1 text-[11px] text-gray-400 leading-relaxed">
      {{ approval.reason }}
    </div>

    <!-- codegen：完整生成代码展示（等宽 + 行号 + 折叠，默认前 20 行） -->
    <div v-if="codeText" class="mt-1.5">
      <div class="text-[10px] text-purple-300 mb-0.5">生成代码（{{ codeLineCount }} 行，已经后端 AST 校验）：</div>
      <CodeBlock :code="codeText" :max-collapsed-lines="20" />
    </div>

    <!-- 参数（格式化 JSON；codegen 时 code 字段已由上方代码块展示，此处仅余 intent/description） -->
    <pre v-if="hasArgs" class="approval-args mt-1">{{ formatJson(displayArgs) }}</pre>

    <!-- pending：操作按钮 + 倒计时 -->
    <div v-if="approval.status === 'pending'" class="mt-2 flex items-center gap-2">
      <el-button type="success" size="small" :disabled="submitting" @click="handleRespond(true)">
        <el-icon class="mr-1"><Check /></el-icon>
        批准
      </el-button>
      <el-button type="danger" size="small" :disabled="submitting" @click="handleRespond(false)">
        <el-icon class="mr-1"><Close /></el-icon>
        拒绝
      </el-button>
      <span class="text-[10px] text-gray-500 ml-auto">{{ remainingSec }}s 后超时</span>
    </div>

    <!-- 回执失败提示 -->
    <div v-if="approval.error" class="mt-1 text-[11px] text-red-400">
      回执发送失败：{{ approval.error }}（可重试）
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Warning, CircleCheck, Remove, Clock, Check, Close } from '@element-plus/icons-vue'
import CodeBlock from './CodeBlock.vue'
import type { ApprovalItem } from '../composables/useAIAssistant'

/** 审批前端超时时长（与 useAIAssistant 的 APPROVAL_TIMEOUT_MS 保持一致） */
const APPROVAL_TIMEOUT_MS = 120_000

/**
 * 组件 Props
 * @property {ApprovalItem} approval - 审批条目
 * @property {number} now - 父组件秒级 tick 的当前时间戳（驱动倒计时）
 */
const props = defineProps<{
  approval: ApprovalItem
  now: number
}>()

/**
 * 组件 Emits
 * @description respond 由父组件转调 useAIAssistant.respondApproval（POST /chat/approval）
 */
const emit = defineEmits<{
  respond: [approval: ApprovalItem, approved: boolean]
}>()

/** 回执提交中（防连点；状态由父组件翻转后自动解禁） */
const submitting = ref(false)

/** 是否有参数可展示 */
const hasArgs = computed(() => props.approval.args !== undefined && props.approval.args !== null)

/** codegen 代码全文（args.code 存在即为本轮 codegen 审批） */
const codeText = computed(() => {
  const args = props.approval.args as any
  return args && typeof args.code === 'string' && args.code ? args.code : ''
})

/** 代码行数 */
const codeLineCount = computed(() => (codeText.value ? codeText.value.split('\n').length : 0))

/** 参数区展示内容：codegen 时剥离 code 字段（已由代码块展示），只留 intent/description 等 */
const displayArgs = computed(() => {
  const args = props.approval.args as any
  if (!args || typeof args !== 'object' || !codeText.value) return props.approval.args
  const { code: _code, ...rest } = args
  return rest
})

/** 非 pending 状态文本 */
const statusText = computed(() => ({
  approved: '已批准',
  denied: '已拒绝',
  timeout: '审批超时'
} as Record<string, string>)[props.approval.status] || '')

/** 状态图标颜色 */
const iconClass = computed(() => {
  switch (props.approval.status) {
    case 'pending': return 'text-yellow-400'
    case 'approved': return 'text-green-400'
    case 'denied': return 'text-orange-400'
    case 'timeout': return 'text-gray-400'
    default: return 'text-gray-400'
  }
})

/** 风险等级标签类型（codegen 走自定义紫色，见 riskTagStyle） */
const riskTagType = computed(() => {
  const level = (props.approval.riskLevel || '').toLowerCase()
  if (level.includes('codegen')) return 'info'
  if (level.includes('destruct') || level.includes('high') || level.includes('danger')) return 'danger'
  if (level.includes('write') || level.includes('mid') || level.includes('medium')) return 'warning'
  return 'info'
})

/** codegen 紫标签样式（与 destructive 红区分；执行代码的特殊风险等级） */
const riskTagStyle = computed(() => {
  const level = (props.approval.riskLevel || '').toLowerCase()
  if (level.includes('codegen')) {
    return { backgroundColor: '#7c3aed', borderColor: '#7c3aed', color: '#fff' }
  }
  return undefined
})

/** 剩余秒数（pending 时展示；父组件 now 每秒刷新） */
const remainingSec = computed(() => {
  const elapsed = props.now - props.approval.createdAt
  return Math.max(0, Math.ceil((APPROVAL_TIMEOUT_MS - elapsed) / 1000))
})

/**
 * 格式化 JSON 展示（超长截断）
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

/**
 * 批准 / 拒绝
 * @param approved - true 批准，false 拒绝
 */
const handleRespond = (approved: boolean) => {
  if (submitting.value) return
  submitting.value = true
  emit('respond', props.approval, approved)
  // 父组件状态翻转后本卡不再处于 pending；兜底 3s 解禁防回执失败卡死
  setTimeout(() => { submitting.value = false }, 3000)
}
</script>
<!-- 组件样式统一收拢于 src/panel-inject.css（远程加载链下 scoped CSS 不进宿主资产，activate 时运行时注入） -->
