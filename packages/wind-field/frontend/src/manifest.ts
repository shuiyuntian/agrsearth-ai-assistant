/**
 * 文件作用：<pkg> 球端插件清单（CapabilityManifest，宿主工具条/面板注册用）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（复制后改 id/name/version，version 与包 VERSION 一致）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import type { CapabilityManifest } from '@cesiumai/sdk-types'

export const manifest: CapabilityManifest = {
  id: 'wind-field',
  name: '风场',
  version: '0.1.0',
  description: '风场可视化：网格风向箭头/粒子点渲染（含合成样例数据与管理页）',
  icon: 'Guide',
  config: {}
}

export type { CapabilityManifest }
