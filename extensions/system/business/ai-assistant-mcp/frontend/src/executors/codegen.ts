/**
 * 文件作用：codegen 执行器（cesium_execute_code 的浏览器主页面执行侧）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) P3-B：codegen 执行模型（审查定案，免沙箱）：
 *                       orchestrator 只做 AST 校验与审批挂起（不执行代码）；批准回执后
 *                       经 chat 流 tool-output-available 返回 {code, approvedForExecution:true}，
 *                       前端以 new Function('Cesium','viewer')(window.Cesium, viewer) 在主页面执行。
 *                       防御层次：① 后端 AST（fetch/document/eval/Function/动态 import/自由变量
 *                       白名单/长度行数上限，主防线）→ ② 前端正则兜底（本文件，纵深防御）
 *                       → ③ try/catch 执行隔离。
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/** codegen 工具名（orchestrator 本地工具，不经 MCP 命令通道） */
export const CODEGEN_TOOL_NAME = 'cesium_execute_code'

/**
 * 前端最后一道防御（纵深防御兜底，主防线在 orchestrator AST 校验）。
 * 命中自由变量形态的危险 API 调用（`fetch(`、`document[`、`eval(` 等）即拒绝执行；
 * 成员调用形态（如 `foo.fetch(`）不在此拦截（由后端 AST 负责）。
 */
export const CODEGEN_BLOCK_PATTERN =
  /(^|[^.\w])(fetch|XMLHttpRequest|localStorage|document|window|eval|Function)\s*[(\[]/

/** 执行结果状态 */
export type CodegenExecutionStatus = 'success' | 'error' | 'blocked'

/** 执行结果 */
export interface CodegenExecutionResult {
  status: CodegenExecutionStatus
  /** error/blocked 时的错误信息 */
  error?: string
  /** 执行耗时（ms） */
  durationMs?: number
}

/**
 * 在主页面执行 codegen 代码
 * @description 执行环境：自由变量 Cesium（window 全局）与 viewer（当前 Viewer 实例）；
 * try/catch 包裹，成功后 viewer.scene.requestRender() 立即刷新。
 * @param code - AST 校验通过的 CesiumJS 代码全文
 * @param viewer - Cesium Viewer 实例
 * @returns 执行结果（success / error / blocked）
 */
export function executeGeneratedCode(code: string, viewer: any): CodegenExecutionResult {
  if (!code || typeof code !== 'string') {
    return { status: 'error', error: 'empty code' }
  }
  // 前端正则兜底：AST 漏网特征直接拦截（注释见 CODEGEN_BLOCK_PATTERN）
  if (CODEGEN_BLOCK_PATTERN.test(code)) {
    console.warn('[codegen] blocked by frontend defense pattern')
    return { status: 'blocked', error: '命中前端防御黑名单（fetch/document/eval/Function 等），已阻止执行' }
  }
  if (!viewer || viewer.isDestroyed?.()) {
    return { status: 'error', error: 'Viewer not ready' }
  }
  const t0 = performance.now()
  try {
    // 免沙箱定案：主页面执行，严格模式，仅注入 Cesium 与 viewer 两个自由变量
    const fn = new Function('Cesium', 'viewer', '"use strict";\n' + code)
    fn((window as any).Cesium, viewer)
    viewer.scene?.requestRender?.()
    return { status: 'success', durationMs: Math.round(performance.now() - t0) }
  } catch (e: any) {
    console.error('[codegen] execution failed:', e)
    return { status: 'error', error: e?.message || String(e), durationMs: Math.round(performance.now() - t0) }
  }
}
