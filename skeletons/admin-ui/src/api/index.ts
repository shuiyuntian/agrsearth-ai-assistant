/**
 * 文件作用：管理页后端 URL 契约常量表（业务代码只引用 API，不散落服务路径字面量）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-11-05
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-11-05) 骨架内置 URL 单源契约（issue #5/#6）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

const SVC = '/example-server'

export const API = {
  exampleList: `${SVC}/example/list`
} as const
