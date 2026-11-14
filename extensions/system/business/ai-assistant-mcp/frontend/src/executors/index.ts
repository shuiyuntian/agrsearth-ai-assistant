/**
 * 文件作用：工具执行器表（TOOL_EXECUTORS）——命令执行终端的 28 个命令实现（+codegen 防御 stub）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-07-26) S2-A：执行器键域自 EnabledTool（白名单全集，契约对齐后含
 *                       server 工具名，无 executor）收窄为 ExecutorCommandType（29 个命令类型，
 *                       见 enabled-tools.ts COMMAND_TYPE_TO_TOOL_NAMES）；
 *                       camera_fly_to / camera_set_view 未给 orientation 时强制垂直俯视
 *                       {heading:0, pitch:-π/2, roll:0}（模型显式给出时尊重）。
 *   - 1.0.0 (2026-07-22) P1-B：自 useSSEConnection.commandHandlers 迁出，handler 逻辑逐字不变。
 *                       TOOL_EXECUTORS 声明为 Record<EnabledTool, Executor> 全键映射：
 *                       enabled-tools.ts 新增工具而此处未实现时 vue-tsc 直接编译失败（编译期守卫）。
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import type { ExecutorCommandType } from './enabled-tools'
import type { CapabilityContextLike } from '../types'

// codegen 执行器（chat 流内执行侧）统一从本模块出口暴露
export * from './codegen'

/** 单个工具执行器：接收命令载荷，执行后返回结果（经 /channel/result 回传 orchestrator） */
export type Executor = (command: any) => Promise<any>

/**
 * 工具执行器全键映射（白名单编译期守卫核心）。
 * 键必须覆盖 ExecutorCommandType 全键（28 个命令通道类型 + cesium_execute_code 防御 stub，
 * 即 enabled-tools.ts COMMAND_TYPE_TO_TOOL_NAMES 的键域）——新增命令类型而未实现对应
 * executor 时，Record 缺键会让 vue-tsc 编译失败，即「启用无 executor 的命令」在编译期被拦截。
 * server 契约工具（discovery/geolocation）不经命令通道，无 executor、不在此键域内。
 */
export type ToolExecutorMap = Record<ExecutorCommandType, Executor>

/** 执行器依赖：Viewer/Cesium 存取器（由 useSSEConnection 注入，执行器闭包延迟取值） */
export interface ExecutorDeps {
  getViewer: () => any
  getCesium: () => any
  ctx?: CapabilityContextLike
}

export interface ToolExecutorRuntime {
  executors: ToolExecutorMap
  setActive: (active: boolean) => void
  destroy: () => void
}

/**
 * 构建工具执行器表
 * @description 28 个 handler 逻辑与原 useSSEConnection.commandHandlers 完全一致，
 * 仅从 composable 闭包改为工厂闭包（getViewer/getCesium 由参数注入）。
 * @param deps - Viewer/Cesium 存取器
 * @returns 全键执行器映射
 */
export function createToolExecutorRuntime(deps: ExecutorDeps): ToolExecutorRuntime {
  const { getViewer, getCesium, ctx } = deps

  /**
   * 从 position 对象创建 Cartesian3
   * @param pos - { longitude, latitude, height }
   * @returns Cartesian3
   */
  const toCartesian3 = (pos: any) => {
    const Cesium = getCesium()
    if (!Cesium) throw new Error('Cesium not available')
    return Cesium.Cartesian3.fromDegrees(
      pos.longitude ?? 0,
      pos.latitude ?? 0,
      pos.height ?? 0
    )
  }

  /**
   * 角度转弧度（MCP 相机协议全部角度制：orientation/offset 的 heading/pitch/roll 均为 degrees，
   * 见 mcp camera-server schemas 与官方 client-core camera-utils）
   */
  const toRad = (deg: number): number => {
    const Cesium = getCesium()
    return Cesium ? Cesium.Math.toRadians(deg) : (deg * Math.PI) / 180
  }

  /**
   * 解析颜色
   * @param color - 颜色字符串或 RGBA 对象
   * @param defaultColor - 默认颜色
   * @returns Cesium Color
   */
  const toColor = (color: any, defaultColor = '#FFFFFF') => {
    const Cesium = getCesium()
    if (!Cesium) throw new Error('Cesium not available')
    if (!color) return Cesium.Color.fromCssColorString(defaultColor)
    if (typeof color === 'string') return Cesium.Color.fromCssColorString(color)
    if (typeof color === 'object' && color.red !== undefined) {
      return new Cesium.Color(
        color.red ?? 1,
        color.green ?? 0,
        color.blue ?? 0,
        color.alpha ?? 1
      )
    }
    return Cesium.Color.fromCssColorString(defaultColor)
  }

  // 轨道旋转监听器与本包资源只归当前执行器运行时所有。
  let orbitListener: any = null
  let active = true
  const ownedEntities = new Set<any>()
  const ownedImagery = new Map<any, boolean>()
  const ownedTilesets = new Map<any, boolean>()

  const stopOrbit = () => {
    const viewer = getViewer()
    if (orbitListener && viewer?.clock) {
      viewer.clock.onTick.removeEventListener(orbitListener)
    }
    orbitListener = null
  }

  const setActive = (next: boolean) => {
    active = next
    if (!next) {
      stopOrbit()
      const viewer = getViewer()
      if (viewer?.trackedEntity && ownedEntities.has(viewer.trackedEntity)) {
        viewer.trackedEntity = undefined
      }
    }
    for (const [layer, previousShow] of ownedImagery) {
      if (!next) ownedImagery.set(layer, layer.show)
      layer.show = next ? previousShow : false
    }
    for (const [tileset, previousShow] of ownedTilesets) {
      if (!next) ownedTilesets.set(tileset, tileset.show)
      tileset.show = next ? previousShow : false
    }
  }

  const destroy = () => {
    setActive(false)
    ownedEntities.clear()
    ownedImagery.clear()
    ownedTilesets.clear()
  }

  /**
   * 校验实体名称匹配模式是否安全，防止 ReDoS
   * @param pattern - 用户传入的模式字符串
   * @returns boolean 是否安全
   */
  const isSafeNamePattern = (pattern?: string): boolean => {
    return typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 100
  }

  /**
   * 转义正则元字符，将用户输入作为字面量子串匹配，彻底避免 ReDoS
   * @param pattern - 用户输入字符串
   * @returns string 转义后的正则字面量
   */
  const escapeRegExp = (pattern: string): string => {
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // ========== 工具执行器映射（键 = ExecutorCommandType 全键，缺键即编译失败） ==========
  const TOOL_EXECUTORS: ToolExecutorMap = {
    // ── Camera (7) ──
    camera_fly_to: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const { destination, orientation, duration = 3 } = cmd
        viewer.camera.flyTo({
          destination: toCartesian3(destination),
          // MCP 相机协议角度制：orientation 为 degrees，转弧度后交给 Cesium（对齐官方 client-core）；
          // 未给 orientation 时强制垂直俯视 {0, -π/2, 0}——Cesium 缺省保持当前朝向，
          // 「飞到某地」语义应稳定落在正上方俯视（模型显式给出 orientation 时尊重）
          orientation: orientation ? {
            heading: toRad(orientation.heading ?? 0),
            pitch: toRad(orientation.pitch ?? -90),
            roll: toRad(orientation.roll ?? 0)
          } : { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          duration
        })
        return { success: true, actualDuration: duration }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    camera_set_view: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const { destination, orientation } = cmd
        viewer.camera.setView({
          destination: toCartesian3(destination),
          // MCP 相机协议角度制：orientation 为 degrees，转弧度（对齐官方 client-core）；
          // 未给 orientation 时强制垂直俯视 {0, -π/2, 0}（同 camera_fly_to，显式给出时尊重）
          orientation: orientation ? {
            heading: toRad(orientation.heading ?? 0),
            pitch: toRad(orientation.pitch ?? -90),
            roll: toRad(orientation.roll ?? 0)
          } : { heading: 0, pitch: -Math.PI / 2, roll: 0 }
        })
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    camera_look_at_transform: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const { target, offset } = cmd
        const targetPos = toCartesian3(target)
        const transform = getCesium().Transforms.eastNorthUpToFixedFrame(targetPos)
        // MCP 下发的 offset 为 {heading, pitch, range}（角度制，非 Cartesian3；
        // 对齐官方 client-core lookAtPosition：HeadingPitchRange + degrees→radians）
        const hpr = offset
          ? new (getCesium() as any).HeadingPitchRange(
              toRad(offset.heading ?? 0),
              toRad(offset.pitch ?? -45),
              offset.range ?? 5000
            )
          : undefined
        viewer.camera.lookAtTransform(transform, hpr)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    camera_start_orbit: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        if (orbitListener) {
          viewer.clock.onTick.removeEventListener(orbitListener)
        }
        // MCP 下发带符号 speed（每 tick rotateRight 的弧度增量，负值=clockwise；
        // 对齐官方 client-core startOrbit：直接 rotateRight(speed)，缺省 0.01）
        const speed = typeof cmd?.speed === 'number' ? cmd.speed : 0.01
        orbitListener = () => {
          viewer.camera.rotateRight(speed)
        }
        viewer.clock.onTick.addEventListener(orbitListener)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    camera_stop_orbit: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        if (orbitListener) {
          viewer.clock.onTick.removeEventListener(orbitListener)
          orbitListener = null
        }
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    camera_get_position: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const Cesium = getCesium()
        const cartographic = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC)
        // MCP camera_get_position 的 outputSchema 要求 position/orientation/viewRectangle/altitude
        // 全部存在且 orientation 为角度、viewRectangle 非 null（对齐官方 client-core 返回形态）
        const rect = viewer.camera.computeViewRectangle()
        const viewRectangle = rect
          ? {
              west: Cesium.Math.toDegrees(rect.west),
              south: Cesium.Math.toDegrees(rect.south),
              east: Cesium.Math.toDegrees(rect.east),
              north: Cesium.Math.toDegrees(rect.north)
            }
          : {
              // 兜底：计算失败时以相机为中心合成小窗口（MCP 不接受 null）
              west: Cesium.Math.toDegrees(cartographic.longitude) - 0.01,
              south: Cesium.Math.toDegrees(cartographic.latitude) - 0.01,
              east: Cesium.Math.toDegrees(cartographic.longitude) + 0.01,
              north: Cesium.Math.toDegrees(cartographic.latitude) + 0.01
            }
        return {
          success: true,
          position: {
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            height: cartographic.height
          },
          orientation: {
            heading: Cesium.Math.toDegrees(viewer.camera.heading),
            pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
            roll: Cesium.Math.toDegrees(viewer.camera.roll)
          },
          viewRectangle,
          altitude: cartographic.height
        }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    camera_set_controller_options: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const controller = viewer.scene.screenSpaceCameraController
        // MCP 命令形态为 {type, options:{...}}（对齐官方 client-core setControllerOptions）
        const s = cmd?.options ?? cmd ?? {}
        if (s.enableCollisionDetection !== undefined) controller.enableCollisionDetection = s.enableCollisionDetection
        if (s.minimumZoomDistance !== undefined) controller.minimumZoomDistance = s.minimumZoomDistance
        if (s.maximumZoomDistance !== undefined) controller.maximumZoomDistance = s.maximumZoomDistance
        if (s.enableTilt !== undefined) controller.enableTilt = s.enableTilt
        if (s.enableRotate !== undefined) controller.enableRotate = s.enableRotate
        if (s.enableTranslate !== undefined) controller.enableTranslate = s.enableTranslate
        if (s.enableZoom !== undefined) controller.enableZoom = s.enableZoom
        if (s.enableLook !== undefined) controller.enableLook = s.enableLook
        // MCP outputSchema 要求回传全部当前 settings（含 enableLook/enableCollisionDetection 布尔必填）
        return {
          success: true,
          settings: {
            enableCollisionDetection: controller.enableCollisionDetection ?? true,
            minimumZoomDistance: controller.minimumZoomDistance,
            maximumZoomDistance: controller.maximumZoomDistance,
            enableTilt: controller.enableTilt,
            enableRotate: controller.enableRotate,
            enableTranslate: controller.enableTranslate,
            enableZoom: controller.enableZoom,
            enableLook: controller.enableLook
          }
        }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    // ── Entity (3) ──
    entity_add: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const { entity } = cmd
        if (!entity) return { success: false, error: 'No entity data' }

        const Cesium = getCesium()
        const ent: any = {
          id: entity.id || `entity-${Date.now()}`,
          name: entity.name || 'Entity'
        }
        if (entity.description) ent.description = entity.description
        if (entity.position) {
          ent.position = toCartesian3(entity.position)
        }

        // 根据 entity 中的 graphics key 决定类型
        if (entity.point) {
          ent.point = {
            pixelSize: entity.point.pixelSize || 10,
            color: toColor(entity.point.color, '#FF0000'),
            outlineColor: toColor(entity.point.outlineColor, '#FFFFFF'),
            outlineWidth: entity.point.outlineWidth || 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        }
        if (entity.label) {
          // Support color aliases from AI: color → fillColor, outline → outlineColor
          const fillColorSrc = entity.label.fillColor !== undefined ? entity.label.fillColor : entity.label.color
          const outlineColorSrc = entity.label.outlineColor !== undefined ? entity.label.outlineColor : entity.label.outline
          ent.label = {
            text: entity.label.text || '',
            font: entity.label.font || '14px sans-serif',
            fillColor: toColor(fillColorSrc, '#FFFFFF'),
            outlineColor: toColor(outlineColorSrc, '#000000'),
            outlineWidth: entity.label.outlineWidth || 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        }
        if (entity.billboard) {
          ent.billboard = {
            image: entity.billboard.image || '',
            scale: entity.billboard.scale || 1,
            color: toColor(entity.billboard.color, '#FFFFFF'),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        }
        if (entity.polygon) {
          ent.polygon = {
            hierarchy: new Cesium.PolygonHierarchy(
              (entity.polygon.positions || []).map((p: any) => toCartesian3(p))
            ),
            material: toColor(entity.polygon.material, '#FF0000'),
            outline: entity.polygon.outline !== false,
            outlineColor: toColor(entity.polygon.outlineColor, '#000000')
          }
        }
        if (entity.polyline) {
          ent.polyline = {
            positions: (entity.polyline.positions || []).map((p: any) => toCartesian3(p)),
            width: entity.polyline.width || 2,
            material: toColor(entity.polyline.material, '#FF0000')
          }
        }
        if (entity.ellipse) {
          ent.ellipse = {
            semiMajorAxis: entity.ellipse.semiMajorAxis || 1000,
            semiMinorAxis: entity.ellipse.semiMinorAxis || 500,
            material: toColor(entity.ellipse.material, '#FF0000'),
            outline: entity.ellipse.outline !== false
          }
        }
        if (entity.rectangle) {
          ent.rectangle = {
            coordinates: Cesium.Rectangle.fromDegrees(
              entity.rectangle.west || -180,
              entity.rectangle.south || -90,
              entity.rectangle.east || 180,
              entity.rectangle.north || 90
            ),
            material: toColor(entity.rectangle.material, '#FF0000')
          }
        }
        if (entity.wall) {
          ent.wall = {
            positions: (entity.wall.positions || []).map((p: any) => toCartesian3(p)),
            maximumHeights: entity.wall.maximumHeights,
            minimumHeights: entity.wall.minimumHeights,
            material: toColor(entity.wall.material, '#FF0000')
          }
        }
        if (entity.cylinder) {
          ent.cylinder = {
            length: entity.cylinder.length || 1000,
            topRadius: entity.cylinder.topRadius || 500,
            bottomRadius: entity.cylinder.bottomRadius || 500,
            material: toColor(entity.cylinder.material, '#FF0000')
          }
        }
        if (entity.box) {
          ent.box = {
            dimensions: new Cesium.Cartesian3(
              entity.box.dimensions?.x || 1000,
              entity.box.dimensions?.y || 1000,
              entity.box.dimensions?.z || 1000
            ),
            material: toColor(entity.box.material, '#FF0000')
          }
        }
        if (entity.corridor) {
          ent.corridor = {
            positions: (entity.corridor.positions || []).map((p: any) => toCartesian3(p)),
            width: entity.corridor.width || 500,
            material: toColor(entity.corridor.material, '#FF0000')
          }
        }
        if (entity.model) {
          ent.model = {
            uri: entity.model.uri || '',
            scale: entity.model.scale || 1,
            minimumPixelSize: entity.model.minimumPixelSize || 64
          }
        }

        if (!ctx) return { success: false, error: 'Capability context not ready' }
        const added = ctx.entities.add(ent)
        ownedEntities.add(added)
        return { success: true, entityId: added.id, totalEntities: ownedEntities.size }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    entity_list: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const Cesium = getCesium()
        const entities: any[] = []
        ownedEntities.forEach((e: any) => {
          let type = 'unknown'
          for (const g of ['point', 'label', 'billboard', 'model', 'polygon', 'polyline', 'rectangle', 'wall', 'corridor', 'ellipse', 'cylinder', 'box']) {
            if (e[g]) { type = g; break }
          }
          const item: any = { id: e.id, name: e.name || '', type, show: e.show !== false }
          try {
            const pos = e.position?.getValue?.(viewer.clock.currentTime)
            if (pos) {
              const carto = Cesium.Cartographic.fromCartesian(pos)
              item.position = {
                longitude: Cesium.Math.toDegrees(carto.longitude),
                latitude: Cesium.Math.toDegrees(carto.latitude),
                height: carto.height
              }
            }
          } catch { /* position 取不到则省略（schema 允许） */ }
          entities.push(item)
        })
        return { success: true, entities, totalEntities: entities.length }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    entity_remove: async (cmd) => {
      if (!ctx) return { success: false, error: 'Capability context not ready' }
      try {
        const entityId = cmd.entityId
        let entity = [...ownedEntities].find((item) => item.id === entityId)
        if (!entity && cmd.namePattern) {
          if (!isSafeNamePattern(cmd.namePattern)) {
            return { success: false, error: 'namePattern 非法或过长，存在 ReDoS 风险' }
          }
          const pattern = new RegExp(escapeRegExp(cmd.namePattern))
          entity = [...ownedEntities].find((item) => pattern.test(item.name || ''))
        }
        if (!entity) return { success: false, error: `Entity ${entityId || cmd.namePattern} not found or not owned by ai-assistant-mcp` }
        ctx.entities.remove(entity)
        ownedEntities.delete(entity)
        return { success: true, totalEntities: ownedEntities.size }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    // ── Animation (8) ──
    animation_create: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        // 简化实现：创建一个沿路径移动的实体
        const Cesium = getCesium()
        const id = cmd.animationId || cmd.name || `anim-${Date.now()}`
        const samples = cmd.positionSamples || cmd.path || []
        // 采样点兼容 {time, position} 与裸 position 两种形态
        const positionProperty = new Cesium.SampledPositionProperty()
        const t0 = Cesium.JulianDate.now()
        let added = 0
        samples.forEach((p: any, idx: number) => {
          const rawPos = p?.position ?? p
          if (!rawPos || typeof rawPos !== 'object') return
          const time = p?.time
            ? Cesium.JulianDate.fromIso8601(p.time)
            : Cesium.JulianDate.addSeconds(t0, idx * 10, new Cesium.JulianDate())
          positionProperty.addSample(time, toCartesian3(rawPos))
          added += 1
        })
        if (added < 2) return { success: false, error: 'Need at least 2 positions' }

        if (!ctx) return { success: false, error: 'Capability context not ready' }
        const animation = ctx.entities.add({
          id,
          position: positionProperty,
          point: { pixelSize: 10, color: Cesium.Color.BLUE }
        })
        ownedEntities.add(animation)
        // MCP AnimationCreateResponseSchema 要求 animationId/startTime/stopTime 必填（ISO 8601）
        const startTime = cmd.startTime || Cesium.JulianDate.toIso8601(t0)
        const stopTime = cmd.stopTime || Cesium.JulianDate.toIso8601(Cesium.JulianDate.addSeconds(t0, added * 10, new Cesium.JulianDate()))
        return { success: true, animationId: id, startTime, stopTime, modelPreset: cmd.modelPreset || 'point' }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    animation_control: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      if (!viewer.clock) return { success: false, error: 'Clock not available' }
      try {
        const { action } = cmd
        if (action === 'play') viewer.clock.shouldAnimate = true
        if (action === 'pause') viewer.clock.shouldAnimate = false
        if (action === 'stop') { viewer.clock.shouldAnimate = false; viewer.clock.currentTime = viewer.clock.startTime }
        return { success: true, action }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    animation_remove: async (cmd) => {
      if (!ctx) return { success: false, error: 'Capability context not ready' }
      try {
        const entity = [...ownedEntities].find((item) => item.id === cmd.id)
        if (!entity) return { success: false, error: 'Animation not found or not owned by ai-assistant-mcp' }
        ctx.entities.remove(entity)
        ownedEntities.delete(entity)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    animation_list_active: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const allEntities = [...ownedEntities]
        const clock = viewer.clock
        const multiplier = clock?.multiplier ?? 1
        const startTime = clock?.startTime ? clock.startTime.toString() : new Date().toISOString()
        const stopTime = clock?.stopTime ? clock.stopTime.toString() : new Date().toISOString()
        // MCP AnimationInfoSchema 要求 animationId/isAnimating/startTime/stopTime/clockMultiplier 必填
        const animations = (Array.isArray(allEntities) ? allEntities : [])
          .filter((e: any) => e && e.position)
          .map((e: any) => ({
            animationId: e.id,
            name: e.name || '',
            isAnimating: !!clock?.shouldAnimate,
            startTime,
            stopTime,
            clockMultiplier: multiplier
          }))
        return {
          success: true,
          animations,
          clockState: {
            shouldAnimate: !!clock?.shouldAnimate,
            multiplier,
            currentTime: clock?.currentTime ? clock.currentTime.toString() : new Date().toISOString()
          }
        }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    animation_update_path: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const entity = [...ownedEntities].find((item) => item.id === cmd.id)
        if (!entity) return { success: false, error: 'Animation not found or not owned by ai-assistant-mcp' }
        const positions = (cmd.path || []).map((p: any) => toCartesian3(p))
        // 简化处理
        return { success: true, id: cmd.id, positions: positions.length }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    animation_camera_tracking: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        // MCP 命令形态：{type, animationId, track, range?, pitch?, heading?}
        if (cmd.track) {
          const id = cmd.animationId ?? cmd.entityId
          const entity = [...ownedEntities].find((item) => item.id === id)
          if (!entity) return { success: false, error: 'Animation not found or not owned by ai-assistant-mcp' }
          viewer.trackedEntity = entity
        } else {
          viewer.trackedEntity = undefined
        }
        return { success: true, tracking: !!cmd.track }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    clock_control: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      if (!viewer.clock) return { success: false, error: 'Clock not available' }
      try {
        const Cesium = getCesium()
        const { action, clock, currentTime, multiplier } = cmd
        // MCP 命令形态：action ∈ configure / setTime / setMultiplier（对齐官方 client-core）
        if (action === 'configure' && clock) {
          if (clock.startTime) viewer.clock.startTime = Cesium.JulianDate.fromIso8601(clock.startTime)
          if (clock.stopTime) viewer.clock.stopTime = Cesium.JulianDate.fromIso8601(clock.stopTime)
          if (clock.currentTime) viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(clock.currentTime)
          if (typeof clock.multiplier === 'number') viewer.clock.multiplier = clock.multiplier
          if (clock.shouldAnimate !== undefined) viewer.clock.shouldAnimate = !!clock.shouldAnimate
        } else if (action === 'setTime' && currentTime) {
          viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(currentTime)
        } else if (action === 'setMultiplier' && multiplier !== undefined) {
          viewer.clock.multiplier = multiplier
        } else if (action === 'start') {
          viewer.clock.shouldAnimate = true
        } else if (action === 'stop') {
          viewer.clock.shouldAnimate = false
        } else if (action === 'setSpeed' && multiplier !== undefined) {
          // 旧协议形态兜底
          viewer.clock.multiplier = multiplier
        }
        return { success: true, currentTime: viewer.clock.currentTime.toString() }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    globe_lighting: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const scene = viewer.scene
        if (cmd.enableLighting !== undefined) scene.globe.enableLighting = cmd.enableLighting
        if (cmd.intensity !== undefined) scene.light.intensity = cmd.intensity
        return { success: true, enableLighting: scene.globe.enableLighting }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    // ── Imagery (3) ──
    imagery_add: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const Cesium = getCesium()
        const { providerType, url, name, layers, alpha, show } = cmd
        let provider: any

        if (providerType === 'url' && url) {
          provider = new Cesium.UrlTemplateImageryProvider({ url })
        } else if (providerType === 'wms' && url) {
          provider = new Cesium.WebMapServiceImageryProvider({ url, layers: layers || '' })
        } else if (providerType === 'ion' && cmd.assetId) {
          provider = Cesium.IonImageryProvider.fromAssetId(cmd.assetId)
        } else {
          // 默认 Bing 或 OSM
          provider = new Cesium.OpenStreetMapImageryProvider({
            url: url || 'https://a.tile.openstreetmap.org/'
          })
        }

        if (!ctx) return { success: false, error: 'Capability context not ready' }
        const layer = ctx.layers.addImageryLayer(provider, { alpha, show })
        ownedImagery.set(layer, layer.show)
        ;(layer as any).__layerName = name || providerType
        return { success: true, layerIndex: viewer.imageryLayers.indexOf(layer), layerName: name || providerType }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    imagery_remove: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      if (!ctx) return { success: false, error: 'Capability context not ready' }
      try {
        let layer = [...ownedImagery.keys()].find((item) => (item as any).__layerName === cmd.name)
        const layerIndex = cmd.index !== undefined ? cmd.index : cmd.layerIndex
        if (!layer && layerIndex !== undefined) {
          const candidate = viewer.imageryLayers.get(layerIndex)
          if (ownedImagery.has(candidate)) layer = candidate
        }
        if (!layer) return { success: false, error: 'Imagery layer not found or not owned by ai-assistant-mcp' }
        ctx.layers.remove(layer)
        ownedImagery.delete(layer)
        return { success: true, totalLayers: ownedImagery.size }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    imagery_list: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const layers: any[] = []
        for (const layer of ownedImagery.keys()) {
          layers.push({ index: viewer.imageryLayers.indexOf(layer), show: layer.show, alpha: layer.alpha })
        }
        return { success: true, layers, totalLayers: layers.length }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    // ── Tileset (4) ──
    tileset_add: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const Cesium = getCesium()
        const tileset = await Cesium.Cesium3DTileset.fromUrl(cmd.url)
        ;(tileset as any).name = cmd.name
        ;(tileset as any).tilesetId = cmd.tilesetId || `tileset-${Date.now()}`
        if (cmd.show === false) tileset.show = false
        if (!ctx) return { success: false, error: 'Capability context not ready' }
        ctx.primitives.add(tileset)
        ownedTilesets.set(tileset, tileset.show)
        return { success: true, id: (tileset as any).tilesetId, name: cmd.name }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    tileset_remove: async (cmd) => {
      if (!ctx) return { success: false, error: 'Capability context not ready' }
      try {
        const tileset = [...ownedTilesets.keys()].find((item) =>
          (item as any).tilesetId === cmd.tilesetId || item.id === cmd.tilesetId || item.id === cmd.id || (item as any).name === cmd.name)
        if (!tileset) return { success: false, error: 'Tileset not found or not owned by ai-assistant-mcp' }
        ctx.primitives.remove(tileset)
        ownedTilesets.delete(tileset)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    tileset_list: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const tilesets: any[] = []
        let index = 0
        for (const tileset of ownedTilesets.keys()) {
          tilesets.push({ id: (tileset as any).tilesetId || tileset.id || index++, url: tileset.url })
        }
        return { success: true, tilesets }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    tileset_style: async (cmd) => {
      try {
        const tileset = [...ownedTilesets.keys()].find((item) =>
          (item as any).tilesetId === cmd.tilesetId || item.id === cmd.tilesetId || item.id === cmd.id || (item as any).name === cmd.name)
        if (!tileset) return { success: false, error: 'Tileset not found or not owned by ai-assistant-mcp' }
        const style = cmd.color ? { color: cmd.color, show: cmd.show } : cmd.style
        tileset.style = new (getCesium() as any).Cesium3DTileStyle(style)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    // ── Terrain (3) ──
    terrain_set: async (cmd) => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const Cesium = getCesium()
        const { sourceType, assetId, url, requestVertexNormals, requestWaterMask } = cmd
        let provider: any

        if (sourceType === 'ion' && assetId) {
          provider = await Cesium.CesiumTerrainProvider.fromIonAssetId(assetId, {
            requestVertexNormals: requestVertexNormals || false,
            requestWaterMask: requestWaterMask || false
          })
        } else if (sourceType === 'url' && url) {
          provider = await Cesium.CesiumTerrainProvider.fromUrl(url, {
            requestVertexNormals: requestVertexNormals || false,
            requestWaterMask: requestWaterMask || false
          })
        } else {
          // 默认世界地形
          provider = await Cesium.createWorldTerrainAsync({
            requestVertexNormals: requestVertexNormals || false,
            requestWaterMask: requestWaterMask || false
          })
        }
        if (!ctx) return { success: false, error: 'Capability context not ready' }
        ctx.terrain.requestSwitch(provider, 'ai-assistant-mcp terrain_set')
        return { success: true, name: cmd.name || sourceType }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    terrain_get: async () => {
      const viewer = getViewer()
      if (!viewer) return { success: false, error: 'Viewer not ready' }
      try {
        const tp = viewer.terrainProvider
        return {
          success: true,
          hasTerrain: tp && !(tp instanceof getCesium().EllipsoidTerrainProvider),
          name: tp?.constructor?.name || 'unknown'
        }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    terrain_remove: async () => {
      if (!ctx) return { success: false, error: 'Capability context not ready' }
      try {
        ctx.terrain.requestSwitch(new (getCesium() as any).EllipsoidTerrainProvider(), 'ai-assistant-mcp terrain_remove')
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    // ── Codegen (1) ──
    // cesium_execute_code 不是命令通道工具：orchestrator 本地工具，批准后经 chat 流
    // tool-output-available 返回 {code, approvedForExecution:true}，由 useAIAssistant
    // 调 executors/codegen.ts 在主页面执行。此 stub 仅为满足 Record<ExecutorCommandType> 全键守卫 +
    // 纵深防御（若命令通道误收同名命令，直接拒绝、绝不执行）。
    cesium_execute_code: async () => {
      console.warn('[Executors] cesium_execute_code 不经命令通道执行，收到命令已拒绝')
      return { success: false, error: 'cesium_execute_code is executed in the chat stream, not via the command channel' }
    }
  }

  const executors = Object.fromEntries(
    Object.entries(TOOL_EXECUTORS).map(([name, execute]) => [
      name,
      async (command: any) => active
        ? execute(command)
        : { success: false, error: 'AI assistant is deactivated' }
    ])
  ) as ToolExecutorMap

  return { executors, setActive, destroy }
}

export function createToolExecutors(deps: ExecutorDeps): ToolExecutorMap {
  return createToolExecutorRuntime(deps).executors
}
