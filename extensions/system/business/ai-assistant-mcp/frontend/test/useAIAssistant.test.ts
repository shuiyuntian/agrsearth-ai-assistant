/**
 * 文件作用：useAIAssistant.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-26
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * useAIAssistant 会话 403 自愈重试单元测试
 * @description mock 边界：api/chatStream（sendChat/createChatSession/sendApproval 替换、
 * isSessionExpiredError 等纯函数保留真实实现）与 composables/useSSEConnection（connect/disconnect
 * 替换为 spy）。sendChat mock 只捕获入参不自发驱动流，由各用例手动触发 callbacks 模拟
 * 「首轮 403 session expired → 自愈重签 → 重试轮」时序。
 * 覆盖：① 403 session-not-found 自愈全链路（重签+重连+重发+成功渲染+无错误气泡）；
 * ② 重试轮仍失败 → 报错且不再自愈；③ 非会话类错误（403 其它原因/500/流内 error part）不自愈；
 * ④ 自愈后新 sid 被后续消息沿用；⑤ 重签本身失败 → 上屏报错。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendChatOptions } from '../src/api/chatStream'

// ─── mock 边界 ───────────────────────────────────────────────────────────────

const { sendChatMock, createSessionMock, sendApprovalMock, connectMock, disconnectMock, setActiveMock, destroyMock } = vi.hoisted(() => ({
  sendChatMock: vi.fn(),
  createSessionMock: vi.fn(),
  sendApprovalMock: vi.fn(),
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  setActiveMock: vi.fn(),
  destroyMock: vi.fn()
}))

vi.mock('../src/composables/useSSEConnection', async () => {
  const { ref } = await import('vue')
  return {
    useSSEConnection: () => ({
      isConnected: ref(true),
      error: ref(null),
      connect: connectMock,
      disconnect: disconnectMock,
      setActive: setActiveMock,
      destroy: destroyMock
    })
  }
})

vi.mock('../src/api/chatStream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/chatStream')>()
  return {
    ...actual,
    sendChat: sendChatMock,
    createChatSession: createSessionMock,
    sendApproval: sendApprovalMock
  }
})

const { useAIAssistant } = await import('../src/composables/useAIAssistant')

// ─── 测试工具 ────────────────────────────────────────────────────────────────

const SESSION_EXPIRED_403 = 'Chat failed: HTTP 403 - {"error":"session not found or expired"}'

/** sendChat 调用捕获表（每用例重建） */
let captured: SendChatOptions[]

/** 创建组合实例并等待初始会话签发完成（orchestratorStatus → connected） */
async function createAssistant() {
  const ai = useAIAssistant({}, { orchestratorBaseUrl: 'http://orchestrator.test' })
  await vi.waitFor(() => expect(ai.orchestratorStatus.value).toBe('connected'))
  return ai
}

type AI = Awaited<ReturnType<typeof createAssistant>>

/** 发送一条消息并返回捕获到的首轮调用 */
async function sendOne(ai: AI, text = '你好'): Promise<SendChatOptions> {
  await ai.sendMessage(text)
  expect(sendChatMock).toHaveBeenCalledTimes(1)
  const attempt = captured[0]!
  expect(attempt.sessionId).toBe('sess-1')
  return attempt
}

/** 末条 assistant 消息 */
function lastAssistant(ai: AI) {
  const msg = ai.messages.value[ai.messages.value.length - 1]!
  expect(msg.role).toBe('assistant')
  return msg
}

// ─── 环境准备 ────────────────────────────────────────────────────────────────

beforeEach(() => {
  // node 环境无 window/document：组合层读取 window.Cesium、authHeaders 读 document.cookie
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { cookie: '' })
  captured = []
  sendChatMock.mockReset().mockImplementation((opts: SendChatOptions) => {
    captured.push(opts)
    return () => {}
  })
  createSessionMock.mockReset().mockResolvedValue('sess-1')
  sendApprovalMock.mockReset()
  connectMock.mockReset()
  disconnectMock.mockReset()
  setActiveMock.mockReset()
  destroyMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── ① 403 session-not-found → 透明自愈 ──────────────────────────────────────

describe('会话 403 自愈重试', () => {
  it('403 session-not-found：重签+重连+重发，消息成功渲染，无错误气泡', async () => {
    const ai = await createAssistant()
    expect(connectMock).toHaveBeenCalledWith('sess-1')

    const first = await sendOne(ai)

    // 首轮 403 会话过期（HTTP 错误后 chatStream 会紧接 finish，按真实时序模拟）
    createSessionMock.mockResolvedValueOnce('sess-2')
    first.callbacks.onError!(SESSION_EXPIRED_403)
    first.callbacks.onFinish!()

    // 自愈：重签 sess-2 → 新 sid 重建命令通道 → 新 sid 重发
    await vi.waitFor(() => expect(captured).toHaveLength(2))
    expect(createSessionMock).toHaveBeenCalledTimes(2) // init + 自愈
    expect(ai.sessionId.value).toBe('sess-2')
    expect(connectMock).toHaveBeenLastCalledWith('sess-2')
    expect(captured[1]!.sessionId).toBe('sess-2')
    // 重发载荷与首轮一致（同一用户消息）
    expect(captured[1]!.messages).toEqual(first.messages)

    // 自愈全程：处理中不中断、连接状态指示保持 connected
    expect(ai.isProcessing.value).toBe(true)
    expect(ai.orchestratorStatus.value).toBe('connected')
    expect(ai.orchestratorError.value).toBeNull()
    expect(ai.channelStatus.value).toBe('connected')

    // 重试轮正常出流：正文渲染 + 收尾复位，无任何错误气泡
    const retry = captured[1]!
    retry.callbacks.onTextDelta!('你好，有什么可以帮你？')
    retry.callbacks.onFinish!()
    expect(ai.isProcessing.value).toBe(false)
    const assistant = lastAssistant(ai)
    expect(assistant.content).toBe('你好，有什么可以帮你？')
    expect(assistant.content).not.toContain('错误')
    expect(ai.messages.value.filter((m) => m.content.includes('错误'))).toHaveLength(0)
  })

  // ─── ② 重试一次后仍失败 → 报错且不再重试 ──────────────────────────────────

  it('重试轮仍 403：错误上屏，不再二次重签/重发', async () => {
    const ai = await createAssistant()
    const first = await sendOne(ai)

    createSessionMock.mockResolvedValueOnce('sess-2')
    first.callbacks.onError!(SESSION_EXPIRED_403)
    first.callbacks.onFinish!()
    await vi.waitFor(() => expect(captured).toHaveLength(2))

    // 重试轮再次 403 session expired：不再自愈
    const retry = captured[1]!
    retry.callbacks.onError!(SESSION_EXPIRED_403)
    retry.callbacks.onFinish!()

    await vi.waitFor(() => expect(ai.isProcessing.value).toBe(false))
    expect(captured).toHaveLength(2) // 无第三轮
    expect(createSessionMock).toHaveBeenCalledTimes(2) // 不再重签
    const assistant = lastAssistant(ai)
    expect(assistant.content).toContain('错误')
    expect(assistant.content).toContain('HTTP 403')
  })

  // ─── ③ 非会话类错误 → 不触发重签，直接报错 ────────────────────────────────

  it.each([
    ['403 其它原因（鉴权拒绝）', 'Chat failed: HTTP 403 - {"error":"forbidden"}'],
    ['500 服务错误', 'Chat failed: HTTP 500 - server boom'],
    ['流内 error part 裸文案（无 HTTP 403 前缀）', 'session not found or expired'],
    ['网络错误', 'socket hangup']
  ])('%s：不触发自愈，错误直接上屏', async (_label, errorMessage) => {
    const ai = await createAssistant()
    const first = await sendOne(ai)

    first.callbacks.onError!(errorMessage)
    first.callbacks.onFinish!()

    await vi.waitFor(() => expect(ai.isProcessing.value).toBe(false))
    expect(createSessionMock).toHaveBeenCalledTimes(1) // 仅 init，未重签
    expect(captured).toHaveLength(1) // 未重发
    expect(ai.sessionId.value).toBe('sess-1')
    expect(lastAssistant(ai).content).toBe(`错误: ${errorMessage}`)
  })

  // ─── ④ 自愈后新 sid 被后续消息使用 ────────────────────────────────────────

  it('自愈后的新 sid 被后续消息沿用', async () => {
    const ai = await createAssistant()
    const first = await sendOne(ai, '第一条')

    createSessionMock.mockResolvedValueOnce('sess-2')
    first.callbacks.onError!(SESSION_EXPIRED_403)
    first.callbacks.onFinish!()
    await vi.waitFor(() => expect(captured).toHaveLength(2))
    captured[1]!.callbacks.onTextDelta!('回复一')
    captured[1]!.callbacks.onFinish!()
    await vi.waitFor(() => expect(ai.isProcessing.value).toBe(false))

    // 第二条消息：直接用新 sid 发送，无需再重签
    await ai.sendMessage('第二条')
    expect(captured).toHaveLength(3)
    expect(captured[2]!.sessionId).toBe('sess-2')
    expect(createSessionMock).toHaveBeenCalledTimes(2)
  })

  // ─── ⑤ 重签本身失败 → 上屏报错 ────────────────────────────────────────────

  it('自愈重签失败：上屏报错并复位处理态，sid 保持原值', async () => {
    const ai = await createAssistant()
    const first = await sendOne(ai)

    createSessionMock.mockRejectedValueOnce(new Error('Create session failed: HTTP 503'))
    first.callbacks.onError!(SESSION_EXPIRED_403)
    first.callbacks.onFinish!()

    await vi.waitFor(() => expect(ai.isProcessing.value).toBe(false))
    expect(captured).toHaveLength(1) // 重签失败，未重发
    expect(ai.sessionId.value).toBe('sess-1')
    const assistant = lastAssistant(ai)
    expect(assistant.content).toContain('会话已过期且重签失败')
    expect(assistant.content).toContain('HTTP 503')
  })

  it('suspend 停止当前活动并禁止新消息，resume 重连，destroy 完整释放', async () => {
    const ai = await createAssistant()
    await sendOne(ai)
    ai.suspend()
    expect(setActiveMock).toHaveBeenCalledWith(false)
    expect(ai.isProcessing.value).toBe(false)

    await ai.sendMessage('停用期间不应发送')
    expect(captured).toHaveLength(1)

    await ai.resume()
    expect(setActiveMock).toHaveBeenCalledWith(true)
    expect(connectMock).toHaveBeenCalledWith('sess-1')

    ai.destroy()
    expect(destroyMock).toHaveBeenCalledOnce()
    expect(ai.sessionId.value).toBeNull()
    expect(ai.orchestratorStatus.value).toBe('idle')
  })
})
