// 文件作用：S11 真实 gis-platform-ui 悬浮入口、生命周期与资源隔离浏览器验收
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-14
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-14) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const output = process.env.S11_BROWSER_EVIDENCE_DIR
if (!output) throw new Error('必须设置 S11_BROWSER_EVIDENCE_DIR')
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.stack || String(error)))
const results = []
const record = (name, details) => {
  results.push({ name, status: 'PASS', ...details })
  fs.writeFileSync(path.join(output, 'lifecycle-results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(`PASS ${name}`)
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }

try {
  await page.goto('http://127.0.0.1:5362/s11-auth', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.capabilityHost?.getManifest('ai-assistant-mcp') && document.querySelector('.ai-float-btn'), { timeout: 60_000 })
  await page.locator('.ai-float-btn').click()
  await page.locator('.ai-panel').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('text=已连接').first().waitFor({ state: 'visible', timeout: 30_000 })
  record('floating-open-connected', { connected: true, llmCalled: false })
  await page.screenshot({ path: path.join(output, 'open-connected.png'), fullPage: true })

  const foreignId = await page.evaluate(() => {
    const host = window.capabilityHost
    const plugin = host.plugins.get('ai-assistant-mcp')
    const viewer = plugin.ctx.viewer
    const foreign = viewer.entities.add({ id: 's11-foreign-owner', name: '其他包私有对象' })
    plugin.ctx.entities.add({ id: 's11-ai-owned', name: 'AI 本包对象', point: { pixelSize: 1 } })
    return foreign.id
  })
  assert(foreignId === 's11-foreign-owner', '预置其他 owner 实体失败')

  const deactivated = await page.evaluate(async () => {
    const host = window.capabilityHost
    const ok = await host.deactivate('ai-assistant-mcp')
    const plugin = host.plugins.get('ai-assistant-mcp')
    const assistant = host.panelManager.panels.get('ai-assistant-mcp-panel')?.opts.props.assistant
    return {
      ok,
      state: plugin.state,
      buttonDisplay: getComputedStyle(document.querySelector('.ai-float-btn')).display,
      dataSourceShow: plugin.ctx.entityDataSource?.show,
      channelStatus: assistant?.channelStatus.value,
      processing: assistant?.isProcessing.value
    }
  })
  assert(deactivated.ok && deactivated.state === 'inactive', 'deactivate 未进入 inactive')
  assert(deactivated.buttonDisplay === 'none', 'deactivate 后悬浮按钮仍可见')
  assert(deactivated.dataSourceShow === false, 'deactivate 后本包实体组未隐藏')
  assert(deactivated.channelStatus === 'disconnected', 'deactivate 后 SSE 未断开')
  assert(deactivated.processing === false, 'deactivate 后仍有处理中状态')
  record('deactivate-hides-ui-and-stops-activity', deactivated)
  await page.screenshot({ path: path.join(output, 'deactivated.png'), fullPage: true })

  const reactivated = await page.evaluate(async () => {
    const host = window.capabilityHost
    const ok = await host.activate('ai-assistant-mcp')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const plugin = host.plugins.get('ai-assistant-mcp')
    const assistant = host.panelManager.panels.get('ai-assistant-mcp-panel')?.opts.props.assistant
    return {
      ok,
      state: plugin.state,
      buttonDisplay: getComputedStyle(document.querySelector('.ai-float-btn')).display,
      dataSourceShow: plugin.ctx.entityDataSource?.show,
      orchestratorStatus: assistant?.orchestratorStatus.value,
      foreignPresent: !!plugin.ctx.viewer.entities.getById('s11-foreign-owner')
    }
  })
  assert(reactivated.ok && reactivated.state === 'active', 'reactivate 未进入 active')
  assert(reactivated.buttonDisplay !== 'none', 'reactivate 后悬浮按钮未恢复')
  assert(reactivated.dataSourceShow === true, 'reactivate 后本包实体组未恢复')
  assert(reactivated.orchestratorStatus === 'connected', 'reactivate 后 orchestrator 未重连')
  assert(reactivated.foreignPresent, 'reactivate 误删其他 owner 实体')
  record('reactivate-restores-ui-session-and-ownership', reactivated)
  await page.screenshot({ path: path.join(output, 'reactivated.png'), fullPage: true })

  const destroyed = await page.evaluate(async () => {
    const host = window.capabilityHost
    const ok = await host.destroy('ai-assistant-mcp')
    const foreignPresent = !!host.viewer.entities.getById('s11-foreign-owner')
    return {
      ok,
      pluginPresent: host.plugins.has('ai-assistant-mcp'),
      buttonCount: document.querySelectorAll('.ai-float-btn').length,
      panelCount: document.querySelectorAll('#ai-assistant-mcp-panel').length,
      cssCount: document.querySelectorAll('link[data-cap-package="ai-assistant-mcp"]').length,
      dataSourceCount: host.viewer.dataSources.length,
      foreignPresent
    }
  })
  assert(destroyed.ok && !destroyed.pluginPresent, 'destroy 后插件实例仍存在')
  assert(destroyed.buttonCount === 0 && destroyed.panelCount === 0, 'destroy 后悬浮 UI 残留')
  assert(destroyed.cssCount === 0, 'destroy 后本包 CSS link 残留')
  assert(destroyed.foreignPresent, 'destroy 误删其他 owner 实体')
  record('destroy-cleans-ui-css-and-preserves-foreign', destroyed)

  const recreated = await page.evaluate(async () => {
    const host = window.capabilityHost
    const ok = await host.activate('ai-assistant-mcp')
    await new Promise((resolve) => setTimeout(resolve, 500))
    return {
      ok,
      state: host.plugins.get('ai-assistant-mcp')?.state,
      buttonCount: document.querySelectorAll('.ai-float-btn').length,
      foreignPresent: !!host.viewer.entities.getById('s11-foreign-owner')
    }
  })
  assert(recreated.ok && recreated.state === 'active' && recreated.buttonCount === 1, 'destroy 后重新激活失败或重复入口')
  assert(recreated.foreignPresent, '重新激活误删其他 owner 实体')
  record('activate-after-destroy-is-clean', recreated)

  const finalCleanup = await page.evaluate(async () => {
    const host = window.capabilityHost
    await host.destroy('ai-assistant-mcp')
    const foreign = host.viewer.entities.getById('s11-foreign-owner')
    if (foreign) host.viewer.entities.remove(foreign)
    return {
      aiButtons: document.querySelectorAll('.ai-float-btn').length,
      aiPanels: document.querySelectorAll('#ai-assistant-mcp-panel').length,
      foreignPresent: !!host.viewer.entities.getById('s11-foreign-owner')
    }
  })
  assert(finalCleanup.aiButtons === 0 && finalCleanup.aiPanels === 0 && !finalCleanup.foreignPresent, '最终清理不完整')
  record('final-test-fixture-cleanup', finalCleanup)
  assert(pageErrors.length === 0, `页面脚本错误：${pageErrors.join(' | ')}`)
  record('no-page-script-errors', { pageErrors })
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ status: 'PASS', checks: results.length, llmCalled: false }, null, 2) + '\n')
  console.log(`PASS：${results.length} 组真实球端生命周期检查`)
} finally {
  await browser.close()
}
