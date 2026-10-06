/**
 * 文件作用：管理端远程扩展页运行时契约（模板仓 vendored 共享包 @cesiumai/admin-sdk）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 自平台仓 extensions/_shared/admin-sdk vendor：包名改为 @cesiumai/admin-sdk
 *                       （内容同源；管理面远程化 ADR-007）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 *
 * 远程管理页（admin-ui/）经 import map 与宿主共享运行时：
 * - request（axios 实例，含 token/401/防重）由 import map 别名 '@/utils/request' 直接桥接，
 *   页面源码 import request from '@/utils/request' 原样可用，无需经本包；
 * - 本包提供新代码用的显式访问器与运行时环境读取（替代编译期 import.meta.env 烘焙）。
 */

/** 宿主暴露的 request 模块形态（main.ts: window.__AdminRequestModule） */
interface AdminRequestModule {
  default: any
  download: (url: string, params: any, filename: string, config?: any) => Promise<any>
}

function adminRequestModule(): AdminRequestModule {
  const mod = (window as any).__AdminRequestModule as AdminRequestModule | undefined
  if (!mod) {
    throw new Error('[admin-sdk] window.__AdminRequestModule 未就绪（页面须在 ruoyi-admin 宿主内运行）')
  }
  return mod
}

/** 宿主 axios 实例（baseURL=VITE_APP_BASE_API，含 Bearer token/401 重登/防重复提交拦截） */
export function getAdminRequest(): any {
  return adminRequestModule().default
}

/** 宿主通用下载方法（blob + file-saver） */
export function adminDownload(url: string, params: any, filename: string, config?: any): Promise<any> {
  return adminRequestModule().download(url, params, filename, config)
}

/** 宿主 API 前缀（/dev-api | /prod-api | /stage-api），运行时注入，替代 import.meta.env 烘焙 */
export function getBaseApi(): string {
  const env = (window as any).__adminEnv
  if (!env?.baseApi) {
    throw new Error('[admin-sdk] window.__adminEnv 未就绪（页面须在 ruoyi-admin 宿主内运行）')
  }
  return env.baseApi
}

/* ---------- 通用 API 类型契约（与宿主 src/types/api/common.ts 对齐） ---------- */

/** API 通用响应类型 */
export interface AjaxResult<T = any> {
  code: number
  msg: string
  data?: T
}

/** API 表格响应类型 */
export interface TableDataInfo<T = any> {
  code: number
  msg: string
  total: number
  rows: T[]
}

/** 分页参数类型 */
export interface PageDomain {
  pageNum?: number
  pageSize?: number
  orderByColumn?: string
  isAsc?: string
  reasonable?: boolean
}

/** Entity 基类 */
export interface BaseEntity {
  searchValue?: any
  createBy?: any
  createTime?: string
  updateBy?: any
  updateTime?: string
  remark?: string
  params?: Record<string, any>
}
