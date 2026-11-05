/**
 * 文件作用：风场管理页 API 封装（经宿主 '@/utils/request' 别名桥，token/401/防重全继承；
 *          路径带网关路由前缀 /<serviceId>，与 manifest.backendServices[].apiPrefix 一致）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-11-05) URL 收敛至 src/api/index.ts 常量表
 *   - 1.0.0 (2026-10-06) 风场插件初始版本（/wind/sample-meta 样例数据元信息）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import request from '@/utils/request'
import { API } from './index'

/** 样例数据元信息（与后端 /wind/sample-meta 响应一致） */
export interface WindSampleMeta {
  name: string
  source: string
  validTime: string
  unit: string
  grid: {
    nx: number
    ny: number
    lonMin: number
    latMin: number
    lonMax: number
    latMax: number
    step: number
  }
  speedRange: [number, number]
}

/** 后端服务信息（/info 自检端点） */
export interface WindServiceInfo {
  service: string
  extension: string
  version: string
  time: string
}

/** 查询风场样例数据元信息（响应经宿主拦截器解包后直接返回 data） */
export function getSampleMeta() {
  return request({
    url: API.sampleMeta,
    method: 'get'
  }) as Promise<WindSampleMeta>
}

/** 后端服务自检 */
export function getServiceInfo() {
  return request({
    url: API.serviceInfo,
    method: 'get'
  }) as Promise<WindServiceInfo>
}
