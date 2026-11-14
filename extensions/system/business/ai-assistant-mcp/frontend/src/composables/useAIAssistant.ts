/**
 * 文件作用：useAIAssistant 组合式函数（AI SDK UI message stream + 审批 + 命令通道）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-12
 * 版本：2.3.0
 * 修改记录：
 *   - 2.3.0 (2026-10-12) channelResultBaseUrl 支持 'auto' 哨兵：按当前访问主机推导网关 18801
 *                       独立回传源（双环境 同一产物通用），显式 URL 值保持透传
 *   - 2.2.0 (2026-07-26) 会话 403 自愈重试：onError 命中 isSessionExpiredError（HTTP 403 +
 *                       session not found or expired）时透明自愈——静默 createChatSession 重签 →
 *                       sse.connect(新 sid) 重建命令通道 → 用新 sid 重发当前消息，全程无错误气泡、
 *                       连接状态指示不闪烁；同一条用户消息最多重签 1 次（isRetry 闸），
 *                       epoch 防过期自愈覆盖新一轮发送；重试仍失败或其它错误按现状报错。
 *   - 2.1.0 (2026-07-22) P3-B：codegen 执行侧——cesium_execute_code 批准后经 chat 流拿到
 *                       {code, approvedForExecution:true} 在主页面执行（executors/codegen.ts）；
 *                       工具卡新增 blocked 态；enabledTools 运行时门（默认关闭 codegen）。
 *   - 2.0.0 (2026-07-22) P1-B：三段式手写编排（analyzeIntentStream→executeTool→generateReply）
 *                       整体切换为 ai-orchestrator 单端点 UI message stream：
 *                       init 时 POST /chat/session 签发 sessionId → 命令通道连 /channel/events →
 *                       sendMessage 走 api/chatStream.ts 按 parts 驱动消息/工具卡/审批状态机。
 *                       buildToolCatalog/normalizeParams/resolveLocation 随编排后端化移除：
 *                       工具目录、参数规整、地名解析（geolocation）均由 orchestrator 在编排阶段完成，
 *                       前端执行器（executors/TOOL_EXECUTORS）只接收结构化命令并保留自身容错默认值。
 *   - 1.1.0 (2026-07-20) 迁移到 extensions/ai-assistant/frontend：@/ 别名改为相对路径引用
 *   - 1.0.0 (2026-07-12) 从 useCesiumMCP 迁移为 AI 助手插件内部使用，直接接收 Viewer 实例
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { ref, watch, reactive, shallowRef } from 'vue'
import { useSSEConnection } from './useSSEConnection'
import {
  sendChat,
  createChatSession,
  sendApproval,
  isErrorToolOutput,
  isSessionExpiredError,
  type ChatRequestMessage,
  type ToolApprovalRequest
} from '../api/chatStream'
import { resolveEnabledTools, type EnabledTool } from '../executors/enabled-tools'
import { executeGeneratedCode, CODEGEN_TOOL_NAME } from '../executors/codegen'
import type { CapabilityContextLike } from '../types'
import { API } from '../api'

/**
 * AI 助手配置
 */
export interface AIAssistantConfig {
  /** orchestrator 基础地址：缺省/空串 = 同源 /ai/agent（经 RuoYi Gateway StripPrefix）；
   * 本地联调可配 http://localhost:9600 直连 orchestrator */
  orchestratorBaseUrl?: string
  /** /channel/result 回传独立源（缺省 = orchestratorBaseUrl；'auto' = 按当前访问主机推导网关 18801）；
   * 生产配独立源规避同源请求排队超时 */
  channelResultBaseUrl?: string
  /** 启用工具白名单（缺省/空 = 全量 28 个浏览器侧工具） */
  enabledTools?: string[]
}

/** 工具调用状态机：executing / success / error / pending-approval / denied / blocked（codegen 前端防御拦截） */
export type ToolCallStatus = 'executing' | 'success' | 'error' | 'pending-approval' | 'denied' | 'blocked'

/** 消息内的工具调用卡片数据 */
export interface ToolCallUI {
  /** toolCallId（= 审批 callId） */
  id: string
  toolName: string
  params?: unknown
  status: ToolCallStatus
  result?: unknown
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 思考过程（reasoning parts 累积） */
  reason?: string
  toolCalls: ToolCallUI[]
}

/** 审批条目状态：pending / approved / denied / timeout */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'timeout'

/** 审批条目（data-tool-approval 触发） */
export interface ApprovalItem extends ToolApprovalRequest {
  status: ApprovalStatus
  /** 创建时间戳（ms），用于超时与倒计时展示 */
  createdAt: number
  /** 回执发送失败时的错误信息 */
  error?: string
}

/** 审批前端超时（ms）：超时仅作展示态，服务端超时策略以 orchestrator 为准 */
const APPROVAL_TIMEOUT_MS = 120_000

/**
 * AI 助手核心组合式函数
 * @description 聊天通道（POST /chat，UI message stream）+ 命令执行终端（/channel SSE）双通道终端；
 * 编排（意图分析/工具选择/参数规整/地名解析）全部在 ai-orchestrator 完成，前端只渲染流与执行命令。
 * @param viewer - Cesium Viewer 实例
 * @param config - AI 助手配置
 * @returns 状态、消息、审批与操作方法
 */
export function useAIAssistant(viewer: any, config: AIAssistantConfig, capabilityContext?: CapabilityContextLike) {
  const Cesium = (window as any).Cesium

  /** orchestrator 基础地址：'' → 同源 /ai/agent */
  const baseUrl = (config.orchestratorBaseUrl || API.ORCHESTRATOR_BASE).replace(/\/$/, '')

  // channelResultBaseUrl='auto'：按当前访问主机推导网关 18801 独立回传源
  // （双环境 同一产物通用；显式 URL 值保持原样透传）
  const resultBaseUrl = config.channelResultBaseUrl === 'auto'
    ? `${location.protocol}//${location.hostname}:18801/ai/agent`
    : config.channelResultBaseUrl

  // 建立命令通道：orchestrator 命令路由器经 SSE 向前端下发 camera/entity 等命令并等待执行结果
  // manual 模式：等 chat session 签发后再 connect(sessionId)，不再自动连接
  // shallowRef：禁止把 Cesium Viewer 深度响应式化（traverse 深遍历其对象图会栈溢出）
  const viewerRef = shallowRef(viewer)
  const sse = useSSEConnection(viewerRef, {
    baseUrl,
    resultBaseUrl,
    manual: true,
    enabledTools: config.enabledTools,
    ctx: capabilityContext
  }) as any

  /** orchestrator 会话状态 */
  const orchestratorStatus = ref<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  /** orchestrator 错误信息 */
  const orchestratorError = ref<string | null>(null)
  /** orchestrator 基础地址（状态面板展示用） */
  const orchestratorUrl = ref(baseUrl)
  /** 服务端签发的会话 ID（chat 与 channel 共用） */
  const sessionId = ref<string | null>(null)
  /** 命令通道连接状态 */
  const channelStatus = ref<'connected' | 'disconnected' | 'error'>('disconnected')
  watch(() => sse.isConnected?.value, (val) => {
    channelStatus.value = val ? 'connected' : 'disconnected'
  }, { immediate: true })
  watch(() => sse.error?.value, (val) => {
    if (val) channelStatus.value = 'error'
  })

  /** 启用的工具白名单（状态面板展示用） */
  const enabledTools = ref<EnabledTool[]>(resolveEnabledTools(config.enabledTools))

  /** 聊天消息列表 */
  const messages = ref<ChatMessage[]>([])
  /** 是否正在处理中 */
  const isProcessing = ref(false)

  /** 意图分析/流式状态（reactive，便于跨组件透传；语义=当前 assistant 流进行中） */
  const analyzeState = reactive({
    isAnalyzing: false,
    analyzingReason: ''
  })

  /** 审批条目列表（data-tool-approval 累积） */
  const pendingApprovals = ref<ApprovalItem[]>([])
  /** 审批超时定时器（callId → timer） */
  const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>()

  let abortChat: (() => void) | null = null
  /** chat 回合编号：每轮发送/自愈重试递增，用于识别并放弃过期的 403 自愈（防覆盖新一轮） */
  let chatEpoch = 0
  let active = true
  let destroyed = false

  /**
   * 初始化：签发 chat 会话，签发成功后连接命令通道
   */
  const initialize = async () => {
    if (!active || destroyed || !viewer || viewer.isDestroyed?.()) return
    try {
      orchestratorStatus.value = 'connecting'
      orchestratorError.value = null
      sessionId.value = await createChatSession(baseUrl)
      orchestratorStatus.value = 'connected'
      console.log('[AI] Session created:', sessionId.value)
      // session 签发后再连命令通道（/channel/events 校验 sessionId 归属）
      sse.connect(sessionId.value)
    } catch (e: any) {
      orchestratorStatus.value = 'error'
      orchestratorError.value = e.message
      console.error('[AI] Session create failed:', e.message)
    }
  }

  /**
   * 重连：中断当前流与命令通道，重新签发会话
   */
  const reconnect = async () => {
    if (abortChat) { abortChat(); abortChat = null }
    isProcessing.value = false
    analyzeState.isAnalyzing = false
    sse.disconnect?.()
    sessionId.value = null
    orchestratorError.value = null
    await initialize()
  }

  /**
   * 把内部消息历史映射为 AI SDK UIMessage 形态（role + parts）
   * @description 文本 → text part；已完结的工具调用 → tool-<name> part（state: output-available），
   * 供 orchestrator 端 convertToModelMessages 消费。进行中的空 assistant 占位消息被过滤。
   */
  const buildRequestMessages = (): ChatRequestMessage[] => {
    return messages.value
      .filter((m) => {
        if (m.role === 'user') return !!m.content
        // assistant：有正文，或有已完结工具调用（进行中的占位消息不上行）
        return !!m.content || m.toolCalls.some((tc) => tc.status === 'success' || tc.status === 'error' || tc.status === 'denied' || tc.status === 'blocked')
      })
      .map((m) => {
        const parts: Array<Record<string, unknown>> = []
        if (m.content) parts.push({ type: 'text', text: m.content })
        for (const tc of m.toolCalls) {
          if (tc.status === 'success' || tc.status === 'error' || tc.status === 'denied' || tc.status === 'blocked') {
            parts.push({
              type: `tool-${tc.toolName}`,
              toolCallId: tc.id,
              state: 'output-available',
              input: tc.params ?? {},
              output: tc.result ?? {}
            })
          }
        }
        return { role: m.role, parts }
      })
  }

  /** 在消息内查找/创建工具调用卡片 */
  const upsertToolCall = (msg: ChatMessage, toolCallId: string, toolName?: string): ToolCallUI => {
    let tc = msg.toolCalls.find((t) => t.id === toolCallId)
    if (!tc) {
      tc = { id: toolCallId, toolName: toolName || 'unknown', status: 'executing' }
      msg.toolCalls.push(tc)
    }
    if (toolName && tc.toolName === 'unknown') tc.toolName = toolName
    return tc
  }

  /** 判断工具输出是否失败语义（denied 优先由 denied 标记表达；口径见 chatStream.isErrorToolOutput） */
  const isErrorOutput = (output: any): boolean => isErrorToolOutput(output)

  /** 清理审批超时定时器 */
  const clearApprovalTimer = (callId: string) => {
    const timer = approvalTimers.get(callId)
    if (timer) {
      clearTimeout(timer)
      approvalTimers.delete(callId)
    }
  }

  /** 登记审批条目并启动前端超时展示定时器 */
  const registerApproval = (msg: ChatMessage, req: ToolApprovalRequest) => {
    // 幂等：同一 callId 重复到达不重复登记
    if (!pendingApprovals.value.some((a) => a.callId === req.callId && a.status === 'pending')) {
      pendingApprovals.value.push({ ...req, status: 'pending', createdAt: Date.now() })
    }
    upsertToolCall(msg, req.callId, req.tool).status = 'pending-approval'

    clearApprovalTimer(req.callId)
    approvalTimers.set(req.callId, setTimeout(() => {
      const item = pendingApprovals.value.find((a) => a.callId === req.callId)
      if (item && item.status === 'pending') {
        item.status = 'timeout'
        const tc = msg.toolCalls.find((t) => t.id === req.callId)
        if (tc && tc.status === 'pending-approval') {
          tc.status = 'error'
          tc.result = { success: false, error: '审批超时' }
        }
      }
      approvalTimers.delete(req.callId)
    }, APPROVAL_TIMEOUT_MS))
  }

  /** 审批/工具结果到达后同步审批条目终态 */
  const settleApproval = (callId: string, status: 'approved' | 'denied') => {
    clearApprovalTimer(callId)
    const item = pendingApprovals.value.find((a) => a.callId === callId)
    if (item && item.status === 'pending') item.status = status
  }

  /**
   * codegen 工具输出处理（cesium_execute_code 的浏览器执行侧）
   * @description 契约：批准回执后 orchestrator 返回 {code, approvedForExecution:true}（不执行代码）；
   * 前端在**主页面**执行（executors/codegen.ts，免沙箱定案）并更新工具卡状态。
   * 防御层次：后端 AST（主防线）→ enabledTools 运行时门（配置级，默认关闭）→
   * 前端正则兜底（CODEGEN_BLOCK_PATTERN）→ try/catch 执行隔离。
   * @param tc - 工具调用卡片
   * @param output - tool-output-available 的 output
   */
  const handleCodegenOutput = (tc: ToolCallUI, output: any) => {
    const payload = output && typeof output === 'object' ? output : {}
    // 兼容 output 直出与 MCP CallToolResult structuredContent 两种载体
    const struct = payload.structuredContent && typeof payload.structuredContent === 'object' ? payload.structuredContent : {}
    const code = typeof payload.code === 'string' ? payload.code : (typeof struct.code === 'string' ? struct.code : '')
    const approvedForExecution = payload.approvedForExecution === true || struct.approvedForExecution === true

    if (!code || !approvedForExecution) {
      tc.status = 'error'
      tc.result = { ...payload, execution: { status: 'error', error: '缺少 code 或未获执行批准（approvedForExecution）' } }
      settleApproval(tc.id, 'approved')
      return
    }

    // enabledTools 运行时门：配置未显式启用 codegen 时拒绝执行（纵深防御，默认关闭）
    if (!enabledTools.value.includes(CODEGEN_TOOL_NAME)) {
      tc.status = 'blocked'
      tc.result = { ...payload, code, execution: { status: 'blocked', error: 'cesium_execute_code 未在 enabledTools 中启用，已阻止执行' } }
      settleApproval(tc.id, 'approved')
      return
    }

    const execution = executeGeneratedCode(code, viewer)
    tc.status = execution.status === 'success' ? 'success' : execution.status
    tc.result = { ...payload, code, execution }
    settleApproval(tc.id, 'approved')
  }

  /**
   * 审批回执：POST /chat/approval
   * @description approved → 后续流中出 tool-output-available；rejected → tool-output-available（denied）。
   * 本地立即标记 approved/denied（按钮防重）；工具卡回到 executing 等待终态输出。
   * @param item - 审批条目
   * @param approved - 批准 / 拒绝
   */
  const respondApproval = async (item: ApprovalItem, approved: boolean) => {
    if (item.status !== 'pending') return
    if (!sessionId.value) {
      item.error = '会话未建立'
      return
    }
    try {
      item.error = undefined
      await sendApproval({ baseUrl, sessionId: sessionId.value, callId: item.callId, approved })
      settleApproval(item.callId, approved ? 'approved' : 'denied')
      // 工具卡回到执行中，等待流中 tool-output-available 给出终态
      for (const msg of messages.value) {
        const tc = msg.toolCalls.find((t) => t.id === item.callId)
        if (tc && tc.status === 'pending-approval') tc.status = 'executing'
      }
    } catch (e: any) {
      item.error = e.message
      console.error('[Approval] respond failed:', e.message)
    }
  }

  /**
   * 发送用户消息并消费 UI message stream
   * @description 单端点 POST /chat：text-delta 累积正文、reasoning 累积思考、
   * tool-input/output 驱动工具卡状态机、data-tool-approval 弹审批卡；
   * HTTP 403 会话过期走透明自愈（见 healSessionAndRetry），不产生错误气泡。
   * @param userInput - 用户输入文本
   */
  const sendMessage = async (userInput: string) => {
    if (!active || destroyed) return
    if (!sessionId.value || orchestratorStatus.value !== 'connected') {
      messages.value.push({ role: 'user', content: userInput, toolCalls: [] })
      messages.value.push({
        role: 'assistant',
        content: `错误: orchestrator 会话未建立（${orchestratorError.value || '未连接'}），请稍后重试`,
        toolCalls: []
      })
      return
    }

    // 中断上一轮回合与未决审批（流被 abort 后审批再无终态）
    if (abortChat) { abortChat(); abortChat = null }
    for (const item of pendingApprovals.value) {
      if (item.status === 'pending') {
        item.status = 'timeout'
        clearApprovalTimer(item.callId)
      }
    }

    isProcessing.value = true
    analyzeState.isAnalyzing = true
    analyzeState.analyzingReason = ''
    messages.value.push({ role: 'user', content: userInput, toolCalls: [] })
    messages.value.push({ role: 'assistant', content: '', toolCalls: [] })
    const assistantMessage = messages.value[messages.value.length - 1]

    abortChat = startChatAttempt(assistantMessage, false)
  }

  /**
   * 发起一轮 chat 流，回调绑定到指定 assistant 占位消息
   * @description 每轮递增 chatEpoch（识别过期自愈）；isRetry=true 为 403 自愈后的重试轮，
   * 不再二次自愈，错误按现状上屏。
   * @param assistantMessage - 本轮流式渲染写入的 assistant 占位消息
   * @param isRetry - 是否为会话自愈重试轮
   * @returns abort 取消函数
   */
  const startChatAttempt = (assistantMessage: ChatMessage, isRetry: boolean): (() => void) => {
    const epoch = ++chatEpoch
    /** 自愈标记：本轮已触发 403 自愈——onFinish 不复位处理态（交由重试轮管理），且不重复触发自愈 */
    let healing = false
    return sendChat({
      baseUrl,
      sessionId: sessionId.value as string,
      messages: buildRequestMessages(),
      callbacks: {
        onTextDelta: (delta) => {
          // 首个正文 token 到达即结束「思考中」展示
          analyzeState.isAnalyzing = false
          // 归一化①：丢弃正文前导空白 delta（vLLM 常在正文起始补多个换行，
          // 累积进 content 会被 whitespace-pre-wrap 渲染成大片空白；流式期不跳变）
          if (!assistantMessage.content && !delta.trim()) return
          assistantMessage.content += delta
        },
        onReasoningDelta: (delta) => {
          assistantMessage.reason = (assistantMessage.reason || '') + delta
          analyzeState.analyzingReason = assistantMessage.reason
        },
        onToolInputStart: (toolCallId, toolName) => {
          upsertToolCall(assistantMessage, toolCallId, toolName)
        },
        onToolInputAvailable: ({ toolCallId, toolName, input, errorText }) => {
          const tc = upsertToolCall(assistantMessage, toolCallId, toolName)
          tc.params = input
          if (errorText) {
            tc.status = 'error'
            tc.result = { success: false, error: errorText }
          } else if (tc.status !== 'pending-approval') {
            tc.status = 'executing'
          }
        },
        onToolOutputAvailable: ({ toolCallId, output, denied, errorText }) => {
          const tc = upsertToolCall(assistantMessage, toolCallId)
          if (denied) {
            // denied 对 codegen 与普通工具同口径：工具卡 denied 态
            tc.result = output
            tc.status = 'denied'
            settleApproval(toolCallId, 'denied')
            return
          }
          // codegen 执行侧：orchestrator 不执行代码，批准后的 {code, approvedForExecution} 在主页面执行
          if (tc.toolName === CODEGEN_TOOL_NAME && !errorText) {
            handleCodegenOutput(tc, output)
            return
          }
          tc.result = output
          if (errorText || isErrorOutput(output)) {
            tc.status = 'error'
            settleApproval(toolCallId, 'approved')
          } else {
            tc.status = 'success'
            settleApproval(toolCallId, 'approved')
          }
        },
        onToolApproval: (req) => {
          registerApproval(assistantMessage, req)
        },
        onError: (message) => {
          // 会话过期 403（且仅这一类）：透明自愈——重签+重连+重发，不产生错误气泡；
          // 同一条用户消息最多自愈 1 次（重试轮 isRetry=true 直接走下方报错）
          if (!isRetry && !healing && isSessionExpiredError(message)) {
            healing = true
            void healSessionAndRetry(assistantMessage, epoch)
            return
          }
          analyzeState.isAnalyzing = false
          assistantMessage.content += `${assistantMessage.content ? '\n' : ''}错误: ${message}`
        },
        onFinish: () => {
          // 触发自愈的本轮 finish 不复位处理态，由重试轮收尾，避免「处理中」闪烁
          if (healing) return
          isProcessing.value = false
          analyzeState.isAnalyzing = false
        }
      }
    })
  }

  /**
   * 403 会话过期自愈：静默重签会话 → 新 sid 重建命令通道 → 重发当前消息
   * @description 全程不触碰 orchestratorStatus（连接状态指示保持「已连接」不闪烁）；
   * 仅重签本身失败才上屏报错。epoch 校验：自愈等待期间用户已发起新一轮（或手动 reconnect）
   * 时放弃本次过期自愈，防止覆盖新回合状态。
   * @param assistantMessage - 待重发消息对应的 assistant 占位消息
   * @param epoch - 触发自愈时的回合编号
   */
  const healSessionAndRetry = async (assistantMessage: ChatMessage, epoch: number) => {
    try {
      const newSid = await createChatSession(baseUrl)
      if (epoch !== chatEpoch) return
      sessionId.value = newSid
      console.log('[AI] Session expired, re-issued:', newSid)
      // 用新 sid 重建命令通道（/channel/events 校验 sessionId 归属；connect 复用期间 isConnected 不闪断）
      sse.connect(newSid)
      // 防御性清空占位消息（403 发生在流开始前，正常本为空；兜底防重试内容与残留叠加）
      assistantMessage.content = ''
      assistantMessage.reason = undefined
      assistantMessage.toolCalls = []
      abortChat = startChatAttempt(assistantMessage, true)
    } catch (e: any) {
      if (epoch !== chatEpoch) return
      analyzeState.isAnalyzing = false
      isProcessing.value = false
      assistantMessage.content += `${assistantMessage.content ? '\n' : ''}错误: 会话已过期且重签失败（${e?.message || e}），请稍后重试`
    }
  }

  const stopActivity = () => {
    chatEpoch += 1
    if (abortChat) {
      abortChat()
      abortChat = null
    }
    isProcessing.value = false
    analyzeState.isAnalyzing = false
    for (const item of pendingApprovals.value) {
      if (item.status === 'pending') item.status = 'timeout'
      clearApprovalTimer(item.callId)
    }
    sse.setActive?.(false)
  }

  const suspend = () => {
    if (!active || destroyed) return
    active = false
    stopActivity()
  }

  const resume = async () => {
    if (active || destroyed) return
    active = true
    sse.setActive?.(true)
    await reconnect()
  }

  const destroy = () => {
    if (destroyed) return
    stopActivity()
    active = false
    destroyed = true
    sse.destroy?.()
    sessionId.value = null
    orchestratorStatus.value = 'idle'
    channelStatus.value = 'disconnected'
  }

  // 插件激活时立即签发会话（签发成功后自动连命令通道）
  initialize()

  return {
    Cesium, viewer,
    orchestratorStatus, orchestratorError, orchestratorUrl,
    sessionId, channelStatus, enabledTools,
    messages, isProcessing, analyzeState,
    pendingApprovals,
    sendMessage, respondApproval, reconnect,
    suspend, resume, destroy
  }
}
