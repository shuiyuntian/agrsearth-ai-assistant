// 文件作用：S11 AI 助手独立仓结构、版本、菜单、部署与依赖边界检查
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-14
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-14) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const pkg = path.join(root, 'extensions/system/business/ai-assistant-mcp')
const read = (relative) => fs.readFileSync(path.join(pkg, relative), 'utf8')
const json = (relative) => JSON.parse(read(relative))
const manifest = json('manifest.json')
const frontend = json('frontend/package.json')
const admin = json('admin-ui/package.json')

test('S11 包与组件版本、分类和制品声明保持真实高版本', () => {
  assert.equal(read('VERSION').trim(), '2.1.4')
  assert.equal(manifest.version, '2.1.4')
  assert.equal(manifest.track, 'system')
  assert.equal(manifest.tier, 'business')
  assert.equal('delivery' in manifest, false)
  assert.equal(manifest.components.data, true)
  assert.deepEqual(manifest.components.backend, ['ai-assistant-mcp', 'cesium-mcp'])
  assert.equal(frontend.version, '2.1.4')
  assert.equal(admin.version, '2.1.4')
  assert.equal(read('container/cesium-mcp/VERSION').trim(), '2.1.4')
  const cesium = manifest.backendServices.find((row) => row.serviceId === 'cesium-mcp')
  assert.equal(cesium.imageSource, 'self')
  assert.match(cesium.image, /:2\.1\.4$/)
  assert.equal('upstreamImage' in cesium, false)
  assert.equal(manifest.dependsOnPackages[0].packageId, 'geolocation-services')
  assert.equal(manifest.dependsOnPackages[0].minVersion, '1.0.0')
})

test('S11 菜单 ID、层级、权限、角色和 remote 契约不变', () => {
  const menu = json('data/menu.json')
  assert.deepEqual(menu.menus.map((row) => row.menuId), [3000000, 3000001, 3000002])
  assert.deepEqual(menu.menus.map((row) => row.parentId), [0, 3000000, 3000000])
  assert.deepEqual(menu.menus.map((row) => row.perms), ['', 'aiassistant:config:list', 'aiassistant:stats:list'])
  assert.deepEqual(menu.menus.map((row) => row.roleIds), [[1, 106], [1, 106], [1, 106]])
  assert.equal(menu.menus[1].component, 'remote:ai-assistant-mcp/config')
  assert.equal(menu.menus[2].component, 'remote:ai-assistant-mcp/dashboard')
  assert.match(read('admin-ui/src/index.ts'), /version: '2\.1\.4'/)
})

test('S11 frontend/admin-ui 只使用共享构建与类型契约', () => {
  const frontendVite = read('frontend/vite.config.ts')
  assert.match(frontendVite, /@agrsearth\/vite-config/)
  assert.match(frontendVite, /packageId: 'ai-assistant-mcp'/)
  assert.match(frontendVite, /cssFileName: 'tool\.css'/)
  assert.match(frontend.dependencies['@agrsearth/sdk-types'], /\*/)
  assert.equal(frontend.devDependencies['@agrsearth/vite-config'], '*')
  assert.match(read('frontend/src/types.ts'), /@agrsearth\/sdk-types/)
  assert.match(read('admin-ui/vite.config.ts'), /@agrsearth\/vite-config\/admin/)
  assert.match(read('admin-ui/vite.config.ts'), /@agrsearth\/admin-sdk/)
  assert.equal(admin.dependencies['@agrsearth/admin-sdk'], '*')
  for (const relative of ['frontend/vite.config.ts', 'admin-ui/vite.config.ts', 'frontend/src/types.ts']) {
    assert.doesNotMatch(read(relative), /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages/)
  }
  assert.doesNotMatch(read('frontend/src/executors/index.ts'), /viewer\.entities\.add/)
  assert.doesNotMatch(read('admin-ui/src/index.ts'), /createApp|import\.meta\.env/)
})

test('S11 k8s bundle 保留真实工作负载、端口、探针、资源与 TZ', () => {
  const cesium = read('deploy/k8s/10-cesium-mcp.yaml')
  const ai = read('deploy/k8s/20-ai-assistant-mcp.yaml')
  for (const text of [cesium, ai]) {
    assert.doesNotMatch(text, /^  namespace:/m)
    assert.match(text, /value: Asia\/Shanghai/)
    assert.match(text, /type: ClusterIP/)
    assert.match(text, /resources:/)
    assert.match(text, /readinessProbe:/)
    assert.match(text, /livenessProbe:/)
    assert.doesNotMatch(text, /:latest/)
  }
  assert.match(cesium, /type: Recreate/)
  assert.match(cesium, /cesium-mcp:2\.1\.4/)
  assert.match(ai, /ai-assistant-mcp:2\.1\.4/)
  for (const port of [3008, 3010, 4010]) assert.match(cesium, new RegExp(`port: ${port}`))
  assert.match(ai, /port: 9600/)
  assert.match(cesium, /http:\/\/nominatim:8080/)
  assert.match(cesium, /http:\/\/osrm:5000/)
  assert.match(cesium, /http:\/\/overpass\/api\/interpreter/)
})

test('S11 vendor pin、公开默认值与生产上下文边界', () => {
  assert.match(read('vendor/cesium-mcp/.upstream'), /2606b49646c216f5670ede368ac678a7c880bb75/)
  assert.match(read('backend/ai-orchestrator/src/config.ts'), /https:\/\/llm\.example\.invalid\/v1/)
  assert.match(read('container/cesium-mcp/Dockerfile'), /NOMINATIM_SERVER_URL=http:\/\/nominatim:8080/)
  assert.match(read('container/ai-assistant-mcp/Dockerfile.dockerignore'), /\*\*\/node_modules\//)
  assert.match(read('container/ai-assistant-mcp/Dockerfile.dockerignore'), /backend\/ai-orchestrator\/scripts\//)
  assert.doesNotMatch(read('backend/ai-orchestrator/src/index.ts'), /platform\/frontend/)
})

test('S11 自研文件不带内网地址或平台相对源码依赖', () => {
  const roots = ['frontend', 'admin-ui', 'backend', 'container', 'contracts', 'data', 'deploy', 'tools']
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build'].includes(entry.name)) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  for (const relative of roots) walk(path.join(pkg, relative))
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /192\.168\.1\.|10\.88\.88\.|\/Users\/rsom/, path.relative(pkg, file))
    assert.doesNotMatch(text, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages/, path.relative(pkg, file))
  }
})
