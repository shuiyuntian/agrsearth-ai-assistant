/**
 * 文件作用：风场插件本地类型（样例数据结构 + CapabilityContext 取用子集声明）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本（样例数据契约与 assets/wind-sample.json 同构；
 *     CapabilityContextLike 沿用骨架最小子集声明模式）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */

/** 风场样例网格元信息 */
export interface WindSampleMeta {
  /** 数据集名称 */
  name: string
  /** 数据来源说明 */
  source: string
  /** 数据生效时间（ISO 8601，北京时间） */
  validTime: string
  /** u/v 分量单位 */
  unit: 'm/s'
  /** 经纬度网格定义 */
  grid: {
    nx: number
    ny: number
    lonMin: number
    latMin: number
    lonMax: number
    latMax: number
    step: number
  }
  /** 全场风速范围 [min, max]（m/s） */
  speedRange: [number, number]
}

/** 风场样例数据（u/v 均为 row-major 二维数组：[lat 索引][lon 索引]） */
export interface WindSample {
  meta: WindSampleMeta
  u: number[][]
  v: number[][]
}

/** 渲染统计（面板展示用） */
export interface WindLayerStats {
  pointCount: number
  minSpeed: number
  maxSpeed: number
  avgSpeed: number
}

/** CapabilityContext 最小子集（按本插件实际用到的能力裁剪） */
export interface CapabilityContextLike {
  readonly viewer: any
  readonly container: HTMLElement
  readonly manifest: { id: string; name: string; version: string; [k: string]: any }
  readonly http: {
    get: <T = any>(url: string, params?: Record<string, any>) => Promise<T>
    post: <T = any>(url: string, body?: any) => Promise<T>
  }
  readonly camera: {
    flyTo: (options: any) => void
  }
  readonly entities: {
    add: (options: any) => any
    remove: (entity: any) => void
    removeAll: () => void
    getById: (id: string) => any
  }
  readonly ui: {
    createPanel: (options: any) => any
  }
  readonly notify: (msg: string, type?: 'success' | 'warning' | 'info' | 'error') => void
}
