/**
 * 文件作用：工具轨能力包前端构建配置（Vite Library：ESM + UMD 双产物，宿主依赖全部 external）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（公共配置经 @cesiumai/vite-config workspace 包引入）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import { defineExtensionConfig } from '@cesiumai/vite-config'

export default defineExtensionConfig({
  entry: './src/index.ts',
  // UMD 全局变量名：Capability_<pkg-id 去中划线>，全局唯一（如 Capability_myTool）
  name: 'Capability_wind_field',
  exports: 'named'
})
