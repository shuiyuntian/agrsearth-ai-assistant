/**
 * 文件作用：config API 接口封装
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-08-09
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-08-09) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import request from '@/utils/request'
import type { AjaxResult } from '@/types'
import { API } from '../index'

/** AI 助手配置（llmApiKeyRef 已脱敏；enabledTools 为 null 表示契约全量） */
export interface AiAssistantConfig {
  llmBaseUrl?: string
  llmModel?: string
  llmApiKeyRef?: string
  agentMaxSteps?: number
  temperature?: number
  maxTokens?: number
  rateLimitRpm?: number
  codegenEnabled?: boolean
  enabledTools?: string[] | null
  /** 兼容两种形态：字符串数组（orchestrator 实际形态）或 {destructiveTools: []} */
  approvalPolicy?: string[] | { destructiveTools?: string[] } | null
}

// AI 助手管理 API 基础路径（经 RuoYi Gateway 转发至 ai-orchestrator /admin/**）
const BASE_URL = `${API.ADMIN_BASE}/admin`

// 查询 AI 助手配置（llmApiKeyRef 已脱敏）
export function getConfig(): Promise<AjaxResult<AiAssistantConfig>> {
  return request({
    url: BASE_URL + '/config',
    method: 'get'
  })
}

// 保存 AI 助手配置（部分字段，保存即热更）
export function updateConfig(data: Partial<AiAssistantConfig>): Promise<AjaxResult> {
  return request({
    url: BASE_URL + '/config',
    method: 'put',
    data: data
  })
}
