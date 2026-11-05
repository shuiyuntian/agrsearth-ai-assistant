/**
 * 文件作用：风场演示管理页后端 URL 契约常量表
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-11-05
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-11-05) 演示包迁移至 URL 单源契约
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

const SVC = '/wind-field-demo-server'

export const API = {
  sampleMeta: `${SVC}/wind/sample-meta`,
  serviceInfo: `${SVC}/info`
} as const
