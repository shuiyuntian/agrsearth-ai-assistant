/**
 * 文件作用：模块入口文件
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-08-26
 * 版本：1.0.1
 * 修改记录：
 *   - 1.0.1 (2026-10-05) 包更名收口 ai-assistant→ai-assistant-mcp：入口注释同步新名
 *                       （remote 组件前缀实为 remote:ai-assistant-mcp/<key>，修正旧笔误）
 *   - 1.0.0 (2026-08-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * ai-assistant-mcp 管理端远程页面入口（管理面远程化，ADR-007）
 * 契约：导出 adminViews 视图映射，键 = 菜单 component 中 remote:ai-assistant-mcp/<key> 的 <viewPath>
 */
import ConfigView from './views/config.vue'
import DashboardView from './views/dashboard.vue'

export const manifest = {
  id: 'ai-assistant-mcp',
  name: 'AI 助手管理',
  version: '2.1.4'
}

export const adminViews = {
  'config': ConfigView,
  'dashboard': DashboardView
}

export default { manifest, adminViews }
