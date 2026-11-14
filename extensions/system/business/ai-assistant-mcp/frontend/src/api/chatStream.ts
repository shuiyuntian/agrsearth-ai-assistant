/**
 * 文件作用：ai-orchestrator 聊天通道 API 封装（AI SDK UI message stream 零依赖解析器）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-07-26) 新增 isSessionExpiredError 判定导出：严格匹配「HTTP 403 + 后端约定
 *                       session not found or expired 文案」，供组合层做会话过期自愈重试，
 *                       其它 4xx/5xx 一律不命中。
 *   - 1.0.0 (2026-07-22) P1-B：替代 api/aiAgent.ts 三段式手写编排。
 *                       POST /chat 消费 AI SDK v7 UI message stream（SSE），
 *                       标准 parts：text-delta / reasoning(-delta) / tool-input-available /
 *                       tool-output-available / error / finish；自定义 data part
 *                       data-tool-approval 触发人工审批，回执 POST /chat/approval。
 *                       协议解析方式对齐 CesiumGS cesiumjs-ai-starter-app chat-client。
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { authHeaders } from './auth'

/** 发往 /chat 的单条消息（AI SDK UIMessage 形态：role + parts） */
export interface ChatRequestMessage {
  role: 'user' | 'assistant'
  parts: Array<Record<string, unknown>>
}

/** 工具调用入参就绪（tool-input-available） */
export interface ToolInputAvailable {
  toolCallId: string
  toolName: string
  input: unknown
  /** tool-input-error 时携带：模型产出的参数无法解析/校验 */
  errorText?: string
}

/** 工具执行结果（tool-output-available / tool-output-error / tool-output-denied） */
export interface ToolOutputAvailable {
  toolCallId: string
  output: unknown
  /** 审批拒绝（含 tool-output-denied 与 output 中带 denied 标记的情况） */
  denied: boolean
  /** tool-output-error 时携带 */
  errorText?: string
}

/** 审批请求（自定义 data part：data-tool-approval） */
export interface ToolApprovalRequest {
  callId: string
  tool: string
  args: unknown
  reason?: string
  riskLevel?: string
}

/** 流式回调集合，全部可选 */
export interface ChatStreamCallbacks {
  /** 正文增量（text-delta） */
  onTextDelta?: (delta: string) => void
  /** 思考增量（reasoning-delta，兼容旧式 reasoning part） */
  onReasoningDelta?: (delta: string) => void
  /** 工具调用开始（tool-input-start，仅提前露出工具名，参数未就绪） */
  onToolInputStart?: (toolCallId: string, toolName: string) => void
  /** 工具入参就绪（tool-input-available / tool-input-error） */
  onToolInputAvailable?: (call: ToolInputAvailable) => void
  /** 工具结果（tool-output-available / tool-output-error / tool-output-denied） */
  onToolOutputAvailable?: (result: ToolOutputAvailable) => void
  /** 审批请求（data-tool-approval） */
  onToolApproval?: (req: ToolApprovalRequest) => void
  /** 流内 error part 或 HTTP/解析层错误 */
  onError?: (message: string) => void
  /** 流正常结束（finish part、[DONE] 或 reader EOF），幂等只触发一次 */
  onFinish?: () => void
}

/** sendChat 入参 */
export interface SendChatOptions {
  /** orchestrator 基础地址（'' 由调用方解析为同源 /ai/agent；本地联调 http://localhost:9600） */
  baseUrl: string
  /** 服务端签发的会话 ID（chat 与 channel 共用） */
  sessionId: string
  /** 对话历史（AI SDK UIMessage 形态） */
  messages: ChatRequestMessage[]
  /** 流式回调 */
  callbacks: ChatStreamCallbacks
  /** 可选外部 AbortSignal（与返回的 abort 等效，二选一） */
  signal?: AbortSignal
}

/**
 * 解析单行 SSE 数据为 UI message stream part
 * @description 只认 `data:` 行；空行、注释、event: 行、[DONE] 与非 JSON 保活行一律返回 null
 * @param line - 单行 SSE 文本
 * @returns part 对象或 null
 */
function parseSSELine(line: string): Record<string, any> | null {
  if (!line.startsWith('data:')) return null
  const data = line.slice(5).trim()
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * 判断工具输出是否为「审批拒绝」语义
 * @description 协议约定：rejected 后流中出 tool-output-available 且 output 携带 denied 标记；
 * 兼容两种载体：
 *  - 显式字段：output.denied === true / output.approved === false / output.error 含 denied 关键字；
 *  - MCP CallToolResult 形态（orchestrator 审批拒绝回 toolErrorResult）：
 *    `{content:[{type:'text',text:'…拒绝…（denied）…'}], isError:true}`，取 text 做关键字判定。
 */
function isDeniedOutput(output: any): boolean {
  if (!output || typeof output !== 'object') return false
  if (output.denied === true || output.approved === false) return true
  if (typeof output.error === 'string' && /denied|rejected|拒绝/i.test(output.error)) return true
  // MCP CallToolResult：拒绝/超时均以 isError 文本回喂（超时不算 denied，仅匹配拒绝关键字）
  const text = extractMcpText(output)
  if (text && /denied|rejected|拒绝/i.test(text)) return true
  return false
}

/**
 * 提取 MCP CallToolResult 的首段文本（{content:[{type:'text',text}]} 形态）
 */
function extractMcpText(output: any): string | null {
  const content = output?.content
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0]
    if (first && typeof first.text === 'string') return first.text
  }
  return null
}

/**
 * 判断工具输出是否为失败语义（MCP CallToolResult isError 或 output.success === false）
 * @description 导出供组合层（useAIAssistant）复用，保持工具卡状态机口径一致
 */
export function isErrorToolOutput(output: any): boolean {
  if (!output || typeof output !== 'object') return false
  if (output.isError === true) return true
  if (output.success === false) return true
  return false
}

/**
 * 分发一个 UI message stream part 到对应回调
 * 覆盖清单：start / start-step / finish-step / text-start / text-delta / text-end /
 * reasoning-start / reasoning-delta / reasoning-end / reasoning（旧式）/
 * tool-input-start / tool-input-delta / tool-input-available / tool-input-error /
 * tool-output-available / tool-output-error / tool-output-denied /
 * data-tool-approval（自定义）/ error / finish / [DONE]（在读取层处理）。
 * 未知 part（file、source-url、其他 data-*）忽略并 debug 日志。
 */
function dispatchPart(part: Record<string, any>, cb: ChatStreamCallbacks, finish: () => void) {
  switch (part.type) {
    case 'text-delta':
      if (typeof part.delta === 'string' && part.delta) cb.onTextDelta?.(part.delta)
      break
    case 'reasoning-delta':
      if (typeof part.delta === 'string' && part.delta) cb.onReasoningDelta?.(part.delta)
      break
    case 'reasoning': {
      // 旧式 reasoning part：delta / textDelta / text 三种载体兼容
      const delta = part.delta ?? part.textDelta ?? part.text
      if (typeof delta === 'string' && delta) cb.onReasoningDelta?.(delta)
      break
    }
    case 'tool-input-start':
      if (part.toolCallId && part.toolName) cb.onToolInputStart?.(part.toolCallId, part.toolName)
      break
    case 'tool-input-available':
      if (part.toolCallId && part.toolName) {
        cb.onToolInputAvailable?.({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input })
      }
      break
    case 'tool-input-error':
      // 模型产出的参数无法解析/校验：入参阶段即失败，直接视为该工具调用失败
      if (part.toolCallId && part.toolName) {
        cb.onToolInputAvailable?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          errorText: part.errorText || 'tool input error'
        })
      }
      break
    case 'tool-output-available':
      if (part.toolCallId) {
        cb.onToolOutputAvailable?.({
          toolCallId: part.toolCallId,
          output: part.output,
          denied: isDeniedOutput(part.output)
        })
      }
      break
    case 'tool-output-error':
      if (part.toolCallId) {
        cb.onToolOutputAvailable?.({
          toolCallId: part.toolCallId,
          output: { success: false, error: part.errorText || 'tool output error' },
          denied: false,
          errorText: part.errorText
        })
      }
      break
    case 'tool-output-denied':
      // AI SDK 原生审批拒绝 part（与自定义 data-tool-approval 流程并存兜底）
      if (part.toolCallId) {
        cb.onToolOutputAvailable?.({
          toolCallId: part.toolCallId,
          output: { success: false, denied: true, error: 'Tool call denied' },
          denied: true
        })
      }
      break
    case 'data-tool-approval': {
      // 自定义 data part：AI SDK data part 载荷在 part.data；兼容直接平铺
      const d = part.data ?? part
      if (d && d.callId && d.tool) {
        cb.onToolApproval?.({
          callId: d.callId,
          tool: d.tool,
          args: d.args,
          reason: d.reason,
          riskLevel: d.riskLevel
        })
      }
      break
    }
    case 'error':
      cb.onError?.(part.errorText || part.message || 'stream error')
      break
    case 'finish':
    case 'finish-message':
      finish()
      break
    case 'start':
    case 'start-step':
    case 'finish-step':
    case 'text-start':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-end':
    case 'tool-input-delta':
      // 结构性 part，无需处理
      break
    default:
      console.debug('[ChatStream] ignored part:', part.type)
  }
}

/**
 * 判断 onError 消息是否为「会话不存在或已过期」的 HTTP 403
 * @description 会话过期自愈重试的唯一触发条件，严格匹配 sendChat HTTP 错误前缀 +
 * 后端约定错误文案（`Chat failed: HTTP 403 - {"error":"session not found or expired"}`）；
 * 其它 403（如鉴权拒绝）、其它 4xx/5xx、流内 error part 均不命中。
 * @param message - onError 回调携带的错误消息
 */
export function isSessionExpiredError(message: string): boolean {
  return message.startsWith('Chat failed: HTTP 403') && message.includes('session not found or expired')
}

/**
 * 发起聊天请求并消费 UI message stream
 * @description fetch + reader 逐行读取 `data:`，buffer 按 \n 切分并保留不完整行至下一帧，
 * 确保跨 chunk 断行的 JSON 正确重组。返回 abort 函数（与传入 signal 等效）。
 * @param opts - 请求与回调
 * @returns abort 取消函数
 */
export function sendChat(opts: SendChatOptions): () => void {
  const { baseUrl, sessionId, messages, callbacks } = opts
  const ctrl = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  /** finish 幂等标记：finish part / [DONE] / EOF 只触发一次 onFinish */
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    callbacks.onFinish?.()
  }

  fetch(`${baseUrl.replace(/\/$/, '')}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
    body: JSON.stringify({ sessionId, messages }),
    signal: ctrl.signal,
    credentials: 'include'
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        callbacks.onError?.(`Chat failed: HTTP ${resp.status}${body ? ` - ${body.slice(0, 200)}` : ''}`)
        finish()
        return
      }
      const reader = resp.body?.getReader()
      if (!reader) {
        callbacks.onError?.('No response body')
        finish()
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // 断行重组：最后一段可能是不完整行，留到下一次读取拼接
        buffer = lines.pop() || ''
        for (const rawLine of lines) {
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
          if (line.startsWith('data:') && line.slice(5).trim() === '[DONE]') {
            finish()
            return
          }
          const part = parseSSELine(line)
          if (part) dispatchPart(part, callbacks, finish)
        }
      }
      // EOF：处理 buffer 中可能残留的最后一行（无换行结尾）
      const tail = buffer.trim()
      if (tail) {
        const part = parseSSELine(tail)
        if (part) dispatchPart(part, callbacks, finish)
      }
      finish()
    })
    .catch((e) => {
      // 主动 abort 不报错误也不触发 finish（由调用方自行复位状态）
      if (e?.name === 'AbortError') return
      callbacks.onError?.(e?.message || 'network error')
      finish()
    })

  return () => ctrl.abort()
}

/**
 * 申请聊天会话（服务端签发 sessionId，chat 与 channel 共用）
 * @param baseUrl - orchestrator 基础地址
 * @returns sessionId
 */
export async function createChatSession(baseUrl: string): Promise<string> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include'
  })
  if (!resp.ok) throw new Error(`Create session failed: HTTP ${resp.status}`)
  const data = await resp.json()
  if (!data?.sessionId) throw new Error('Create session failed: missing sessionId')
  return data.sessionId
}

/**
 * 审批回执
 * @description approved → 后续流中出 tool-output-available；rejected → tool-output-available（denied）
 * @param opts.baseUrl - orchestrator 基础地址
 * @param opts.sessionId - 会话 ID
 * @param opts.callId - 审批请求中的 callId
 * @param opts.approved - 批准 / 拒绝
 */
export async function sendApproval(opts: {
  baseUrl: string
  sessionId: string
  callId: string
  approved: boolean
}): Promise<void> {
  const resp = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/chat/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sessionId: opts.sessionId, callId: opts.callId, approved: opts.approved }),
    credentials: 'include'
  })
  if (!resp.ok) throw new Error(`Approval failed: HTTP ${resp.status}`)
}
