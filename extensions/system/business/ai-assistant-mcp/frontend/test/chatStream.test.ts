/**
 * 文件作用：chatStream.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * chatStream（AI SDK UI message stream 零依赖解析器）单元测试
 * @description 用 Web Streams API 手工构造 SSE 字节流（Node 22 内置 ReadableStream），
 * 覆盖：单行 part、断行重组（跨 2/3 chunk、\r\n 混合、多字节字符跨界）、各 part 分发、
 * denied 识别矩阵、[DONE]/finish/EOF 幂等收尾、AbortError 静默、坏行容错、HTTP/网络错误。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createChatSession,
  isErrorToolOutput,
  isSessionExpiredError,
  sendApproval,
  sendChat,
  type ChatStreamCallbacks,
  type SendChatOptions,
  type ToolApprovalRequest,
  type ToolInputAvailable,
  type ToolOutputAvailable
} from '../src/api/chatStream'

const encoder = new TextEncoder()

// ─── 测试工具 ────────────────────────────────────────────────────────────────

/** 事件收集器：所有回调落进数组，finish 计数 */
interface Collected {
  texts: string[]
  reasonings: string[]
  toolStarts: Array<{ toolCallId: string; toolName: string }>
  toolInputs: ToolInputAvailable[]
  toolOutputs: ToolOutputAvailable[]
  approvals: ToolApprovalRequest[]
  errors: string[]
  finishCount: number
}

function createCollector() {
  const collected: Collected = {
    texts: [],
    reasonings: [],
    toolStarts: [],
    toolInputs: [],
    toolOutputs: [],
    approvals: [],
    errors: [],
    finishCount: 0
  }
  const callbacks: Required<ChatStreamCallbacks> = {
    onTextDelta: (d) => collected.texts.push(d),
    onReasoningDelta: (d) => collected.reasonings.push(d),
    onToolInputStart: (toolCallId, toolName) => collected.toolStarts.push({ toolCallId, toolName }),
    onToolInputAvailable: (c) => collected.toolInputs.push(c),
    onToolOutputAvailable: (r) => collected.toolOutputs.push(r),
    onToolApproval: (r) => collected.approvals.push(r),
    onError: (m) => collected.errors.push(m),
    onFinish: () => {
      collected.finishCount += 1
    }
  }
  return { collected, callbacks }
}

/** 字符串 chunk 构造 SSE 字节流 */
function sseStreamFromStrings(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    }
  })
}

/** 裸字节 chunk 构造 SSE 流（模拟多字节字符被 chunk 边界切开） */
function sseStreamFromBytes(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    }
  })
}

/** stub fetch 返回 SSE 响应 */
function stubSSEResponse(body: ReadableStream<Uint8Array>, init?: { status?: number; bodyText?: string }) {
  const status = init?.status ?? 200
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => init?.bodyText ?? '',
    body
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 让挂起的微任务/流读取全部跑完 */
function settle(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 跑一条 SSE 流直到 onFinish（HTTP 错误/EOF/[DONE] 路径均会触发 finish） */
async function runChat(
  chunks: string[],
  extra?: Partial<SendChatOptions>
): Promise<{ collected: Collected; fetchMock: ReturnType<typeof vi.fn> }> {
  const fetchMock = stubSSEResponse(sseStreamFromStrings(chunks))
  const { collected, callbacks } = createCollector()
  await new Promise<void>((resolve) => {
    sendChat({
      baseUrl: 'http://orchestrator.test',
      sessionId: 'sess-1',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      ...extra,
      callbacks: {
        ...callbacks,
        ...extra?.callbacks,
        onFinish: () => {
          collected.finishCount += 1
          resolve()
        }
      }
    })
  })
  await settle()
  return { collected, fetchMock }
}

const DEFAULT_MESSAGES: SendChatOptions['messages'] = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]

// ─── 环境准备 ────────────────────────────────────────────────────────────────

beforeEach(() => {
  // node 环境无 document：authHeaders 读取 document.cookie，注入空 stub（无登录态 → 无 Authorization 头）
  vi.stubGlobal('document', { cookie: '' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── SSE 解析与断行重组 ──────────────────────────────────────────────────────

describe('SSE 解析与断行重组', () => {
  it('完整单行 part：单 chunk 多行顺序分发', async () => {
    const { collected } = await runChat([
      'data: {"type":"text-delta","delta":"你好"}\n' +
        'data: {"type":"text-delta","delta":"世界"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.texts).toEqual(['你好', '世界'])
    expect(collected.finishCount).toBe(1)
    expect(collected.errors).toEqual([])
  })

  it('一个 JSON 跨两个 chunk：断行正确重组', async () => {
    const line = 'data: {"type":"text-delta","delta":"hello"}\n'
    const { collected } = await runChat([line.slice(0, 25), line.slice(25) + 'data: [DONE]\n'])
    expect(collected.texts).toEqual(['hello'])
    expect(collected.finishCount).toBe(1)
  })

  it('一行跨三个 chunk：JSON 从中间两处断开', async () => {
    const line = 'data: {"type":"tool-input-available","toolCallId":"c1","toolName":"camera_fly_to","input":{"lon":116.4}}\n'
    const third = Math.ceil(line.length / 3)
    const { collected } = await runChat([
      line.slice(0, third),
      line.slice(third, third * 2),
      line.slice(third * 2) + 'data: [DONE]\n'
    ])
    expect(collected.toolInputs).toEqual([
      { toolCallId: 'c1', toolName: 'camera_fly_to', input: { lon: 116.4 } }
    ])
  })

  it('\\r\\n 混合行尾：\\r 被剥离，[DONE]\\r 同样识别', async () => {
    const { collected } = await runChat([
      'data: {"type":"text-delta","delta":"a"}\r\n',
      'data: {"type":"text-delta","delta":"b"}\n',
      'data: [DONE]\r\n'
    ])
    expect(collected.texts).toEqual(['a', 'b'])
    expect(collected.finishCount).toBe(1)
  })

  it('多字节中文字符被 chunk 边界切开：TextDecoder stream 模式重组', async () => {
    const prefix = 'data: {"type":"text-delta","delta":"'
    const full = encoder.encode(prefix + '你好' + '"}\ndata: [DONE]\n')
    // 「你」为 3 字节 UTF-8，切点落在「你」的第 1、2 字节之间
    const cut = encoder.encode(prefix).length + 1
    const fetchMock = stubSSEResponse(sseStreamFromBytes([full.slice(0, cut), full.slice(cut)]))
    const { collected, callbacks } = createCollector()
    await new Promise<void>((resolve) => {
      sendChat({
        baseUrl: 'http://orchestrator.test',
        sessionId: 'sess-1',
        messages: DEFAULT_MESSAGES,
        callbacks: { ...callbacks, onFinish: () => { collected.finishCount += 1; resolve() } }
      })
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(collected.texts).toEqual(['你好'])
  })

  it('EOF 残留尾行（无换行结尾）：buffer 中最后一行被解析', async () => {
    const { collected } = await runChat(['data: {"type":"text-delta","delta":"tail"}'])
    expect(collected.texts).toEqual(['tail'])
    expect(collected.finishCount).toBe(1)
  })

  it('坏行容错：注释/空行/event 行/非 JSON data 行全部忽略，合法行照常', async () => {
    const { collected } = await runChat([
      ': keep-alive\n' +
        '\n' +
        'event: message\n' +
        'data: not-json\n' +
        'data: \n' +
        'data: {"type":"text-delta","delta":"ok"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.texts).toEqual(['ok'])
    expect(collected.errors).toEqual([])
    expect(collected.finishCount).toBe(1)
  })

  it('[DONE] 后立即停止读取：后续 chunk 的 part 不再分发', async () => {
    const { collected } = await runChat([
      'data: {"type":"text-delta","delta":"before"}\ndata: [DONE]\n',
      'data: {"type":"text-delta","delta":"late"}\n'
    ])
    expect(collected.texts).toEqual(['before'])
    expect(collected.finishCount).toBe(1)
  })

  it('finish part + [DONE] + EOF：onFinish 幂等只触发一次', async () => {
    const { collected } = await runChat(['data: {"type":"finish"}\ndata: [DONE]\n'])
    expect(collected.finishCount).toBe(1)
  })

  it('finish-message part 同样触发收尾', async () => {
    const { collected } = await runChat(['data: {"type":"finish-message"}\n'])
    expect(collected.finishCount).toBe(1)
  })
})

// ─── part 分发 ───────────────────────────────────────────────────────────────

describe('part 分发', () => {
  it('text-delta 累积顺序：多个 delta 按流序到达', async () => {
    const { collected } = await runChat([
      'data: {"type":"text-delta","delta":"第一段，"}\n' +
        'data: {"type":"text-delta","delta":"第二段，"}\n' +
        'data: {"type":"text-delta","delta":"第三段"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.texts.join('')).toBe('第一段，第二段，第三段')
  })

  it('text-delta 空 delta 忽略', async () => {
    const { collected } = await runChat([
      'data: {"type":"text-delta","delta":""}\ndata: {"type":"text-delta"}\ndata: [DONE]\n'
    ])
    expect(collected.texts).toEqual([])
  })

  it('reasoning-delta 累积 + 旧式 reasoning 三载体（delta/textDelta/text）兼容', async () => {
    const { collected } = await runChat([
      'data: {"type":"reasoning-delta","delta":"先想"}\n' +
        'data: {"type":"reasoning-delta","delta":"再想"}\n' +
        'data: {"type":"reasoning","delta":"旧A"}\n' +
        'data: {"type":"reasoning","textDelta":"旧B"}\n' +
        'data: {"type":"reasoning","text":"旧C"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.reasonings).toEqual(['先想', '再想', '旧A', '旧B', '旧C'])
  })

  it('工具状态机：tool-input-start → tool-input-available → tool-output-available', async () => {
    const { collected } = await runChat([
      'data: {"type":"tool-input-start","toolCallId":"c1","toolName":"camera_fly_to"}\n' +
        'data: {"type":"tool-input-available","toolCallId":"c1","toolName":"camera_fly_to","input":{"lon":116.4,"lat":39.9}}\n' +
        'data: {"type":"tool-output-available","toolCallId":"c1","output":{"success":true,"result":{"ok":1}}}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.toolStarts).toEqual([{ toolCallId: 'c1', toolName: 'camera_fly_to' }])
    expect(collected.toolInputs).toEqual([
      { toolCallId: 'c1', toolName: 'camera_fly_to', input: { lon: 116.4, lat: 39.9 } }
    ])
    expect(collected.toolOutputs).toEqual([
      { toolCallId: 'c1', output: { success: true, result: { ok: 1 } }, denied: false }
    ])
  })

  it('tool-input-error：入参阶段失败，走 onToolInputAvailable 并携带 errorText', async () => {
    const { collected } = await runChat([
      'data: {"type":"tool-input-error","toolCallId":"c2","toolName":"entity_add","errorText":"args invalid"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.toolInputs).toHaveLength(1)
    expect(collected.toolInputs[0]).toMatchObject({ toolCallId: 'c2', toolName: 'entity_add', errorText: 'args invalid' })
  })

  it('tool-input-error 缺 errorText 时兜底文案', async () => {
    const { collected } = await runChat([
      'data: {"type":"tool-input-error","toolCallId":"c2","toolName":"entity_add"}\ndata: [DONE]\n'
    ])
    expect(collected.toolInputs[0]?.errorText).toBe('tool input error')
  })

  it('tool-output-error：denied=false，output 包装为 {success:false,error}', async () => {
    const { collected } = await runChat([
      'data: {"type":"tool-output-error","toolCallId":"c3","errorText":"boom"}\ndata: [DONE]\n'
    ])
    expect(collected.toolOutputs).toEqual([
      { toolCallId: 'c3', output: { success: false, error: 'boom' }, denied: false, errorText: 'boom' }
    ])
  })

  it('tool-output-denied：AI SDK 原生审批拒绝 part → denied=true', async () => {
    const { collected } = await runChat([
      'data: {"type":"tool-output-denied","toolCallId":"c4"}\ndata: [DONE]\n'
    ])
    expect(collected.toolOutputs).toHaveLength(1)
    expect(collected.toolOutputs[0]?.denied).toBe(true)
    expect(collected.toolOutputs[0]?.output).toMatchObject({ success: false, denied: true })
  })

  it('tool-input-available / tool-output-available 缺关键字段不回调', async () => {
    const { collected } = await runChat([
      'data: {"type":"tool-input-available","toolCallId":"c5"}\n' + // 缺 toolName
        'data: {"type":"tool-output-available","output":{"success":true}}\n' + // 缺 toolCallId
        'data: [DONE]\n'
    ])
    expect(collected.toolInputs).toEqual([])
    expect(collected.toolOutputs).toEqual([])
  })

  it('结构性 part（start/text-start/finish-step 等）静默忽略', async () => {
    const { collected } = await runChat([
      'data: {"type":"start"}\n' +
        'data: {"type":"start-step"}\n' +
        'data: {"type":"text-start","id":"t1"}\n' +
        'data: {"type":"text-delta","delta":"正文"}\n' +
        'data: {"type":"text-end","id":"t1"}\n' +
        'data: {"type":"finish-step"}\n' +
        'data: {"type":"reasoning-start","id":"r1"}\n' +
        'data: {"type":"reasoning-end","id":"r1"}\n' +
        'data: {"type":"tool-input-delta","toolCallId":"c1","inputTextDelta":"{}"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.texts).toEqual(['正文'])
    expect(collected.errors).toEqual([])
  })

  it('未知 part（file / source-url）忽略并 debug 日志', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { collected } = await runChat([
      'data: {"type":"file","url":"http://x/f.png"}\n' +
        'data: {"type":"source-url","sourceId":"s1"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.texts).toEqual([])
    expect(collected.errors).toEqual([])
    expect(debugSpy).toHaveBeenCalledTimes(2)
  })

  it('error part：errorText 与 message 两种载体，缺省兜底', async () => {
    const { collected } = await runChat([
      'data: {"type":"error","errorText":"llm down"}\n' +
        'data: {"type":"error","message":"legacy msg"}\n' +
        'data: {"type":"error"}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.errors).toEqual(['llm down', 'legacy msg', 'stream error'])
  })
})

// ─── data-tool-approval ──────────────────────────────────────────────────────

describe('data-tool-approval 回调', () => {
  it('AI SDK 标准形态：载荷在 part.data，全字段透传', async () => {
    const { collected } = await runChat([
      'data: {"type":"data-tool-approval","data":{"callId":"a1","tool":"camera_fly_to","args":{"lon":116.4},"reason":"高危操作","riskLevel":"high"}}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.approvals).toEqual([
      { callId: 'a1', tool: 'camera_fly_to', args: { lon: 116.4 }, reason: '高危操作', riskLevel: 'high' }
    ])
  })

  it('兼容平铺形态：callId/tool 直接在 part 上', async () => {
    const { collected } = await runChat([
      'data: {"type":"data-tool-approval","callId":"a2","tool":"entity_add","args":{}}\ndata: [DONE]\n'
    ])
    expect(collected.approvals).toEqual([
      { callId: 'a2', tool: 'entity_add', args: {}, reason: undefined, riskLevel: undefined }
    ])
  })

  it('缺 callId 或 tool 不触发审批回调', async () => {
    const { collected } = await runChat([
      'data: {"type":"data-tool-approval","data":{"tool":"camera_fly_to"}}\n' +
        'data: {"type":"data-tool-approval","data":{"callId":"a3"}}\n' +
        'data: [DONE]\n'
    ])
    expect(collected.approvals).toEqual([])
  })
})

// ─── denied 识别矩阵 ─────────────────────────────────────────────────────────

describe('denied 识别（tool-output-available）', () => {
  async function deniedOf(output: unknown): Promise<boolean> {
    const line = `data: {"type":"tool-output-available","toolCallId":"c","output":${JSON.stringify(output)}}\n`
    const { collected } = await runChat([line + 'data: [DONE]\n'])
    expect(collected.toolOutputs).toHaveLength(1)
    return collected.toolOutputs[0]!.denied
  }

  it('output.denied === true → denied', async () => {
    expect(await deniedOf({ denied: true })).toBe(true)
  })

  it('output.approved === false → denied', async () => {
    expect(await deniedOf({ approved: false })).toBe(true)
  })

  it('output.error 含 denied 关键字 → denied', async () => {
    expect(await deniedOf({ error: 'Tool execution denied by user' })).toBe(true)
    expect(await deniedOf({ error: 'request was rejected' })).toBe(true)
  })

  it('MCP CallToolResult：isError + 拒绝文本 → denied', async () => {
    expect(
      await deniedOf({ content: [{ type: 'text', text: '用户拒绝了该工具调用（denied）' }], isError: true })
    ).toBe(true)
  })

  it('MCP CallToolResult：isError 但为超时文本（无拒绝关键字）→ 非 denied', async () => {
    expect(await deniedOf({ content: [{ type: 'text', text: 'Approval request timed out' }], isError: true })).toBe(
      false
    )
  })

  it('正常输出（success:true / 业务数据）→ 非 denied', async () => {
    expect(await deniedOf({ success: true, result: { count: 3 } })).toBe(false)
    expect(await deniedOf({ data: [1, 2, 3] })).toBe(false)
  })

  it('非对象 output（字符串/数字/null）→ 非 denied', async () => {
    expect(await deniedOf('plain text')).toBe(false)
    expect(await deniedOf(42)).toBe(false)
    expect(await deniedOf(null)).toBe(false)
  })
})

describe('isSessionExpiredError（403 会话过期判定，自愈重试唯一触发条件）', () => {
  it('HTTP 403 + 后端约定文案 → true（JSON body / 纯文本 body 均命中）', () => {
    expect(isSessionExpiredError('Chat failed: HTTP 403 - {"error":"session not found or expired"}')).toBe(true)
    expect(isSessionExpiredError('Chat failed: HTTP 403 - session not found or expired')).toBe(true)
  })

  it('非 403 携带文案 / 403 其它原因 / 裸文案（流内 error part）→ false', () => {
    expect(isSessionExpiredError('Chat failed: HTTP 500 - {"error":"session not found or expired"}')).toBe(false)
    expect(isSessionExpiredError('Chat failed: HTTP 403 - {"error":"forbidden"}')).toBe(false)
    expect(isSessionExpiredError('Chat failed: HTTP 401 - unauthorized')).toBe(false)
    expect(isSessionExpiredError('session not found or expired')).toBe(false)
    expect(isSessionExpiredError('socket hangup')).toBe(false)
  })
})

describe('isErrorToolOutput（导出供组合层复用）', () => {
  it('isError === true → true', () => {
    expect(isErrorToolOutput({ isError: true })).toBe(true)
  })

  it('success === false → true', () => {
    expect(isErrorToolOutput({ success: false })).toBe(true)
  })

  it('正常/非对象 → false', () => {
    expect(isErrorToolOutput({ success: true })).toBe(false)
    expect(isErrorToolOutput({})).toBe(false)
    expect(isErrorToolOutput(null)).toBe(false)
    expect(isErrorToolOutput('err')).toBe(false)
  })
})

// ─── 生命周期与错误路径 ──────────────────────────────────────────────────────

describe('生命周期与错误路径', () => {
  it('HTTP 非 2xx：onError 含状态码与截断 body，随后 finish', async () => {
    const fetchMock = stubSSEResponse(sseStreamFromStrings([]), { status: 500, bodyText: 'server boom' })
    const { collected, callbacks } = createCollector()
    await new Promise<void>((resolve) => {
      sendChat({
        baseUrl: 'http://orchestrator.test',
        sessionId: 'sess-1',
        messages: DEFAULT_MESSAGES,
        callbacks: { ...callbacks, onFinish: () => { collected.finishCount += 1; resolve() } }
      })
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(collected.errors).toEqual(['Chat failed: HTTP 500 - server boom'])
    expect(collected.finishCount).toBe(1)
  })

  it('无响应 body：onError "No response body" + finish', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', body: null }))
    vi.stubGlobal('fetch', fetchMock)
    const { collected, callbacks } = createCollector()
    await new Promise<void>((resolve) => {
      sendChat({
        baseUrl: 'http://orchestrator.test',
        sessionId: 'sess-1',
        messages: DEFAULT_MESSAGES,
        callbacks: { ...callbacks, onFinish: () => { collected.finishCount += 1; resolve() } }
      })
    })
    expect(collected.errors).toEqual(['No response body'])
    expect(collected.finishCount).toBe(1)
  })

  it('AbortError 静默：不报错误也不触发 finish', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { collected, callbacks } = createCollector()
    sendChat({
      baseUrl: 'http://orchestrator.test',
      sessionId: 'sess-1',
      messages: DEFAULT_MESSAGES,
      callbacks
    })
    await settle()
    expect(collected.errors).toEqual([])
    expect(collected.finishCount).toBe(0)
  })

  it('网络错误（非 AbortError）：onError 携带 message + finish', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('socket hangup')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { collected, callbacks } = createCollector()
    await new Promise<void>((resolve) => {
      sendChat({
        baseUrl: 'http://orchestrator.test',
        sessionId: 'sess-1',
        messages: DEFAULT_MESSAGES,
        callbacks: { ...callbacks, onFinish: () => { collected.finishCount += 1; resolve() } }
      })
    })
    expect(collected.errors).toEqual(['socket hangup'])
    expect(collected.finishCount).toBe(1)
  })

  it('请求形态：POST {baseUrl}/chat（去尾斜杠）、body 含 sessionId/messages、SSE Accept 头', async () => {
    const { fetchMock } = await runChat(['data: [DONE]\n'], { baseUrl: 'http://orchestrator.test/' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://orchestrator.test/chat')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Accept).toBe('text/event-stream')
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 'sess-1', messages: DEFAULT_MESSAGES })
  })

  it('外部 AbortSignal 接线：外部 abort 传导到 fetch 的 signal', async () => {
    let seenSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined
      return { ok: true, status: 200, text: async () => '', body: sseStreamFromStrings(['data: [DONE]\n']) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const external = new AbortController()
    const { collected } = createCollector()
    await new Promise<void>((resolve) => {
      sendChat({
        baseUrl: 'http://orchestrator.test',
        sessionId: 'sess-1',
        messages: DEFAULT_MESSAGES,
        signal: external.signal,
        callbacks: { onFinish: () => { collected.finishCount += 1; resolve() } }
      })
      external.abort()
    })
    expect(seenSignal).toBeDefined()
    expect(seenSignal!.aborted).toBe(true)
  })
})

// ─── createChatSession / sendApproval ────────────────────────────────────────

describe('createChatSession / sendApproval', () => {
  it('createChatSession 成功返回 sessionId，POST /chat/session', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sessionId: 's-123' }) }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createChatSession('http://orchestrator.test/')).resolves.toBe('s-123')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://orchestrator.test/chat/session')
    expect(init.method).toBe('POST')
  })

  it('createChatSession 失败：HTTP 错误与缺 sessionId 均抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    await expect(createChatSession('http://orchestrator.test')).rejects.toThrow('Create session failed: HTTP 503')

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
    await expect(createChatSession('http://orchestrator.test')).rejects.toThrow('missing sessionId')
  })

  it('sendApproval 成功：body 携带 sessionId/callId/approved', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      sendApproval({ baseUrl: 'http://orchestrator.test', sessionId: 's-1', callId: 'a-1', approved: false })
    ).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://orchestrator.test/chat/approval')
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 's-1', callId: 'a-1', approved: false })
  })

  it('sendApproval 失败：HTTP 错误抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
    await expect(
      sendApproval({ baseUrl: 'http://orchestrator.test', sessionId: 's-1', callId: 'a-1', approved: true })
    ).rejects.toThrow('Approval failed: HTTP 403')
  })
})
