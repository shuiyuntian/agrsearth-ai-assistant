/**
 * 文件作用：executors.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-26
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * executors（工具执行器表）单元测试
 * @description 覆盖：TOOL_EXECUTORS 键域与 COMMAND_TYPE_TO_TOOL_NAMES 29 键运行时对账
 * （编译期另有 Record 全键守卫）；camera_fly_to / camera_set_view 未给 orientation 时
 * 强制垂直俯视 {heading:0, pitch:-π/2, roll:0}，显式给出时尊重（degrees→radians）；
 * cesium_execute_code 命令通道 stub 纵深防御拒绝。
 */

import { describe, expect, it, vi } from 'vitest'
import { createToolExecutors, type ExecutorDeps } from '../src/executors'
import { COMMAND_TYPE_TO_TOOL_NAMES } from '../src/executors/enabled-tools'

/** mock Cesium 全局（仅覆盖本测试用到的最小面） */
const makeCesium = () => ({
  Cartesian3: {
    fromDegrees: (longitude: number, latitude: number, height: number) => ({
      longitude,
      latitude,
      height
    })
  },
  Math: {
    toRadians: (deg: number) => (deg * Math.PI) / 180
  }
})

/** mock Viewer（camera.flyTo / camera.setView 捕获参数） */
const makeViewer = () => ({
  camera: {
    flyTo: vi.fn(),
    setView: vi.fn()
  },
  scene: { requestRender: vi.fn() }
})

const makeDeps = (viewer: any): ExecutorDeps => ({
  getViewer: () => viewer,
  getCesium: makeCesium
})

describe('TOOL_EXECUTORS 键域对账', () => {
  it('执行器键 = COMMAND_TYPE_TO_TOOL_NAMES 29 键（运行时对账，编译期 Record 守卫互补）', () => {
    const executors = createToolExecutors({ getViewer: () => null, getCesium: () => null })
    expect(Object.keys(executors).sort()).toEqual(Object.keys(COMMAND_TYPE_TO_TOOL_NAMES).sort())
    expect(Object.keys(executors)).toHaveLength(29)
  })
})

describe('camera_fly_to 垂直视角兜底', () => {
  it('未给 orientation → 强制垂直俯视 {heading:0, pitch:-π/2, roll:0}', async () => {
    const viewer = makeViewer()
    const executors = createToolExecutors(makeDeps(viewer))
    const result = await executors.camera_fly_to({
      destination: { longitude: 116.39, latitude: 39.9, height: 10000 }
    })
    expect(result.success).toBe(true)
    expect(viewer.camera.flyTo).toHaveBeenCalledTimes(1)
    const arg = viewer.camera.flyTo.mock.calls[0][0]
    expect(arg.destination).toEqual({ longitude: 116.39, latitude: 39.9, height: 10000 })
    expect(arg.orientation).toEqual({ heading: 0, pitch: -Math.PI / 2, roll: 0 })
    expect(arg.duration).toBe(3)
  })

  it('显式给出 orientation → 尊重模型值（degrees→radians，字段缺省 0/-90/0）', async () => {
    const viewer = makeViewer()
    const executors = createToolExecutors(makeDeps(viewer))
    await executors.camera_fly_to({
      destination: { longitude: 116.39, latitude: 39.9, height: 10000 },
      orientation: { heading: 90, pitch: -45, roll: 10 },
      duration: 5
    })
    const arg = viewer.camera.flyTo.mock.calls[0][0]
    expect(arg.orientation).toEqual({ heading: Math.PI / 2, pitch: -Math.PI / 4, roll: Math.PI / 18 })
    expect(arg.duration).toBe(5)
  })

  it('orientation 仅给 heading → 该字段尊重，pitch/roll 按 MCP 缺省 -90°/0°', async () => {
    const viewer = makeViewer()
    const executors = createToolExecutors(makeDeps(viewer))
    await executors.camera_fly_to({
      destination: { longitude: 0, latitude: 0, height: 100 },
      orientation: { heading: 30 }
    })
    const arg = viewer.camera.flyTo.mock.calls[0][0]
    expect(arg.orientation).toEqual({ heading: Math.PI / 6, pitch: -Math.PI / 2, roll: 0 })
  })
})

describe('camera_set_view 垂直视角兜底', () => {
  it('未给 orientation → 强制垂直俯视 {heading:0, pitch:-π/2, roll:0}', async () => {
    const viewer = makeViewer()
    const executors = createToolExecutors(makeDeps(viewer))
    const result = await executors.camera_set_view({
      destination: { longitude: 121.47, latitude: 31.23, height: 5000 }
    })
    expect(result.success).toBe(true)
    expect(viewer.camera.setView).toHaveBeenCalledTimes(1)
    const arg = viewer.camera.setView.mock.calls[0][0]
    expect(arg.destination).toEqual({ longitude: 121.47, latitude: 31.23, height: 5000 })
    expect(arg.orientation).toEqual({ heading: 0, pitch: -Math.PI / 2, roll: 0 })
  })

  it('显式给出 orientation → 尊重模型值（degrees→radians）', async () => {
    const viewer = makeViewer()
    const executors = createToolExecutors(makeDeps(viewer))
    await executors.camera_set_view({
      destination: { longitude: 121.47, latitude: 31.23, height: 5000 },
      orientation: { heading: 180, pitch: -30, roll: 0 }
    })
    const arg = viewer.camera.setView.mock.calls[0][0]
    expect(arg.orientation).toEqual({ heading: Math.PI, pitch: -Math.PI / 6, roll: 0 })
  })
})

describe('cesium_execute_code 命令通道 stub（纵深防御）', () => {
  it('命令通道误收同名命令 → 拒绝执行并回报错误', async () => {
    const viewer = makeViewer()
    const executors = createToolExecutors(makeDeps(viewer))
    const result = await executors.cesium_execute_code({ intent: 'draw a circle' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('chat stream')
  })
})
