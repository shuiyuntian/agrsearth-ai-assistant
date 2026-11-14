// 文件作用：S11 真实 OpenAI 兼容模型、聊天、只读工具与 codegen 审批链验收
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-15
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-15) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '../..')
const pkg = path.join(root, 'extensions/system/business/ai-assistant-mcp')
const output = process.env.S11_EVIDENCE_DIR
const llmBaseUrl = process.env.S11_LLM_BASE_URL?.replace(/\/$/, '')
const llmModel = process.env.S11_LLM_MODEL
if (!output || !llmBaseUrl || !llmModel) {
  throw new Error('必须设置 S11_EVIDENCE_DIR、S11_LLM_BASE_URL、S11_LLM_MODEL')
}
const parsedBaseUrl = new URL(llmBaseUrl)
assert.equal(parsedBaseUrl.username, '')
assert.equal(parsedBaseUrl.password, '')
fs.mkdirSync(output, { recursive: true })
const ports = { orchestrator: 19610, geo: 13018, sse: 13020, gateway: 14020 }
const results = []
const children = []
let chatIndex = 0
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n')
const record = (name, details) => {
  results.push({ name, status: 'PASS', ...details })
  write('llm-results.json', results)
  console.log(`PASS ${name}`)
}

function start(name, command, args, cwd, env) {
  const log = fs.createWriteStream(path.join(output, `${name}.log`), { flags: 'a' })
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  children.push({ name, child })
}

async function stopChildren() {
  for (const { child } of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode) continue
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* 已退出 */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

async function waitHealth(url, timeoutMs = 90_000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (response.ok) return response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw lastError || new Error(`健康检查超时：${url}`)
}

async function postChat(sessionId, prompt, autoApproveCodegen = false) {
  const response = await fetch(`http://127.0.0.1:${ports.orchestrator}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(600_000)
  })
  if (response.status !== 200) throw new Error(await response.text())
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const event = JSON.parse(payload)
      events.push(event)
      if (event.type === 'data-tool-approval') {
        assert.equal(autoApproveCodegen, true, `出现未预期审批：${event.data?.tool}`)
        assert.equal(event.data?.tool, 'cesium_execute_code')
        const approval = await fetch(`http://127.0.0.1:${ports.orchestrator}/chat/approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, callId: event.data.callId, approved: true })
        })
        if (approval.status !== 200) throw new Error(await approval.text())
      }
    }
    if (done) break
  }
  chatIndex += 1
  write(`chat-${chatIndex}-events.json`, events)
  const errors = events.filter((event) => event.type === 'error' || event.type.endsWith('-error'))
  assert.deepEqual(errors, [])
  return {
    text: events.filter((event) => event.type === 'text-delta').map((event) => event.delta).join(''),
    toolInputs: events.filter((event) => event.type === 'tool-input-available'),
    toolOutputs: events.filter((event) => event.type === 'tool-output-available'),
    approvals: events.filter((event) => event.type === 'data-tool-approval'),
    eventTypes: events.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] || 0) + 1 }), {})
  }
}

try {
  const modelsResponse = await fetch(`${llmBaseUrl}/models`, { signal: AbortSignal.timeout(20_000) })
  assert.equal(modelsResponse.status, 200)
  const models = await modelsResponse.json()
  const selected = models.data?.find((model) => model.id === llmModel)
  assert.ok(selected, `模型目录不存在 ${llmModel}`)
  record('model-catalog', { requestedModel: llmModel, maxModelLen: selected.max_model_len })

  const directResponse = await fetch(`${llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llmModel,
      messages: [{ role: 'user', content: '这是一次 AGRSEarth S11 连通性验收。只回复：S11_QWEN_OK' }],
      temperature: 0,
      max_tokens: 256,
      stream: false
    }),
    signal: AbortSignal.timeout(180_000)
  })
  if (directResponse.status !== 200) throw new Error(await directResponse.text())
  const direct = await directResponse.json()
  const directText = direct.choices?.[0]?.message?.content || ''
  assert.ok(directText.includes('S11_QWEN_OK'), directText)
  record('direct-chat-completion', {
    requestId: direct.id,
    requestedModel: llmModel,
    servedModel: direct.model,
    finishReason: direct.choices?.[0]?.finish_reason,
    usage: direct.usage
  })

  const baseEnv = {
    LLM_BASE_URL: llmBaseUrl,
    LLM_MODEL: llmModel,
    ENABLED_TOOLS: 'geolocation_geocode,cesium_execute_code',
    OSM_USER_AGENT: 'AGRSEarth-S11-LLM-Verification/1.0',
    no_proxy: '127.0.0.1,localhost'
  }
  start('gateway', 'pnpm', ['--filter', '@cesium-mcp/gateway', 'start'], path.join(pkg, 'vendor/cesium-mcp/cesium-js'), {
    ...baseEnv,
    PORT: String(ports.sse),
    COMMUNICATION_PROTOCOL: 'sse',
    MCP_TRANSPORT: 'streamable-http'
  })
  start('geolocation-http', 'node', ['backend/geolocation-http/server.mjs'], pkg, {
    ...baseEnv,
    PORT: String(ports.geo),
    NOMINATIM_SERVER_URL: process.env.GEOLOCATION_NOMINATIM_URL || 'http://127.0.0.1:18860',
    OSRM_SERVER_URL: process.env.GEOLOCATION_OSRM_URL || 'http://127.0.0.1:18861',
    OVERPASS_SERVER_URL: process.env.GEOLOCATION_OVERPASS_URL || 'http://127.0.0.1:18862/api/interpreter'
  })
  start('orchestrator', 'node', ['build/src/index.js'], path.join(pkg, 'backend/ai-orchestrator'), {
    ...baseEnv,
    PORT: String(ports.orchestrator),
    AUTH_ENABLED: 'false',
    MYSQL_URL: '',
    REDIS_URL: 'redis://127.0.0.1:1',
    MCP_HTTP_URL: `http://127.0.0.1:${ports.gateway}/mcp`,
    GEO_MCP_URL: `http://127.0.0.1:${ports.geo}/mcp`,
    MCP_SSE_URL: `http://127.0.0.1:${ports.sse}/mcp/events`,
    MCP_RESULT_URL: `http://127.0.0.1:${ports.sse}/mcp/result`,
    TOOL_CONTRACTS_PATH: path.join(pkg, 'contracts/tool-contracts.json'),
    CODEGEN_SKILLS_DIR: path.join(root, '.kimi-code/skills'),
    CODEGEN_MAX_ATTEMPTS: '3',
    AGENT_MAX_STEPS: '6'
  })

  const health = await waitHealth(`http://127.0.0.1:${ports.orchestrator}/health`)
  assert.equal(health.status, 'ok')
  assert.equal(health.tools, 1)
  assert.equal(health.store, 'memory')
  assert.equal(health.mcp.gateway.state, 'up')
  assert.equal(health.mcp.geolocation.state, 'up')
  record('orchestrator-read-only-toolset', { tools: health.tools, store: health.store, mcp: health.mcp })

  const sessionResponse = await fetch(`http://127.0.0.1:${ports.orchestrator}/chat/session`, { method: 'POST' })
  assert.equal(sessionResponse.status, 200)
  const { sessionId } = await sessionResponse.json()
  assert.ok(sessionId)

  const initialConfigResponse = await fetch(`http://127.0.0.1:${ports.orchestrator}/admin/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temperature: 0, maxTokens: 2048 })
  })
  if (initialConfigResponse.status !== 200) throw new Error(await initialConfigResponse.text())

  const basic = await postChat(sessionId, '不要调用任何工具，不要解释，直接输出：S11_ORCHESTRATOR_OK')
  assert.ok(basic.text.includes('S11_ORCHESTRATOR_OK'), basic.text)
  assert.equal(basic.toolInputs.length, 0)
  record('orchestrator-real-chat', { eventTypes: basic.eventTypes, responseMatched: true, toolCalls: 0 })

  const geo = await postChat(sessionId, '请调用 geolocation_geocode 工具查询北京故宫博物院。禁止调用其他工具。完成后用中文简要给出坐标。')
  assert.equal(geo.toolInputs.length, 1)
  assert.equal(geo.toolInputs[0].toolName, 'geolocation_geocode')
  assert.equal(geo.toolOutputs.length, 1)
  const geoOutput = JSON.stringify(geo.toolOutputs[0].output)
  assert.ok(geoOutput.includes('latitude') && geoOutput.includes('longitude'), geoOutput.slice(0, 1000))
  assert.ok(!geoOutput.includes('"isError":true'), geoOutput.slice(0, 1000))
  assert.ok(geo.text.length > 0)
  record('llm-read-only-geocode-tool', {
    toolName: geo.toolInputs[0].toolName,
    arguments: geo.toolInputs[0].input,
    resultContainsCoordinates: true,
    responseChars: geo.text.length
  })

  const configResponse = await fetch(`http://127.0.0.1:${ports.orchestrator}/admin/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codegenEnabled: true, temperature: 0, maxTokens: 4096 })
  })
  if (configResponse.status !== 200) throw new Error(await configResponse.text())
  const config = await configResponse.json()
  assert.equal(config.data.codegenEnabled, true)
  record('local-codegen-enabled', { mysqlPersisted: false, codegenEnabled: true })

  const codegen = await postChat(
    sessionId,
    '请调用 cesium_execute_code，为“用 Cesium.Entity 在北京位置添加一个红色圆形点实体”生成代码。不要调用其他工具。生成后等待审批。',
    true
  )
  assert.equal(codegen.approvals.length, 1)
  const code = codegen.approvals[0].data?.args?.code
  assert.ok(typeof code === 'string' && code.includes('Cesium'))
  assert.equal(codegen.toolInputs[0]?.toolName, 'cesium_execute_code')
  const codegenOutput = JSON.stringify(codegen.toolOutputs[0]?.output)
  assert.ok(codegenOutput.includes('"verified":true'), codegenOutput.slice(0, 1000))
  assert.ok(codegenOutput.includes('"approvedForExecution":true'), codegenOutput.slice(0, 1000))
  const { verifyCode } = await import(pathToFileURL(path.join(pkg, 'backend/ai-orchestrator/build/src/codegen/ast-verifier.js')).href)
  assert.equal(verifyCode(code).ok, true)
  write('generated-code.json', { code, independentlyVerified: true, executed: false })
  record('llm-codegen-ast-approval', {
    toolName: codegen.toolInputs[0].toolName,
    approvalGranted: true,
    astVerified: true,
    codeChars: code.length,
    executed: false
  })

  write('summary.json', {
    status: 'PASS',
    checks: results.length,
    requestedModel: llmModel,
    scope: '真实模型目录与推理、orchestrator 聊天、geocode 只读工具、codegen 生成/AST/审批；未执行生成代码，未写远程数据库/Redis/菜单/工作负载'
  })
  console.log(`PASS：${results.length} 项真实 LLM 链路检查`)
} finally {
  await stopChildren()
}
