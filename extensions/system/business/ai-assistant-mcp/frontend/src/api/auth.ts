/**
 * 文件作用：RuoYi 登录 Token 读取（扩展包自包含实现）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) P4-C：开发测试环境 网关对 /ai/agent/** 强制鉴权（RuoYi AuthFilter 只认
 *                       Authorization: Bearer 头，不认 Cookie），扩展包无法 import 宿主
 *                       utils/auth，按同一约定自读 Cookie 中的 Admin-Token。
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/** Token 在 Cookie 中的键名（与宿主 gis-platform-ui utils/auth 及 RuoYi 保持一致） */
const TOKEN_KEY = 'Admin-Token'

/**
 * 从 Cookie 读取 RuoYi 登录 Token
 * @description 与宿主 utils/auth.getToken 同一约定（同域 SSO；Cookie 非 HttpOnly，JS 可读）
 * @returns string | null 登录 Token，不存在返回 null
 */
export function getAdminToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|\\s)${TOKEN_KEY}=([^;]+)`))
  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  return null
}

/**
 * 构造鉴权请求头
 * @description 有登录态 → { Authorization: 'Bearer <token>' }；无登录态 → {}（请求将以 401 失败，
 * 由调用方按 401 语义呈现，不把 /ai/agent/** 加回网关白名单——方案明确否定）
 * @returns 请求头对象
 */
export function authHeaders(): Record<string, string> {
  const token = getAdminToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
