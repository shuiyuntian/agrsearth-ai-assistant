/**
 * 文件作用：风场面板控制器（响应式状态 + 图层开关回调；面板组件与入口 index.ts 之间的薄桥，
 *          避免面板直接持有 ctx）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { reactive } from 'vue'
import type { WindLayerStats } from '../types'

export interface WindFieldController {
  /** 图层是否可见（面板开关状态） */
  layerVisible: boolean
  /** 图层切换进行中（重渲染箭头） */
  busy: boolean
  /** 数据生效时间（展示用原文） */
  validTimeLabel: string
  /** 网格描述（如 13×13 · 步长 0.5°） */
  gridLabel: string
  /** 经纬度范围描述 */
  boundsLabel: string
  /** 图例最大值（m/s） */
  legendMax: number
  /** 数据来源说明 */
  sourceLabel: string
  /** 渲染统计（null = 未渲染） */
  stats: WindLayerStats | null
  /** 图层开关回调（由入口注入，内部做 removeAll/重渲染） */
  toggleLayer: (visible: boolean) => void
}

/** 创建控制器（入口 activate 时调用一次） */
export function createWindFieldController(toggleLayer: (visible: boolean) => void): WindFieldController {
  return reactive({
    layerVisible: true,
    busy: false,
    validTimeLabel: '-',
    gridLabel: '-',
    boundsLabel: '-',
    legendMax: 10,
    sourceLabel: '',
    stats: null,
    toggleLayer
  }) as WindFieldController
}
