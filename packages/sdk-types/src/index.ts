/**
 * 文件作用：Capability 插件平台类型定义（模板仓 vendored 共享包 @cesiumai/sdk-types）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 自平台仓 extensions/_shared/sdk-types vendor：包名改为 @cesiumai/sdk-types，
 *                       类型内容同源；消灭 ../../_shared 相对路径，模板仓内经 npm workspace 引用
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import type { Component } from 'vue'

/** 取消订阅函数 */
export type Unsubscribe = () => void

/** 插件包元信息 */
export interface CapabilityManifest {
  /** 插件唯一标识 */
  id: string
  /** 插件名称 */
  name: string
  /** 版本号 */
  version: string
  /** 插件描述 */
  description?: string
  /** 作者 */
  author?: string
  /** 插件图标（EP 图标名 | `iconlib:<instanceId>` 副本引用 | `calcite:<name>` 库图标引用（开发期） | URL） */
  icon?: string
  /** 入口文件（远程插件使用） */
  entry?: string
  /** CSS 样式文件 URL（远程插件使用） */
  css?: string
  /** 依赖的其他插件 ID */
  dependencies?: string[]
  /** 是否在工具栏中隐藏（例如右下角悬浮入口的插件） */
  hiddenInToolbar?: boolean
  /** 额外配置（由后端 resource-manager 透传） */
  config?: Record<string, any>
}

/** 浮动面板选项 */
/** 面板标题栏操作按钮 */
export interface PanelHeaderAction {
  /** 唯一标识 */
  id: string
  /** 图标组件 */
  icon?: Component
  /** 按钮文本（与 icon 可并存） */
  text?: string
  /** 悬浮提示 */
  tooltip?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 点击事件 */
  onClick: (action: PanelHeaderAction) => void
}

export interface FloatingPanelOpts {
  /** 面板唯一标识，默认自动生成 */
  id?: string
  /** 面板标题 */
  title?: string
  /** 面板标题栏左侧图标（Element Plus 图标组件 / 图片 URL / iconfont 类名） */
  headerIcon?: Component | string
  /** 面板标题栏右侧操作按钮（关闭按钮左侧） */
  headerActions?: PanelHeaderAction[]
  /** 面板标题栏右侧自定义内容组件（渲染在 actions 左侧，适合响应式内容） */
  headerExtra?: Component
  /** 透传给 headerExtra 组件的 props */
  headerExtraProps?: Record<string, any>
  /** 面板内容 Vue 组件（必填） */
  component: Component
  /** 透传给组件的 props */
  props?: Record<string, any>
  /** 初始宽度 */
  width?: number | string
  /** 初始高度 */
  height?: number | string
  /** 最小宽度 */
  minWidth?: number
  /** 最小高度 */
  minHeight?: number
  /** 最大宽度 */
  maxWidth?: number
  /** 最大高度 */
  maxHeight?: number
  /** 初始 X 坐标 */
  x?: number
  /** 初始 Y 坐标 */
  y?: number
  /** 锚点位置 */
  anchor?: 'left-top' | 'left-bottom' | 'right-top' | 'right-bottom' | 'center'
  /** 锚点水平偏移 */
  offsetX?: number
  /** 锚点垂直偏移 */
  offsetY?: number
  /** 是否可拖拽 */
  draggable?: boolean
  /** 是否可缩放 */
  resizable?: boolean
  /** 是否可关闭 */
  closable?: boolean
  /** 是否为模态 */
  modal?: boolean
  /** 鼠标事件穿透 */
  pointerEvents?: 'auto' | 'none'
  /** 自定义 z-index */
  zIndex?: number
  /** 自定义类名 */
  className?: string
  /** 自定义样式 */
  style?: Record<string, string>
  /** 是否限制在安全区域（标题栏/工具栏/状态栏以内）。false 表示可在主窗体任意位置、任意大小 */
  constrainToSafeArea?: boolean
  /** 面板渲染模式：shadow 使用 Shadow DOM + 拖拽缩放容器；native 使用轻量固定定位面板 */
  mode?: 'shadow' | 'native'
  /** 关闭回调 */
  onClose?: () => void
}

/** 浮动面板句柄 */
export interface FloatingPanelHandle {
  /** 面板 ID */
  id: string
  /** 面板根元素 */
  el: HTMLElement
  /** 关闭并销毁面板 */
  close(): void
  /** 置顶面板 */
  focus(): void
  /** 更新面板选项 */
  update(opts: Partial<FloatingPanelOpts>): void
  /** 显示面板 */
  show(): void
  /** 隐藏面板 */
  hide(): void
}

/** 相机位置 */
export interface CameraPosition {
  longitude: number
  latitude: number
  height: number
  heading?: number
  pitch?: number
  roll?: number
}

/** 相机变化监听选项 */
export interface CameraChangeOpts {
  /** 节流间隔（毫秒） */
  throttle?: number
}

/** 屏幕空间事件类型 */
export type ScreenSpaceEventType = 'leftClick' | 'leftDoubleClick' | 'leftDown' | 'leftUp' |
  'middleClick' | 'middleDown' | 'middleUp' |
  'rightClick' | 'rightDown' | 'rightUp' |
  'mouseMove' | 'wheel'

/** 地形切换请求 */
export interface TerrainSwitchRequest {
  /** 请求 ID */
  id: string
  /** 目标地形提供者 */
  provider: any
  /** 切换原因 */
  reason?: string
  /** 插件 ID */
  packageId: string
  /** 请求时间 */
  timestamp: number
}

/** CapabilityContext 对外暴露的能力 */
export interface CapabilityContext {
  /** Cesium Viewer 实例 */
  readonly viewer: any
  /** 主容器 DOM */
  readonly container: HTMLElement
  /** 插件 manifest */
  readonly manifest: CapabilityManifest
  /** 主题/业务配置 */
  readonly topicConfig?: Record<string, any>

  /** Entity 操作 */
  entities: {
    add: (options: any) => any
    remove: (entity: any) => void
    removeAll: () => void
    getById: (id: string) => any
  }

  /** DataSource 操作 */
  dataSources: {
    add: (dataSource: any) => Promise<any>
    remove: (dataSource: any) => void
    removeAll: () => void
  }

  /** 图层操作 */
  layers: {
    addImageryLayer: (provider: any, options?: any) => any
    remove: (layer: any) => void
    removeAll: () => void
    setVisibility: (layer: any, visible: boolean) => void
    move: (layer: any, index: number) => void
    setBaseLayer: (provider: any) => any
  }

  /** Primitive 操作 */
  primitives: {
    add: (primitive: any) => any
    remove: (primitive: any) => void
    removeAll: () => void
  }

  /** 地形操作 */
  terrain: {
    requestSwitch: (provider: any, reason?: string) => TerrainSwitchRequest
    getCurrentRequest: () => TerrainSwitchRequest | null
  }

  /** 相机操作 */
  camera: {
    flyTo: (options: any) => void
    getPosition: () => CameraPosition | null
    onChange: (handler: (pos: CameraPosition) => void, opts?: CameraChangeOpts) => Unsubscribe
  }

  /** 事件操作 */
  events: {
    onScreenSpace: (type: ScreenSpaceEventType, handler: (event: any) => void) => Unsubscribe
    offAll: () => void
  }

  /** HTTP 请求 */
  http: {
    get: <T = any>(url: string, params?: Record<string, any>) => Promise<T>
    post: <T = any>(url: string, body?: any) => Promise<T>
  }

  /** 通知 */
  notify: (msg: string, type?: 'success' | 'warning' | 'info' | 'error') => void
  /** 确认框 */
  confirm: (msg: string) => Promise<boolean>
  /** Loading 遮罩 */
  loading: (show: boolean) => void

  /** 事件总线 */
  emit: (event: string, payload?: any) => void
  on: (event: string, handler: (payload?: any) => void, opts?: { once?: boolean }) => Unsubscribe

  /** UI 能力 */
  ui: {
    createPanel: (opts: FloatingPanelOpts) => FloatingPanelHandle
  }

  /** 清理本插件资源 */
  cleanup: () => void
}

/** 插件包工厂函数 */
export type CapabilityFactory = (ctx: CapabilityContext) => CapabilityPackage | Promise<CapabilityPackage>

/** 已加载的插件包 */
export interface CapabilityPackage {
  /** 插件 manifest */
  manifest: CapabilityManifest
  /** 激活插件 */
  activate: (ctx: CapabilityContext) => Promise<void> | void
  /** 停用插件 */
  deactivate?: (ctx: CapabilityContext) => Promise<void> | void
  /** 销毁插件 */
  destroy?: (ctx: CapabilityContext) => Promise<void> | void
}

/** 注册/加载插件的源 */
export interface CapabilitySource {
  manifest: CapabilityManifest
  factory?: CapabilityFactory
  entry?: string
}

/** 激活态插件内部结构 */
export interface ActivePlugin {
  manifest: CapabilityManifest
  package: CapabilityPackage
  ctx: CapabilityContext
  panels: FloatingPanelHandle[]
  entities: any[]
  layers: any[]
  listeners: Unsubscribe[]
  state: 'active' | 'inactive' | 'error'
}

/** 插件宿主公共接口（用于跨组件传递，避免直接暴露 class 私有字段） */
export interface CapabilityHostLike {
  register(manifest: CapabilityManifest, factory: CapabilityFactory): void
  registerRemote(manifest: CapabilityManifest, entry: string): void
  activate(packageId: string): Promise<boolean>
  deactivate(packageId: string): Promise<boolean>
  destroy(packageId: string): Promise<boolean>
  toggle(packageId: string): Promise<boolean>
  isActive(packageId: string): boolean
  getRegisteredIds(): string[]
  getRegisteredManifests(): CapabilityManifest[]
  getManifest(packageId: string): CapabilityManifest | undefined
  getActiveIds(): string[]
  onActiveChange(handler: (e: ActiveChangeEvent) => void): Unsubscribe
  destroyAll(): Promise<void>
}

/** 激活状态变化事件 */
export interface ActiveChangeEvent {
  packageId: string
  active: boolean
  manifest: CapabilityManifest
}
