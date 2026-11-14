// 文件作用：公开仓 pre-push 的 AI Secret 资源名精确白名单行为测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-15
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-15) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const hook = path.join(root, '.githooks/pre-push')
const environmentName = ['dgx', '01'].join('')
const secretName = `${environmentName}-secrets`
const allowedRelative = 'extensions/system/business/ai-assistant-mcp/deploy/k8s/20-ai-assistant-mcp.yaml'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's11-pre-push-'))
  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  fs.mkdirSync(path.join(directory, '.githooks'), { recursive: true })
  fs.copyFileSync(hook, path.join(directory, '.githooks/pre-push'))
  const allowed = path.join(directory, allowedRelative)
  fs.mkdirSync(path.dirname(allowed), { recursive: true })
  fs.writeFileSync(allowed, `env:\n  - name: LLM_API_KEY\n    valueFrom:\n      secretKeyRef:\n        name: ${secretName}\n        key: llm-api-key\n`)
  return {
    directory,
    allowed,
    run: () => spawnSync('bash', ['.githooks/pre-push'], { cwd: directory, encoding: 'utf8' })
  }
}

test('仅指定 YAML 的 Secret 资源名精确行获得放行', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.directory, { recursive: true, force: true }))
  const result = f.run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('相似资源名仍被拒绝', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.directory, { recursive: true, force: true }))
  fs.appendFileSync(f.allowed, `        name: ${secretName}-extra\n`)
  const result = f.run()
  assert.equal(result.status, 1)
  assert.ok(result.stdout.includes(allowedRelative))
})

test('同一环境名的其他引用仍被拒绝', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.directory, { recursive: true, force: true }))
  fs.appendFileSync(f.allowed, `        name: ${environmentName}\n`)
  const result = f.run()
  assert.equal(result.status, 1)
})

test('其他文件中的同名 Secret 引用仍被拒绝', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(f.directory, 'other.yaml'), `name: ${secretName}\n`)
  const result = f.run()
  assert.equal(result.status, 1)
  assert.ok(result.stdout.includes('other.yaml'))
})
