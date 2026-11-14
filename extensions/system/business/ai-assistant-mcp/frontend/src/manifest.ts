/**
 * 文件作用：AI 助手插件清单
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-12
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-07-20) 迁移到 extensions/ai-assistant/frontend：CapabilityManifest 改为本地定义，不依赖宿主
 *   - 1.0.0 (2026-07-12) 从 gis/index.vue 硬编码迁移为 CapabilityHost 插件
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import type { CapabilityManifest } from './types'

export const manifest: CapabilityManifest = {
  id: 'ai-assistant-mcp',
  name: 'GIS AI 助手',
  version: '2.1.4',
  description: '基于 MCP 的自然语言 GIS 助手，支持飞到某地、添加标记、查询 POI 等操作',
  icon: 'ChatDotRound',
  // AI 助手入口固定在右下角悬浮按钮，不在右侧工具栏中显示
  hiddenInToolbar: true,
  config: {
    // ai-orchestrator 基础地址：宿主部署（18880/本地 vite dev）经 nginx /dev-api 段代理到网关；
    // 联调 harness 以 location.origin 覆盖直连 orchestrator
    orchestratorBaseUrl: '/dev-api/ai/agent',
    // /channel/result 独立回传源：'auto' = 按当前访问主机推导网关 18801（双环境 同一产物通用，
    // 规避 18880 同源请求排队突破 MCP 10s 命令超时；网关已对 /ai/agent/** 放行 18880 跨域）
    channelResultBaseUrl: 'auto',
    // 启用工具白名单：缺省/空数组 = 全量启用（契约 45 工具名 + codegen，见 src/executors/enabled-tools.ts）；
    // 生产以 extensions/system/business/ai-assistant-mcp/manifest.json defaultConfig 的显式 45 清单为准（不含 cesium_execute_code = codegen 默认关闭）
    enabledTools: []
  }
}
