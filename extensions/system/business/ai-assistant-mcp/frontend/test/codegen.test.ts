/**
 * 文件作用：codegen.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * codegen（前端最后一道防御正则 + 主页面执行器）单元测试
 * @description 覆盖：CODEGEN_BLOCK_PATTERN 命中矩阵（fetch(/document[/localStorage[/eval(/
 * new Function(/XMLHttpRequest(/window[ 等自由变量形态）、正常 CesiumJS 代码不误伤、
 * 成员调用形态不在前端拦截（由后端 AST 负责）的契约；executeGeneratedCode 的
 * empty/blocked/viewer 未就绪/success/error 全路径。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODEGEN_BLOCK_PATTERN, executeGeneratedCode } from '../src/executors/codegen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 构造一个可用的假 Viewer（camera.flyTo / scene.requestRender 为 spy） */
function createFakeViewer() {
  return {
    isDestroyed: vi.fn(() => false),
    camera: { flyTo: vi.fn() },
    scene: { requestRender: vi.fn() }
  }
}

describe('CODEGEN_BLOCK_PATTERN — 命中即 blocked', () => {
  const blockedCases: Array<[string, string]> = [
    ['fetch 调用', "fetch('/api/secret')"],
    ['语句中间 fetch 赋值', "const r = fetch('http://evil')"],
    ['document 下标访问', "document['cookie']"],
    ['document 调用形态', "document('x')"],
    ['localStorage 下标访问', "localStorage['Admin-Token']"],
    ['localStorage 调用形态', "localStorage('getItem')"],
    ['window 下标访问', "window['Cesium']"],
    ['window 调用形态', "window('open')"],
    ['eval 调用', "eval('1+1')"],
    ['new Function 构造', "new Function('return 1')()"],
    ['XMLHttpRequest 构造', 'const x = new XMLHttpRequest()'],
    ['关键字后允许空白', 'fetch  (  "/x"  )']
  ]

  for (const [name, code] of blockedCases) {
    it(name, () => {
      expect(CODEGEN_BLOCK_PATTERN.test(code)).toBe(true)
    })
  }
})

describe('CODEGEN_BLOCK_PATTERN — 不误伤', () => {
  const allowedCases: Array<[string, string]> = [
    ['相机飞行', 'const c = Cesium.Cartesian3.fromDegrees(116.39, 39.9, 1000);\nviewer.camera.flyTo({ destination: c });'],
    ['添加实体', "viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(0, 0), point: { pixelSize: 10 } });"],
    ['成员调用形态不在前端拦截（foo.fetch(）', "foo.fetch('/x')"],
    ['成员调用形态 this.eval(', "this.eval('1')"],
    ['标识符前缀 myfetch（不是自由变量 fetch）', 'const myfetch = () => 1;\nmyfetch();'],
    ['普通函数定义与调用', 'function render() { return 42; }\nrender();'],
    ['模板字符串含关键字文本', 'const tip = `请勿在代码中调用 fetch`;']
  ]

  for (const [name, code] of allowedCases) {
    it(name, () => {
      expect(CODEGEN_BLOCK_PATTERN.test(code)).toBe(false)
    })
  }
})

describe('executeGeneratedCode — 防御与执行路径', () => {
  it('空代码 → error（empty code）', () => {
    const result = executeGeneratedCode('', createFakeViewer())
    expect(result.status).toBe('error')
    expect(result.error).toBe('empty code')
  })

  it('命中黑名单 → blocked，且不触碰 viewer', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const viewer = createFakeViewer()
    const result = executeGeneratedCode("fetch('/evil');", viewer)
    expect(result.status).toBe('blocked')
    expect(result.error).toContain('前端防御黑名单')
    expect(viewer.camera.flyTo).not.toHaveBeenCalled()
    expect(viewer.scene.requestRender).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('viewer 为 null / 已销毁 → error（Viewer not ready）', () => {
    expect(executeGeneratedCode('viewer.scene.requestRender();', null)).toMatchObject({
      status: 'error',
      error: 'Viewer not ready'
    })
    const destroyed = { ...createFakeViewer(), isDestroyed: vi.fn(() => true) }
    expect(executeGeneratedCode('viewer.scene.requestRender();', destroyed)).toMatchObject({
      status: 'error',
      error: 'Viewer not ready'
    })
  })

  it('正常 CesiumJS 代码 → success：注入 Cesium/viewer 两个自由变量，执行后 requestRender', () => {
    const fromDegrees = vi.fn((lon: number, lat: number, h: number) => ({ lon, lat, h }))
    vi.stubGlobal('window', { Cesium: { Cartesian3: { fromDegrees } } })
    const viewer = createFakeViewer()
    const code = 'const c = Cesium.Cartesian3.fromDegrees(116.39, 39.9, 1000);\nviewer.camera.flyTo({ destination: c });'
    const result = executeGeneratedCode(code, viewer)
    expect(result.status).toBe('success')
    expect(result.error).toBeUndefined()
    expect(typeof result.durationMs).toBe('number')
    expect(fromDegrees).toHaveBeenCalledWith(116.39, 39.9, 1000)
    expect(viewer.camera.flyTo).toHaveBeenCalledTimes(1)
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(1)
  })

  it('代码执行抛异常 → error，携带异常 message 与耗时', () => {
    vi.stubGlobal('window', { Cesium: {} })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const viewer = createFakeViewer()
    const result = executeGeneratedCode("throw new Error('运行时炸了');", viewer)
    expect(result.status).toBe('error')
    expect(result.error).toBe('运行时炸了')
    expect(typeof result.durationMs).toBe('number')
  })
})
