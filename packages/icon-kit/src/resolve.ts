/**
 * 文件作用：resolve 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-08-08
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-08-08) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * icon-library 图标 URL 解析
 *
 * 后端 API 契约（base = /icon-library/api/v1）：
 * - GET /instances/{id}.svg                → 实例副本 SVG（image/svg+xml）
 * - GET /icons/by-name/{name}/svg?size=&variant= → 库图标原文 SVG
 */
import { ICONLIB_PREFIX, CALCITE_PREFIX, isIconLibRef, isCalciteRef } from './types'

/** 默认 API base（生产经网关 Path=/icon-library/** 路由；本地 dev 走 vite proxy） */
const DEFAULT_BASE_URL = '/icon-library/api/v1'

let baseUrl = DEFAULT_BASE_URL

/** 覆盖全局 icon-library API base（传入值末尾斜杠会被去除） */
export function setIconLibraryBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '')
}

export interface ResolveIconUrlOptions {
  /** 图标尺寸（透传后端 size 参数，仅 calcite: 引用有效） */
  size?: number | string
  /** 图标变体（透传后端 variant 参数，仅 calcite: 引用有效） */
  variant?: string
  /** 本次调用的 API base 覆盖（优先级高于 setIconLibraryBaseUrl 的全局值） */
  baseUrl?: string
}

/**
 * 解析图标引用为可 fetch 的 SVG URL。
 * - iconlib:<id>   → `${base}/instances/${id}.svg`
 * - calcite:<name> → `${base}/icons/by-name/calcite-${name}/svg?size=&variant=`
 *   （库内 calcite 资产名统一带 `calcite-` 前缀；name 已带前缀时原样使用）
 * - 其余（EP 图标名等）返回 null，表示走本地 EP 组件渲染
 */
export function resolveIconUrl(name: string, opts?: ResolveIconUrlOptions): string | null {
  if (!name) return null
  const base = (opts?.baseUrl ?? baseUrl).replace(/\/+$/, '')

  if (isIconLibRef(name)) {
    const id = name.slice(ICONLIB_PREFIX.length)
    if (!id) return null
    return `${base}/instances/${encodeURIComponent(id)}.svg`
  }

  if (isCalciteRef(name)) {
    const rawName = name.slice(CALCITE_PREFIX.length)
    if (!rawName) return null
    // 库内 calcite 资产名统一带 calcite- 前缀；允许调用方写全名或短名
    const iconName = rawName.startsWith('calcite-') ? rawName : `calcite-${rawName}`
    const params = new URLSearchParams()
    if (opts?.size !== undefined && opts?.size !== null && opts?.size !== '') {
      params.set('size', String(opts.size))
    }
    if (opts?.variant) {
      params.set('variant', opts.variant)
    }
    const query = params.toString()
    return `${base}/icons/by-name/${encodeURIComponent(iconName)}/svg${query ? `?${query}` : ''}`
  }

  return null
}
