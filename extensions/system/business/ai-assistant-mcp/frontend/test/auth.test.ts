/**
 * 文件作用：auth.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * auth（RuoYi Admin-Token Cookie 读取）单元测试
 * @description node 环境无 document：每个用例以 vi.stubGlobal 注入 document.cookie stub，
 * 不引入 happy-dom/jsdom。覆盖：无 cookie / 无 Admin-Token / 正常取值 / 多 cookie 混杂 /
 * URL 编码值 / 非法编码回退 / 前缀名防护（XAdmin-Token）/ 值含 = 号 / authHeaders 头构造。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { authHeaders, getAdminToken } from '../src/api/auth'

function stubCookie(cookie: string) {
  vi.stubGlobal('document', { cookie })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getAdminToken', () => {
  it('空 cookie → null', () => {
    stubCookie('')
    expect(getAdminToken()).toBeNull()
  })

  it('有其他 cookie 但无 Admin-Token → null', () => {
    stubCookie('foo=bar; session=xyz')
    expect(getAdminToken()).toBeNull()
  })

  it('单个 Admin-Token cookie → 取值', () => {
    stubCookie('Admin-Token=abc123')
    expect(getAdminToken()).toBe('abc123')
  })

  it('多 cookie 混杂（Admin-Token 在中间，前有空格分隔）→ 正确取值', () => {
    stubCookie('foo=1; Admin-Token=tok-mid; bar=2')
    expect(getAdminToken()).toBe('tok-mid')
  })

  it('Admin-Token 在首位（^ 边界）→ 正确取值', () => {
    stubCookie('Admin-Token=tok-first; foo=1')
    expect(getAdminToken()).toBe('tok-first')
  })

  it('URL 编码值 → decodeURIComponent 解码', () => {
    stubCookie('Admin-Token=abc%40def%3D')
    expect(getAdminToken()).toBe('abc@def=')
  })

  it('非法编码值 → 回退原始字符串不抛错', () => {
    stubCookie('Admin-Token=%E0%A4%A')
    expect(getAdminToken()).toBe('%E0%A4%A')
  })

  it('前缀名防护：XAdmin-Token 不匹配，取真正的 Admin-Token', () => {
    stubCookie('XAdmin-Token=bad; Admin-Token=good')
    expect(getAdminToken()).toBe('good')
  })

  it('值含 = 号（如 base64 padding）→ 完整取到分号前', () => {
    stubCookie('Admin-Token=dG9rZW49; foo=1')
    expect(getAdminToken()).toBe('dG9rZW49')
  })
})

describe('authHeaders', () => {
  it('有登录态 → { Authorization: "Bearer <token>" }', () => {
    stubCookie('Admin-Token=tok-789')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer tok-789' })
  })

  it('无登录态 → {}（由调用方按 401 语义呈现）', () => {
    stubCookie('foo=bar')
    expect(authHeaders()).toEqual({})
  })

  it('URL 编码 token 同样解码后入头', () => {
    stubCookie('Admin-Token=a%2Bb')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer a+b' })
  })
})
