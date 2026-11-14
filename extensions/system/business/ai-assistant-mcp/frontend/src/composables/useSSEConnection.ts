/**
 * 文件作用：useSSEConnection 组合式函数（命令执行终端，连 ai-orchestrator 命令路由器）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-06-27
 * 版本：2.2.0
 * 修改记录：
 *   - 2.2.0 (2026-07-26) S2-A：命令分发对齐契约工具名白名单——白名单语义为契约 45 工具名，
 *                       命令通道只带命令类型，故拦截改按 COMMAND_TYPE_TO_TOOL_NAMES 族级判定
 *                       （族内任一工具启用即放行）；分发经 isExecutorCommandType 类型收窄，
 *                       不再用 cmdType 直接撞工具名白名单。
 *   - 2.1.0 (2026-07-23) P4-C：EventSource 改 fetch 流式 SSE（开发测试环境 网关 AuthFilter 只认
 *                       Authorization: Bearer 头，EventSource 无法自定义头）；
 *                       /channel/events 与 /channel/result 统一经 api/auth.authHeaders 携带
 *                       RuoYi Admin-Token（Cookie 读取，与宿主同一约定）。
 *   - 2.0.0 (2026-07-22) P1-B：命令通道从 MCP Gateway 切到 ai-orchestrator：
 *                       端点 `${baseUrl}/channel/events?sessionId=`、result POST `${baseUrl}/channel/result`；
 *                       sessionId 由 useAIAssistant 在会话签发后注入（connect(sessionId)，不再自动连接）；
 *                       28 个命令 handler 迁至 executors/index.ts TOOL_EXECUTORS（逻辑不变），
 *                       本文件保留连接管理 + enabledTools 白名单运行时拦截 + default 回退。
 *   - 1.0.1 (2026-06-30) 优化 entity_remove 正则转义，彻底消除 ReDoS 风险
 *   - 1.0.0 (2026-06-27) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { createToolExecutorRuntime } from '../executors'
import type { CapabilityContextLike } from '../types'
import {
  resolveEnabledTools,
  isExecutorCommandType,
  COMMAND_TYPE_TO_TOOL_NAMES
} from '../executors/enabled-tools'
import { authHeaders } from '../api/auth'

/**
 * SSE 连接配置
 */
export interface SSEConfig {
  /** ai-orchestrator 基础地址，例如 /dev-api/ai/agent 或 http://localhost:9600 */
  baseUrl: string
  /** /channel/result 回传地址（缺省 = baseUrl）。
   * P4-C：18880 页面在 /chat 流式期间，浏览器对同源新建小请求存在 6~13s 排队（会突破
   * MCP 10s 命令超时），故生产环境把 result 回传切到独立源（开发测试环境 网关 NodePort 18801） */
  resultBaseUrl?: string
  /** 是否手动管理连接：true 时不自动在 onMounted 中连接，调用方自行调用 connect */
  manual?: boolean
  /** 启用工具白名单（manifest config enabledTools；缺省/空 = 全量） */
  enabledTools?: string[]
  /** 本包资源所有者上下文 */
  ctx?: CapabilityContextLike
}

/**
 * SSE 通信连接 ai-orchestrator 命令路由器，接收命令并在 Cesium Viewer 上执行
 * 覆盖 39 个浏览器契约工具名归一出的 28 个命令类型（executors/index.ts TOOL_EXECUTORS，
 * 归一规则见 enabled-tools.ts resolveCommandType / COMMAND_TYPE_TO_TOOL_NAMES）
 * @description 通过 EventSource 接收 orchestrator 下发的 command（协议与旧 MCP 通道一致：
 * `{type:'command', command:{id,type,...}}`），本地执行后经 POST /channel/result 回传 `{id,result}`。
 * @param viewerRef - Cesium Viewer 引用
 * @param config - SSE 配置
 * @returns 连接状态、错误信息，manual 模式下额外返回 connect/disconnect
 */
export function useSSEConnection(viewerRef: any, config: SSEConfig) {
  /** 是否已连接 */
  const isConnected = ref(false)
  /** 错误信息 */
  const error = ref<string | null>(null)
  /** 当前 SSE 读取的中止控制器（fetch 流式实现，见 connect） */
  let eventAbort: AbortController | null = null
  /** 重连定时器句柄 */
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Viewer 就绪检查定时器句柄 */
  let viewerCheckInterval: ReturnType<typeof setInterval> | null = null
  /** 重连次数 */
  let reconnectAttempts = 0
  /** 最大重连次数，超过后停止自动重连，避免崩溃/风暴 */
  const MAX_RECONNECT_ATTEMPTS = 10
  /** 基础重连间隔（ms） */
  const BASE_RECONNECT_DELAY = 3000
  /** 最大重连间隔（ms） */
  const MAX_RECONNECT_DELAY = 30000
  /** 当前会话 ID（connect 时注入，重连沿用） */
  let currentSessionId: string | null = null

  // 获取全局 Cesium 和 viewer 的辅助函数
  const getCesium = () => (window as any).Cesium
  const getViewer = () => viewerRef.value || (window as any).viewer

  // ========== 命令执行器（29 键 = 28 命令类型 + codegen stub，实现见 executors/index.ts） ==========
  const executorRuntime = createToolExecutorRuntime({ getViewer, getCesium, ctx: config.ctx })
  const commandExecutors = executorRuntime.executors

  /** 启用工具白名单（运行时拦截：配置禁用 → 拒绝执行并回传错误） */
  const enabledToolSet: ReadonlySet<string> = new Set(resolveEnabledTools(config.enabledTools))

  /** 通用回退（未知命令类型） */
  const defaultExecutor = async (cmd: any) => {
    console.warn('[SSE] Unhandled command:', cmd.type)
    return { success: false, error: `Command type '${cmd.type}' not implemented in frontend` }
  }

  /**
   * 处理一条 SSE data 载荷（命令分发 + 白名单拦截 + 结果回传）
   * @param base - orchestrator 基础地址
   * @param dataText - SSE data: 行文本（JSON）
   */
  const handleSseData = async (base: string, dataText: string) => {
    try {
      const data = JSON.parse(dataText)
      console.log('[SSE] Message received:', data)

      if (data.type === 'command' && data.command) {
        // 白名单运行时拦截（族级判定）：命令通道下发的 command 只带命令类型不带工具名，
        // 故按 COMMAND_TYPE_TO_TOOL_NAMES 找到契约工具名族，族内任一工具启用即放行
        // （如 entity_add 命令对应 entity_add_* 12 个工具，全部未启用才拒绝）；
        // 未知命令类型（非执行器 29 键）落到 defaultExecutor 回「未实现」
        const cmdType = data.command.type
        let result: any
        if (!isExecutorCommandType(cmdType)) {
          result = await defaultExecutor(data.command)
        } else if (!COMMAND_TYPE_TO_TOOL_NAMES[cmdType].some((toolName) => enabledToolSet.has(toolName))) {
          console.warn('[SSE] Command blocked by enabledTools whitelist:', cmdType)
          result = { success: false, error: `Tool '${cmdType}' is disabled by frontend enabledTools whitelist` }
        } else {
          result = await commandExecutors[cmdType](data.command)
        }

        // 发送结果回 orchestrator 命令路由器（resultBaseUrl 独立源规避同源排队，见 SSEConfig）
        const resultBase = (config.resultBaseUrl || base).replace(/\/$/, '')
        await fetch(`${resultBase}/channel/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ id: data.command.id, result }),
          credentials: 'include'
        })
        console.log('[SSE] Result sent for', data.command.type)
      }
    } catch (e: any) {
      console.error('[SSE] Error handling message:', e)
    }
  }

  /**
   * 建立 SSE 连接
   * @description fetch 流式实现（替代 EventSource）：开发测试环境 网关 AuthFilter 只认
   * Authorization: Bearer 头，EventSource 无法自定义请求头，故改为 fetch + reader
   * 逐帧（\n\n 分隔）解析；断线按原指数退避策略自动重连。
   * @param sessionId - 服务端签发的会话 ID（chat 与 channel 共用）；重连时沿用首次注入值
   */
  const connect = async (sessionId?: string) => {
    if (sessionId) currentSessionId = sessionId
    if (!currentSessionId) {
      console.warn('[SSE] connect skipped: no sessionId')
      return
    }
    // 先断开旧连接（重连/重复调用幂等）
    if (eventAbort) {
      eventAbort.abort()
      eventAbort = null
    }
    const base = config.baseUrl.replace(/\/$/, '')
    const url = `${base}/channel/events?sessionId=${encodeURIComponent(currentSessionId)}`
    console.log('[SSE] Connecting to', url)

    const ctrl = new AbortController()
    eventAbort = ctrl

    /** 连接失败/断线后的指数退避重连（与原 EventSource 版策略一致） */
    const scheduleReconnect = (reason: string) => {
      isConnected.value = false
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        error.value = `SSE connection failed after ${MAX_RECONNECT_ATTEMPTS} retries`
        console.warn(`[SSE] Stopped reconnecting after ${MAX_RECONNECT_ATTEMPTS} attempts`)
        return
      }
      reconnectAttempts += 1
      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY)
      error.value = `SSE connection failed (${reason}), retrying in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
      console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => { void connect() }, delay)
    }

    try {
      const resp = await fetch(url, {
        headers: { Accept: 'text/event-stream', ...authHeaders() },
        signal: ctrl.signal,
        credentials: 'include'
      })
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`)
      }
      console.log('[SSE] Connected')
      isConnected.value = true
      error.value = null
      reconnectAttempts = 0

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE 帧以空行分隔
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const rawLine of frame.split('\n')) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data) void handleSseData(base, data)
          }
        }
      }
      // 流正常结束（服务端关闭）：视为断线走重连
      if (!ctrl.signal.aborted) scheduleReconnect('stream ended')
    } catch (e: any) {
      // 主动 disconnect/重建连接时不视为错误
      if (ctrl.signal.aborted || e?.name === 'AbortError') return
      console.error('[SSE] Connection error', e)
      scheduleReconnect(e?.message || 'network error')
    }
  }

  /**
   * 断开 SSE 连接
   */
  const disconnect = () => {
    if (eventAbort) {
      eventAbort.abort()
      eventAbort = null
      isConnected.value = false
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectAttempts = 0
  }

  // 自动模式：在组件生命周期内自动连接/断开（无 sessionId 时 connect 会跳过并告警）
  // 手动模式：由调用方（如插件）控制连接时机，避免 composable 在异步 activate 中调用时 onMounted 已错过
  onMounted(() => {
    if (config.manual) return
    if (viewerRef.value) {
      connect()
    } else {
      // 等待 viewer ready
      viewerCheckInterval = setInterval(() => {
        if (viewerRef.value) {
          if (viewerCheckInterval) {
            clearInterval(viewerCheckInterval)
            viewerCheckInterval = null
          }
          connect()
        }
      }, 500)
    }
  })

  onBeforeUnmount(() => {
    if (config.manual) return
    disconnect()
    if (viewerCheckInterval) {
      clearInterval(viewerCheckInterval)
      viewerCheckInterval = null
    }
  })

  const setActive = (active: boolean) => {
    executorRuntime.setActive(active)
    if (!active) disconnect()
  }

  const destroy = () => {
    disconnect()
    if (viewerCheckInterval) {
      clearInterval(viewerCheckInterval)
      viewerCheckInterval = null
    }
    executorRuntime.destroy()
  }

  if (config.manual) {
    return { isConnected, error, connect, disconnect, setActive, destroy }
  }
  return { isConnected, error }
}
