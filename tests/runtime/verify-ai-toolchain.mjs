// 文件作用：S11 真实 orchestrator、MCP 工具目录、会话与四地理工具只读验证
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-14
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-14) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '../..')
const pkg = path.join(root, 'extensions/system/business/ai-assistant-mcp')
const output = process.env.S11_EVIDENCE_DIR
if (!output) throw new Error('必须设置 S11_EVIDENCE_DIR')
fs.mkdirSync(output, { recursive: true })
const ports = { orchestrator: 19600, geo: 13008, sse: 13010, gateway: 14010 }
const geoUrls = {
  nominatim: (process.env.GEOLOCATION_NOMINATIM_URL || 'http://127.0.0.1:18860').replace(/\/$/, ''),
  osrm: (process.env.GEOLOCATION_OSRM_URL || 'http://127.0.0.1:18861').replace(/\/$/, ''),
  overpass: (process.env.GEOLOCATION_OVERPASS_URL || 'http://127.0.0.1:18862/api/interpreter').replace(/\/$/, '')
}
const results = []
const children = []
const record = (name, details) => {
  results.push({ name, status: 'PASS', ...details })
  fs.writeFileSync(path.join(output, 'toolchain-results.json'), JSON.stringify(results, null, 2) + '\n')
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
  return child
}

async function waitHealth(url, timeoutMs = 90_000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
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

async function stopChildren() {
  for (const { child } of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode) continue
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* 已退出 */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500))
}
process.on('uncaughtException', async (error) => {
  console.error(error)
  await stopChildren()
  process.exit(1)
})

const baseEnv = {
  LLM_BASE_URL: 'https://llm.example.invalid/v1',
  LLM_MODEL: 'external-model',
  OSM_USER_AGENT: 'AGRSEarth-S11-Verification/1.0',
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
  NOMINATIM_SERVER_URL: geoUrls.nominatim,
  OSRM_SERVER_URL: geoUrls.osrm,
  OVERPASS_SERVER_URL: geoUrls.overpass
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
  CODEGEN_SKILLS_DIR: path.join(root, '.kimi-code/skills')
})

try {
  const health = await waitHealth(`http://127.0.0.1:${ports.orchestrator}/health`)
  assert.equal(health.status, 'ok')
  assert.equal(health.transport, 'http')
  assert.equal(health.tools, 45)
  assert.equal(health.store, 'memory')
  assert.equal(health.mysql, 'down')
  assert.equal(health.mcp.gateway.state, 'up')
  assert.equal(health.mcp.geolocation.state, 'up')
  record('orchestrator-health-fields', { health })

  const geoHealth = await waitHealth(`http://127.0.0.1:${ports.geo}/health`)
  assert.equal(geoHealth.status, 'ok')
  assert.equal(geoHealth.transport, 'streamable-http')
  record('geolocation-bridge-health', { health: geoHealth })

  const sessionResponse = await fetch(`http://127.0.0.1:${ports.orchestrator}/chat/session`, { method: 'POST' })
  assert.equal(sessionResponse.status, 200)
  const session = await sessionResponse.json()
  assert.equal(typeof session.sessionId, 'string')
  assert.ok(session.sessionId.length > 10)
  record('local-memory-session', { issued: true, sessionIdRecorded: false })
  const afterSession = await (await fetch(`http://127.0.0.1:${ports.orchestrator}/health`)).json()
  assert.ok(afterSession.sessions.active >= 1)
  record('session-active-count', { active: afterSession.sessions.active })

  const invalidChat = await fetch(`http://127.0.0.1:${ports.orchestrator}/chat/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  })
  assert.equal(invalidChat.status, 400)
  const invalidBody = await invalidChat.json()
  assert.equal(invalidBody.error, 'invalid chat envelope')
  record('invalid-chat-envelope', { status: invalidChat.status, error: invalidBody.error, llmCalled: false })

  const unknownApproval = await fetch(`http://127.0.0.1:${ports.orchestrator}/chat/approval`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId, callId: 'not-present', approved: true })
  })
  assert.equal(unknownApproval.status, 404)
  record('unknown-approval-error', { status: unknownApproval.status, body: await unknownApproval.json() })

  const require = createRequire(path.join(pkg, 'vendor/cesium-mcp/geolocation-server/package.json'))
  const esm = (subpath) => require.resolve(subpath).replace(`${path.sep}dist${path.sep}cjs${path.sep}`, `${path.sep}dist${path.sep}esm${path.sep}`)
  const { Client } = await import(pathToFileURL(esm('@modelcontextprotocol/sdk/client/index.js')).href)
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(esm('@modelcontextprotocol/sdk/client/streamableHttp.js')).href)
  const client = new Client({ name: 's11-runtime-verifier', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ports.geo}/mcp`)))
  try {
    const catalog = await client.listTools()
    const names = catalog.tools.map((tool) => tool.name).sort()
    assert.deepEqual(names, ['geolocation_extent', 'geolocation_geocode', 'geolocation_route', 'geolocation_search'])
    record('geo-tool-catalog', { count: names.length, names })

    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args })
      assert.equal(response.isError, false, `${name}: ${JSON.stringify(response).slice(0, 500)}`)
      return response.structuredContent
    }
    const geocode = await call('geolocation_geocode', { address: '北京故宫博物院' })
    assert.equal(geocode.success, true)
    assert.ok(Number.isFinite(geocode.location.latitude) && Number.isFinite(geocode.location.longitude))
    assert.ok(geocode.displayName && geocode.boundingBox.northeast && geocode.boundingBox.southwest)
    record('geolocation_geocode', { location: geocode.location, displayName: geocode.displayName, boundingBox: geocode.boundingBox })

    const route = await call('geolocation_route', {
      origin: { latitude: 39.9163, longitude: 116.3972 },
      destination: { latitude: 39.9042, longitude: 116.4074 },
      travelMode: 'driving', alternatives: false
    })
    assert.equal(route.success, true)
    assert.ok(route.routes.length > 0)
    const best = route.routes[0]
    assert.ok(best.distance > 0 && best.duration > 0 && best.polyline.length > 0)
    assert.ok(best.bounds.northeast && best.bounds.southwest && best.legs.length > 0)
    record('geolocation_route', { distance: best.distance, duration: best.duration, polylineLength: best.polyline.length, legs: best.legs.length, bounds: best.bounds })

    const search = await call('geolocation_search', {
      query: 'restaurant',
      location: { latitude: 39.9163, longitude: 116.3972 },
      radius: 1000
    })
    assert.equal(search.success, true)
    assert.ok(search.places.length > 0)
    assert.ok(search.places[0].name && Number.isFinite(search.places[0].location.latitude))
    record('geolocation_search', { count: search.places.length, first: search.places[0] })

    const extent = await call('geolocation_extent', {
      name: '故宫博物院',
      at: { latitude: 39.9163, longitude: 116.3972 },
      radiusKm: 2
    })
    assert.equal(extent.found, true)
    assert.equal(extent.osmType, 'relation')
    assert.equal(extent.osmId, 9511883)
    assert.ok(extent.extent.diagonalMeters > 0 && extent.tags && extent.extent.northeast && extent.extent.southwest)
    record('geolocation_extent', { osmType: extent.osmType, osmId: extent.osmId, extent: extent.extent, tags: extent.tags })

    const invalidRoute = await client.callTool({
      name: 'geolocation_route',
      arguments: {
        origin: { latitude: 39.9163, longitude: 116.3972 },
        destination: { latitude: 39.9042, longitude: 116.4074 },
        travelMode: 'not-a-mode', alternatives: false
      }
    })
    assert.equal(invalidRoute.isError, true)
    record('invalid-route-error', { isError: invalidRoute.isError, content: invalidRoute.content })
  } finally {
    await client.close()
  }

  const summary = {
    status: 'PASS', checks: results.length,
    scope: '真实新仓三进程、工具目录、内存会话、错误响应与四地理工具；未调用 /chat/ 推理或外部 LLM，未写远程数据库/Redis/菜单/工作负载'
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(`PASS：${results.length} 项真实工具链检查；未调用外部 LLM`)
  if (process.env.S11_KEEP_RUNNING === '1') {
    console.log(`S11_TOOLCHAIN_READY orchestrator=http://127.0.0.1:${ports.orchestrator}`)
    await new Promise((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
  }
} finally {
  await stopChildren()
}
