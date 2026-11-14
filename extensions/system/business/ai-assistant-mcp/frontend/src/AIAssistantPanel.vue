<!--
文件作用：AIAssistantPanel Vue 组件
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-07-12
版本：2.0.1
修改记录：
  - 2.0.1 (2026-10-05) 包更名收口 ai-assistant→ai-assistant-mcp：窗口事件名改 ai-assistant-mcp:open/close
  - 2.0.0 (2026-07-22) P1-B：对接 ai-orchestrator：工具 el-tag 升级为 ToolCallCard 状态卡；
                      新增 ApprovalCard 审批卡（批准/拒绝回执、超时/拒绝态展示、触发时闪动+声音提示）；
                      状态区改 orchestrator/channel 连接态；移除 MCP 工具批量测试。
  - 1.2.0 (2026-07-20) 悬浮按钮改为常驻显示，单击切换面板展开/收起（按钮位于面板底边下方不遮挡）
  - 1.1.0 (2026-07-20) 恢复右下角悬浮入口按钮（改造前样式），panelOpen 默认收起，
                      关闭按钮直改内部状态（不再依赖宿主监听 ai-assistant:close）
  - 1.0.0 (2026-07-12) 从 components/AIChatPanel 迁移为 ai-assistant 插件面板

版权所有 (C) 2026 AGRSEarth 项目
-->
<template>
  <!-- 右下角悬浮入口按钮（改造前样式：渐变圆钮 + ChatDotRound 图标 + 未读角标 + 脉冲动画）。
       常驻显示，单击在「展开面板 ↔ 收起面板」间切换；
       Teleport 到 body：按钮独立于宿主面板容器存在（容器收起为 0 尺寸时按钮不随之消失）。
       位置 right-5 bottom-10 在面板底边（bottom-28）之下，面板打开时也不遮挡 -->
  <Teleport to="body">
    <div
      v-show="lifecycle.active"
      data-cap-package="ai-assistant-mcp"
      class="ai-float-btn fixed right-5 bottom-10 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center cursor-pointer shadow-xl z-50 hover:scale-110 transition-transform"
      :class="{ 'ai-float-btn-approval': pendingApprovalCount > 0 }"
      :title="panelOpen ? '收起 GIS AI 助手' : 'GIS AI 助手'"
      @click="togglePanel"
    >
      <el-icon class="text-white text-2xl"><ChatDotRound /></el-icon>
      <span v-if="pendingApprovalCount > 0" class="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
        {{ pendingApprovalCount }}
      </span>
      <span v-else-if="unreadCount > 0" class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
        {{ unreadCount }}
      </span>
    </div>
  </Teleport>

  <!-- AI 对话面板：由 CapabilityHost 的 FloatingPanel 提供外层容器与定位（透明壳），
       本组件只需填充父容器高度；展开/收起由 panelOpen 控制，容器显隐由 index.ts 监听事件联动 -->
  <div v-show="lifecycle.active && panelOpen" data-cap-package="ai-assistant-mcp" class="ai-panel h-full flex flex-col overflow-hidden">
    <!-- 面板头部 -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900/80">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <el-icon class="text-white"><ChatDotRound /></el-icon>
            </div>
            <div class="flex flex-col">
              <span class="text-sm font-medium text-white">GIS AI 助手</span>
              <span class="text-xs text-gray-400">{{ statusText }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <el-button text size="small" class="!p-1" @click="showStatus = !showStatus" title="Orchestrator 状态">
              <el-icon class="text-gray-400 hover:text-white"><Tools /></el-icon>
            </el-button>
            <el-button text size="small" class="!p-1" @click="handleClose" title="关闭">
              <el-icon class="text-gray-400 hover:text-white"><Close /></el-icon>
            </el-button>
          </div>
        </div>

        <!-- Orchestrator 状态展开区 -->
        <el-collapse-transition>
          <div v-show="showStatus" class="border-b border-gray-700">
            <MCPStatusDetail
              :orchestrator-status="orchestratorStatus"
              :status-text="statusText"
              :error="orchestratorError"
              :orchestrator-url="orchestratorUrl"
              :enabled-tools="enabledTools"
              :channel-status="channelStatus"
              :session-id="sessionId"
              @reconnect="handleReconnect"
            />
          </div>
        </el-collapse-transition>

        <!-- 消息列表 -->
        <div ref="messageListRef" class="flex-1 overflow-y-auto p-3 space-y-3">
          <!-- 欢迎语 -->
          <div v-if="messages.length === 0" class="text-center py-8">
            <div class="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center mx-auto mb-3">
              <el-icon class="text-3xl text-blue-400"><ChatDotRound /></el-icon>
            </div>
            <p class="text-sm text-gray-300 mb-1">我是您的 GIS AI 助手</p>
            <p class="text-xs text-gray-500">试着说："飞到北京市中心" 或 "添加一个标记点"</p>
          </div>

          <div
            v-for="(msg, idx) in messages"
            :key="idx"
            class="message-bubble"
            :class="msg.role === 'user' ? 'user-msg' : 'ai-msg'"
          >
            <!-- 用户消息 -->
            <template v-if="msg.role === 'user'">
              <div class="flex justify-end">
                <div class="max-w-[85%] bg-blue-600 text-white text-sm px-3 py-2 rounded-2xl rounded-tr-sm">
                  {{ msg.content }}
                </div>
              </div>
            </template>

            <!-- AI 消息 -->
            <template v-else>
              <div class="flex gap-2">
                <div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <el-icon class="text-white text-sm"><ChatDotRound /></el-icon>
                </div>
                <div class="flex-1 min-w-0">
                  <!-- 可折叠思考过程（默认折叠；展开限高 220px 内部滚动） -->
                  <div v-if="msg.reason" class="mb-1">
                    <div
                      class="flex items-center gap-1 cursor-pointer select-none group"
                      @click="toggleReason(idx)"
                    >
                      <el-icon class="text-[10px] text-purple-400 transition-transform" :class="expandedReasons.has(idx) ? 'rotate-90' : ''">
                        <ArrowRight />
                      </el-icon>
                      <span class="text-[11px] text-purple-400 font-medium group-hover:text-purple-300">
                        思考过程
                      </span>
                      <el-icon class="text-[10px] text-purple-400/60"><MagicStick /></el-icon>
                    </div>
                    <el-collapse-transition>
                      <div v-show="expandedReasons.has(idx)" class="reason-detail mt-0.5 ml-3 text-[11px] text-purple-300 bg-purple-900/50 rounded px-2 py-1.5 border border-purple-500/20 leading-relaxed whitespace-pre-wrap break-words">
                        {{ msg.reason }}
                      </div>
                    </el-collapse-transition>
                  </div>
                  <div class="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                    <template v-if="msg.content">{{ displayContent(msg, idx) }}</template>
                    <template v-else-if="isProcessing && idx === messages.length - 1 && msg.role === 'assistant'">
                      <span class="inline-flex items-center gap-1.5 text-gray-400">
                        <el-icon class="animate-spin text-xs"><Loading /></el-icon>
                        <span class="text-xs">正在生成回复...</span>
                      </span>
                    </template>
                  </div>
                  <!-- 工具调用状态卡 -->
                  <div v-if="msg.toolCalls?.length" class="flex flex-col gap-1.5 mt-1.5">
                    <ToolCallCard
                      v-for="tc in msg.toolCalls"
                      :key="tc.id"
                      :tool-call="tc"
                    />
                  </div>
                  <!-- 审批卡（与消息内工具调用按 callId 关联） -->
                  <div v-if="approvalsForMessage(msg).length" class="flex flex-col gap-1.5 mt-1.5">
                    <ApprovalCard
                      v-for="approval in approvalsForMessage(msg)"
                      :key="approval.callId"
                      :approval="approval"
                      :now="now"
                      @respond="handleApprovalRespond"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 加载状态 -->
          <div v-if="isProcessing" class="flex gap-2 items-start py-2">
            <div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
              <el-icon class="text-white text-sm animate-spin"><Loading /></el-icon>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs text-gray-400 mb-1">AI 思考中...</div>
              <div v-if="analyzeState.isAnalyzing" class="text-xs text-purple-300 bg-purple-900/50 rounded px-2 py-1 break-words whitespace-pre-wrap min-h-[1.5em] border border-purple-500/20">
                <span v-if="analyzeState.analyzingReason">{{ analyzeState.analyzingReason }}</span>
                <span v-else class="text-gray-400">分析用户意图...</span>
              </div>
              <div v-else class="text-xs text-gray-500">
                生成回复...
              </div>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="border-t border-gray-700 p-3 bg-gray-900/80">
          <div class="flex gap-2">
            <el-input
              v-model="inputText"
              placeholder="描述您想要的地理空间操作，例如：飞到故宫"
              size="default"
              class="flex-1"
              :disabled="isProcessing"
              @keydown.enter.prevent="handleSend"
            />
            <el-button
              type="primary"
              :loading="isProcessing"
              :disabled="!inputText.trim()"
              @click="handleSend"
            >
              <el-icon class="mr-1"><Promotion /></el-icon>
              发送
            </el-button>
          </div>
        </div>
      </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { ChatDotRound, Loading, Promotion, Close, Tools, ArrowRight, MagicStick } from '@element-plus/icons-vue'
import MCPStatusDetail from './components/MCPStatusDetail.vue'
import ToolCallCard from './components/ToolCallCard.vue'
import ApprovalCard from './components/ApprovalCard.vue'
import type { useAIAssistant, ApprovalItem, ChatMessage } from './composables/useAIAssistant'

/**
 * 组件 Props
 * @property {ReturnType<typeof useAIAssistant>} assistant - AI 助手实例
 */
const props = defineProps<{
  assistant: ReturnType<typeof useAIAssistant>
  lifecycle: { active: boolean; panelOpen: boolean }
}>()

/** 输入框绑定文本 */
const inputText = ref('')
/** 消息列表 DOM 引用，用于滚动控制 */
const messageListRef = ref<HTMLElement>()
/** 面板展开/收起状态由插件入口与组件共享，停用后恢复上次可见状态。 */
const panelOpen = computed({
  get: () => props.lifecycle.panelOpen,
  set: (value: boolean) => { props.lifecycle.panelOpen = value }
})
/** Orchestrator 状态详情展开/收起状态 */
const showStatus = ref(false)
/** 未读消息计数 */
const unreadCount = ref(0)
/** 已展开的思考过程索引集合 */
const expandedReasons = ref<Set<number>>(new Set())
/** 秒级 tick（驱动审批卡倒计时展示） */
const now = ref(Date.now())

/** 从 AI 助手实例中解构核心响应式数据与方法 */
const {
  messages, isProcessing, analyzeState,
  orchestratorStatus, orchestratorError, orchestratorUrl,
  channelStatus, sessionId, enabledTools,
  pendingApprovals,
  sendMessage, respondApproval, reconnect
} = props.assistant

/** 待审批条目数（悬浮按钮角标 + 声音/闪动提示触发源） */
const pendingApprovalCount = computed(() => pendingApprovals.value.filter((a) => a.status === 'pending').length)

/**
 * 展开面板（悬浮按钮点击）：设置内部状态并通知 index.ts 显示宿主面板容器
 */
const openPanel = () => {
  if (panelOpen.value) return
  panelOpen.value = true
  window.dispatchEvent(new CustomEvent('ai-assistant-mcp:open'))
}

/**
 * 收起面板（悬浮按钮点击）：设置内部状态并通知 index.ts 隐藏宿主面板容器
 */
const closePanel = () => {
  panelOpen.value = false
  window.dispatchEvent(new CustomEvent('ai-assistant-mcp:close'))
}

/**
 * 悬浮按钮常驻，单击切换面板展开/收起
 */
const togglePanel = () => {
  if (panelOpen.value) {
    closePanel()
  } else {
    openPanel()
  }
}

/** 秒级计时器句柄 */
let tickTimer: ReturnType<typeof setInterval> | null = null

const stopTick = () => {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}
const startTick = () => {
  if (!tickTimer) tickTimer = setInterval(() => { now.value = Date.now() }, 1000)
}

onMounted(() => {
  window.addEventListener('ai-assistant-mcp:open', openPanel)
  if (props.lifecycle.active) startTick()
})
watch(() => props.lifecycle.active, (active) => {
  if (active) startTick()
  else stopTick()
})
onUnmounted(() => {
  window.removeEventListener('ai-assistant-mcp:open', openPanel)
  stopTick()
})

/**
 * 审批提示音（WebAudio 短促蜂鸣；失败静默，不影响功能）
 */
const playApprovalBeep = () => {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ac = new Ctx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.08, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18)
    osc.start()
    osc.stop(ac.currentTime + 0.2)
    osc.onended = () => ac.close().catch(() => {})
  } catch { /* 无音频环境时静默 */ }
}

/**
 * 新审批到达时：声音提示 + 自动滚动（卡片本身带闪动高亮动画，悬浮按钮有角标）
 */
watch(pendingApprovalCount, (val, oldVal) => {
  if (val > oldVal) {
    playApprovalBeep()
    nextTick(() => {
      messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight, behavior: 'smooth' })
    })
  }
})

/**
 * 监听分析状态中的思考文本变化，实现自动滚动到底部
 * 当思考过程文本增长时，平滑滚动消息列表
 */
watch(() => analyzeState.analyzingReason, () => {
  nextTick(() => {
    messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight, behavior: 'smooth' })
  })
})

/**
 * 监听处理状态与分析状态的变化，确保加载指示器可见
 * 当思考完成（isProcessing 为 true 且 isAnalyzing 变为 false）时触发滚动
 */
watch(() => [isProcessing.value, analyzeState.isAnalyzing], (newVal, oldVal) => {
  const [, analyzing] = newVal as [boolean, boolean]
  const [, wasAnalyzing] = oldVal as [boolean, boolean]
  if (isProcessing.value && !analyzing && wasAnalyzing) {
    // 思考阶段结束，进入工具执行/回复生成阶段，触发滚动确保底部加载状态可见
    nextTick(() => {
      messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight, behavior: 'smooth' })
    })
  }
})

/**
 * orchestrator 会话状态文本映射
 * @returns {string} 当前会话状态的中文描述
 */
const statusText = computed(() => ({
  idle: '未连接',
  connecting: '连接中...',
  connected: '已连接',
  error: '连接失败'
}[orchestratorStatus.value] || '未知'))

/**
 * 取出与指定消息关联的审批条目（按工具调用 callId 匹配）
 * @param {ChatMessage} msg - 聊天消息
 */
const approvalsForMessage = (msg: ChatMessage): ApprovalItem[] => {
  if (!msg.toolCalls?.length) return []
  return pendingApprovals.value.filter((a) => msg.toolCalls.some((tc) => tc.id === a.callId))
}

/**
 * 审批回执（批准/拒绝）：转调 AI 助手实例（POST /chat/approval）
 * @param {ApprovalItem} approval - 审批条目
 * @param {boolean} approved - 批准 / 拒绝
 */
const handleApprovalRespond = async (approval: ApprovalItem, approved: boolean) => {
  await respondApproval(approval, approved)
}

/**
 * 监听消息列表变化，更新未读计数并自动滚动
 * 当面板收起且收到 AI 回复时，未读计数 +1
 * 每次消息更新后，将滚动条平滑移至底部
 */
watch(messages, () => {
  if (!panelOpen.value) {
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant') {
      unreadCount.value++
    }
  }
  nextTick(() => {
    messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight, behavior: 'smooth' })
  })
}, { deep: true })

/**
 * 监听面板展开状态，展开时清零未读计数
 * @param {boolean} val - 面板是否展开
 */
watch(panelOpen, (val) => {
  if (val) unreadCount.value = 0
})

/**
 * 处理用户发送消息
 * 获取输入文本，去重后调用 AI 助手实例的发送方法，并清空输入框
 */
const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text || isProcessing.value) return
  inputText.value = ''
  await sendMessage(text)
}

/**
 * 处理重新连接 orchestrator（重新签发会话并重建命令通道）
 */
const handleReconnect = async () => {
  await reconnect()
}

/**
 * 处理关闭面板（头部 X 按钮）：与悬浮按钮收起同一逻辑
 */
const handleClose = () => {
  closePanel()
}

/**
 * 切换指定索引的思考过程展开/收起状态
 * @param {number} idx - 消息在列表中的索引
 */
const toggleReason = (idx: number) => {
  const set = new Set(expandedReasons.value)
  if (set.has(idx)) {
    set.delete(idx)
  } else {
    set.add(idx)
  }
  expandedReasons.value = set
}

/**
 * 正文展示归一化（与 useAIAssistant 累积处的前导空白丢弃配套）：
 * - 流式中的最后一条 assistant 消息原样展示（前导空白已在累积处拦截，不跳变）；
 * - 完成的消息 trim 首尾，并把 3 个以上连续换行压成 2 个（vLLM 偶发成段空行）。
 * @param {ChatMessage} msg - 聊天消息
 * @param {number} idx - 消息索引（判断是否为流式中的最后一条）
 */
const displayContent = (msg: ChatMessage, idx: number): string => {
  const inFlight = isProcessing.value && idx === messages.value.length - 1 && msg.role === 'assistant'
  if (inFlight) return msg.content
  return (msg.content || '').trim().replace(/\n{3,}/g, '\n\n')
}


</script>
<!-- 组件样式统一收拢于 src/panel-inject.css，由共享构建链生成包作用域 tool.css。 -->
