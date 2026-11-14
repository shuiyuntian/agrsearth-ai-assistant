/**
 * 文件作用：stats API 接口封装
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-08-09
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-08-09) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import request from '@/utils/request'
import type { AjaxResult, TableDataInfo } from '@/types'
import { API } from '../index'

/** 操作日志查询参数 */
export interface AiLogQuery {
  pageNum?: number
  pageSize?: number
  beginTime?: string
  endTime?: string
}

/** 操作日志记录 */
export interface AiLogItem {
  createdAt?: string
  kind?: string
  username?: string
  toolName?: string
  riskLevel?: string
  outcome?: string
  argsSummary?: string
  durationMs?: number
  promptTokens?: number
  completionTokens?: number
}

/** 汇总统计 */
export interface AiStatsSummary {
  requests?: number
  sessions?: number
  activeUsers?: number
  promptTokens?: number
  completionTokens?: number
  approvalRate?: number
  errorRate?: number
  avgDurationMs?: number
  p95DurationMs?: number
}

/** 工具调用统计 */
export interface AiToolStat {
  toolName?: string
  calls?: number
  successRate?: number
  avgDurationMs?: number
}

/** 时间范围参数 */
export interface TimeRangeParams {
  beginTime?: string
  endTime?: string
}

// AI 助手管理 API 基础路径（经 RuoYi Gateway 转发至 ai-orchestrator /admin/**）
const BASE_URL = `${API.ADMIN_BASE}/admin`

// 查询操作日志（分页，RuoYi TableDataInfo）
export function listLogs(query: AiLogQuery): Promise<TableDataInfo<AiLogItem[]>> {
  return request({
    url: BASE_URL + '/logs',
    method: 'get',
    params: query
  })
}

// 查询汇总统计（时间范围可选）
export function getStatsSummary(query: TimeRangeParams): Promise<AjaxResult<AiStatsSummary>> {
  return request({
    url: BASE_URL + '/stats/summary',
    method: 'get',
    params: query
  })
}

// 查询工具调用 TOPN
export function getStatsTools(topN?: number): Promise<AjaxResult<AiToolStat[]>> {
  return request({
    url: BASE_URL + '/stats/tools',
    method: 'get',
    params: { topN: topN || 10 }
  })
}
