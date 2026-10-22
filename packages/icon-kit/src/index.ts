/**
 * 文件作用：模块入口文件
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-08-08
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-08-08) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

export { default as AppIcon } from './AppIcon.vue'
export type { IconRef } from './types'
export { ICONLIB_PREFIX, CALCITE_PREFIX, isIconLibRef, isCalciteRef } from './types'
export { resolveIconUrl, setIconLibraryBaseUrl } from './resolve'
export type { ResolveIconUrlOptions } from './resolve'
