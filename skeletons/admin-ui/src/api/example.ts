/**
 * 文件作用：示例 API 封装（经宿主 '@/utils/request' 别名桥，token/401/防重全继承）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-11-05) URL 收敛至 src/api/index.ts 常量表（issue #5/#6）
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（baseURL 由宿主 request 注入，路径带网关路由前缀）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import request from '@/utils/request'
import { API } from './index'

/** 查询示例列表（响应 { rows, total } 由宿主 request 拦截器解包后直接返回） */
export function listExample(query: Record<string, any>) {
  return request({
    url: API.exampleList,
    method: 'get',
    params: query
  })
}
