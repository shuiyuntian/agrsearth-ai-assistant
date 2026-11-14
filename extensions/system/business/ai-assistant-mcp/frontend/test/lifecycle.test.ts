/**
 * 文件作用：AI 助手独立入口与包资源生命周期测试
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-11-14
 * 版本：1.0.0
 * 修改记录：1.0.0 (2026-11-14) 初始创建
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolExecutorRuntime } from '../src/executors'

const makeCesium = () => ({
  Cartesian3: Object.assign(
    (x: number, y: number, z: number) => ({ x, y, z }),
    { fromDegrees: (longitude: number, latitude: number, height: number) => ({ longitude, latitude, height }) }
  ),
  Color: { fromCssColorString: (value: string) => ({ value }), BLUE: {} },
  HeightReference: { CLAMP_TO_GROUND: 1 },
  LabelStyle: { FILL_AND_OUTLINE: 1 },
  VerticalOrigin: { BOTTOM: 1 },
  Cartesian2: function Cartesian2(x: number, y: number) { return { x, y } },
  PolygonHierarchy: function PolygonHierarchy(positions: unknown[]) { return { positions } },
  Math: { toRadians: (deg: number) => (deg * Math.PI) / 180 },
  UrlTemplateImageryProvider: function UrlTemplateImageryProvider(options: unknown) { return options }
})

const makeContext = () => {
  const entities = {
    add: vi.fn((options) => ({ ...options, id: `ai-assistant-mcp/${options.id}` })),
    remove: vi.fn(),
    removeAll: vi.fn(),
    getById: vi.fn()
  }
  const layers = {
    addImageryLayer: vi.fn((_provider, options) => ({ show: options?.show ?? true, alpha: options?.alpha ?? 1 })),
    remove: vi.fn(),
    removeAll: vi.fn(),
    setVisibility: vi.fn(),
    move: vi.fn(),
    setBaseLayer: vi.fn()
  }
  return {
    entities,
    layers,
    primitives: { add: vi.fn(), remove: vi.fn(), removeAll: vi.fn() },
    dataSources: { add: vi.fn(), remove: vi.fn(), removeAll: vi.fn() },
    terrain: { requestSwitch: vi.fn(), getCurrentRequest: vi.fn() },
    cleanup: vi.fn()
  } as any
}

describe('包资源所有权与停用清理', () => {
  let ctx: ReturnType<typeof makeContext>
  beforeEach(() => { ctx = makeContext() })

  it('Entity 经本包上下文添加，拒绝删除非本包对象', async () => {
    const runtime = createToolExecutorRuntime({ getViewer: () => ({}), getCesium: makeCesium, ctx })
    const added = await runtime.executors.entity_add({ entity: { id: 'mine', point: {} } })
    expect(added.success).toBe(true)
    expect(added.entityId).toBe('ai-assistant-mcp/mine')
    expect(ctx.entities.add).toHaveBeenCalledOnce()

    const foreign = await runtime.executors.entity_remove({ entityId: 'other-package/private' })
    expect(foreign.success).toBe(false)
    expect(ctx.entities.remove).not.toHaveBeenCalled()

    const removed = await runtime.executors.entity_remove({ entityId: added.entityId })
    expect(removed.success).toBe(true)
    expect(ctx.entities.remove).toHaveBeenCalledOnce()
    runtime.destroy()
  })

  it('deactivate 隐藏本包 imagery 并拒绝后续命令，reactivate 恢复原显隐', async () => {
    const layer = { show: true, alpha: 1 }
    const viewer = { imageryLayers: { indexOf: () => 3 } }
    ctx.layers.addImageryLayer.mockReturnValue(layer)
    const runtime = createToolExecutorRuntime({ getViewer: () => viewer, getCesium: makeCesium, ctx })
    const added = await runtime.executors.imagery_add({ providerType: 'url', url: 'https://example.invalid/{z}/{x}/{y}.png' })
    expect(added.error).toBeUndefined()
    expect(added).toMatchObject({ success: true, layerIndex: 3 })

    runtime.setActive(false)
    expect(layer.show).toBe(false)
    const blocked = await runtime.executors.entity_list({})
    expect(blocked.success).toBe(false)
    expect(blocked.error).toContain('deactivated')

    runtime.setActive(true)
    expect(layer.show).toBe(true)
    const foreign = await runtime.executors.imagery_remove({ index: 2 })
    expect(foreign.success).toBe(false)
    expect(ctx.layers.remove).not.toHaveBeenCalled()
    runtime.destroy()
  })

  it('destroy 移除本包 orbit 监听', async () => {
    const removeEventListener = vi.fn()
    const viewer = {
      camera: { rotateRight: vi.fn() },
      clock: { onTick: { addEventListener: vi.fn(), removeEventListener } }
    }
    const runtime = createToolExecutorRuntime({ getViewer: () => viewer, getCesium: makeCesium, ctx })
    await runtime.executors.camera_start_orbit({ speed: 0.01 })
    runtime.destroy()
    expect(removeEventListener).toHaveBeenCalledOnce()
    const blocked = await runtime.executors.camera_stop_orbit({})
    expect(blocked.success).toBe(false)
  })
})
