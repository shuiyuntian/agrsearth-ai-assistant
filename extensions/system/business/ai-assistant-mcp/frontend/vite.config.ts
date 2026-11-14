/**
 * 文件作用：AI 助手球端前端构建配置（Vite Library：tool.es.js / tool.umd.js 双产物，宿主依赖全部 external）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-20
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-10-04) 改接 _shared/vite-config 公共配置（defineExtensionConfig），
 *                       纳入 host-contract 构建期硬校验（批4-P0）；external/globals/exports=named 语义与手写版一致
 *   - 1.0.0 (2026-07-20) 初始创建（手写 defineConfig）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { defineExtensionConfig } from '@agrsearth/vite-config'

export default defineExtensionConfig({
  entry: './src/index.ts',
  name: 'Capability_ai_assistant_mcp',
  exports: 'named',
  cssFileName: 'tool.css',
  packageId: 'ai-assistant-mcp'
})
