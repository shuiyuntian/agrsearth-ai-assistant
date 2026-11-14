/**
 * 文件作用：AI 助手扩展共享类型出口
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-20
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-11-14) 独立仓迁移：宿主能力类型统一使用 @agrsearth/sdk-types
 *   - 1.0.0 (2026-07-20) 本地 CapabilityContext 子集，避免依赖平台源码路径
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import type { CapabilityContext } from '@agrsearth/sdk-types'

export type {
  CapabilityManifest,
  CapabilityPackage,
  FloatingPanelHandle,
  FloatingPanelOpts
} from '@agrsearth/sdk-types'

export type CapabilityContextLike = CapabilityContext
