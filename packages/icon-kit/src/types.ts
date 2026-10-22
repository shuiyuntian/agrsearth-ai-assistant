/**
 * 文件作用：types 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-08-08
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-08-08) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * icon-kit 类型与引用判定
 *
 * 图标引用三种形态：
 * - EP 图标名（如 'Location'）：走 @element-plus/icons-vue 本地组件
 * - iconlib:<instanceId>：icon-library 实例副本引用（正式使用）
 * - calcite:<name>：icon-library 库图标引用（开发期预览）
 */

/** 图标引用（EP 图标名 / iconlib: 引用 / calcite: 引用 / URL） */
export type IconRef = string

/** icon-library 实例副本引用前缀 */
export const ICONLIB_PREFIX = 'iconlib:'

/** calcite 库图标引用前缀（开发期预览用） */
export const CALCITE_PREFIX = 'calcite:'

/** 判断是否为 icon-library 实例副本引用（iconlib:<instanceId>） */
export function isIconLibRef(name?: string | null): boolean {
  return typeof name === 'string' && name.startsWith(ICONLIB_PREFIX)
}

/** 判断是否为 calcite 库图标引用（calcite:<name>） */
export function isCalciteRef(name?: string | null): boolean {
  return typeof name === 'string' && name.startsWith(CALCITE_PREFIX)
}
