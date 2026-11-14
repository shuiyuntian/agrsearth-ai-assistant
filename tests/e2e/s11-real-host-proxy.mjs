// 文件作用：S11 真实双宿主与本包远程产物、本地真实 AI 工具链代理
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-14
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-14) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const mode = process.env.S11_PROXY_MODE
if (!['admin', 'gis'].includes(mode)) throw new Error('S11_PROXY_MODE 必须为 admin 或 gis')
const upstreamValue = mode === 'admin' ? process.env.AGRSEARTH_REAL_ADMIN_HOST : process.env.AGRSEARTH_REAL_GIS_HOST
const root = process.env.AGRSEARTH_AI_ASSISTANT_ROOT
if (!upstreamValue || !root) throw new Error('必须设置真实宿主地址与 AGRSEARTH_AI_ASSISTANT_ROOT')
const upstream = new URL(upstreamValue)
const pkg = path.join(root, 'extensions/system/business/ai-assistant-mcp')
const port = Number(mode === 'admin' ? process.env.S11_ADMIN_PROXY_PORT || 5361 : process.env.S11_GIS_PROXY_PORT || 5362)
const prefix = '/s11-ai-assistant'

function serveArtifact(request, response) {
  const match = request.url?.match(/^\/s11-ai-assistant\/(frontend|admin)\/([^/]+)$/)
  if (!match) return false
  const allowed = new Set(['tool.es.js', 'tool.umd.js', 'tool.css', 'admin.es.js', 'admin.umd.js', 'ai-assistant-mcp-admin.css'])
  if (!allowed.has(match[2])) {
    response.writeHead(404).end('not found')
    return true
  }
  const file = path.join(pkg, match[1] === 'frontend' ? 'frontend/dist' : 'admin-ui/dist', match[2])
  if (!fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return true
  }
  response.writeHead(200, {
    'Content-Type': match[2].endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'
  })
  fs.createReadStream(file).pipe(response)
  return true
}

function rewritePackageList(body, clientResponse) {
  try {
    const doc = JSON.parse(body.toString('utf8'))
    const rows = Array.isArray(doc.data) ? doc.data : doc.data?.rows || []
    const item = rows.find((entry) => entry.packageId === 'ai-assistant-mcp')
    if (!item) throw new Error('真实清单缺 ai-assistant-mcp')
    const base = `http://127.0.0.1:${port}${prefix}`
    item.entries ??= {}
    item.entries.esm = { type: 'module', url: `${base}/frontend/tool.es.js` }
    item.entries.umd = { type: 'script', url: `${base}/frontend/tool.umd.js` }
    item.entries.css = { type: 'css', url: `${base}/frontend/tool.css` }
    item.entries.adminUi = {
      esm: { type: 'module', url: `${base}/admin/admin.es.js` },
      umd: { type: 'script', url: `${base}/admin/admin.umd.js` },
      css: { type: 'css', url: `${base}/admin/ai-assistant-mcp-admin.css` }
    }
    item.adminUi = item.entries.adminUi
    if (item.defaultConfig) item.defaultConfig.channelResultBaseUrl = `${mode === 'admin' ? 'http://127.0.0.1:5362' : `http://127.0.0.1:${port}`}/dev-api/ai/agent`
    if (item.manifest?.defaultConfig) item.manifest.defaultConfig.channelResultBaseUrl = `${mode === 'admin' ? 'http://127.0.0.1:5362' : `http://127.0.0.1:${port}`}/dev-api/ai/agent`
    return Buffer.from(JSON.stringify(doc))
  } catch (error) {
    clientResponse.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    clientResponse.end(`S11 清单改写失败：${String(error)}`)
    return null
  }
}

function localAiPath(url) {
  if (url.startsWith('/dev-api/ai/agent/')) return url.slice('/dev-api/ai/agent'.length)
  if (url.startsWith('/ai/agent/')) return url.slice('/ai/agent'.length)
  return url
}

function proxy(request, clientResponse) {
  const isAdminApi = request.url?.startsWith('/dev-api/ai/agent/admin') || request.url?.startsWith('/ai/agent/admin')
  const isLocalAi = !isAdminApi && (request.url?.startsWith('/dev-api/ai/agent/') || request.url?.startsWith('/ai/agent/'))
  const target = isLocalAi ? new URL(`http://127.0.0.1:19600${localAiPath(request.url)}`) : new URL(request.url, upstream)
  const headers = { ...request.headers, host: isLocalAi ? target.host : upstream.host, 'accept-encoding': 'identity' }
  const driver = target.protocol === 'https:' ? https : http
  const upstreamRequest = driver.request({ hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: request.method, headers }, upstreamResponse => {
    const chunks = []
    upstreamResponse.on('data', chunk => chunks.push(chunk))
    upstreamResponse.on('end', () => {
      let body = Buffer.concat(chunks)
      if (request.url?.includes('/resource-manager/api/v1/package/list')) {
        const rewritten = rewritePackageList(body, clientResponse)
        if (!rewritten) return
        body = rewritten
      }
      const responseHeaders = { ...upstreamResponse.headers }
      delete responseHeaders['content-length']
      delete responseHeaders['content-encoding']
      delete responseHeaders['transfer-encoding']
      delete responseHeaders.connection
      clientResponse.writeHead(upstreamResponse.statusCode || 502, responseHeaders)
      clientResponse.end(body)
    })
  })
  upstreamRequest.on('error', error => {
    clientResponse.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    clientResponse.end(String(error))
  })
  request.pipe(upstreamRequest)
}

const server = http.createServer((request, clientResponse) => {
  if (request.url === '/health') {
    clientResponse.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok')
    return
  }
  if (request.url === '/s11-auth' && process.env.S11_AUTH_TOKEN) {
    clientResponse.writeHead(302, {
      'Set-Cookie': `Admin-Token=${process.env.S11_AUTH_TOKEN}; Path=/; SameSite=Lax`,
      Location: mode === 'admin' ? '/aiassistant/config' : '/'
    }).end()
    return
  }
  if (request.url?.startsWith(`${prefix}/src/`)) {
    clientResponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('source not exposed')
    return
  }
  if (serveArtifact(request, clientResponse)) return
  proxy(request, clientResponse)
})
server.listen(port, '127.0.0.1', () => console.log(`S11 ${mode} 代理：http://127.0.0.1:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.closeAllConnections()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
})
