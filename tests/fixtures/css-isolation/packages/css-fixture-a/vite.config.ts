// 文件作用：CSS 隔离测试夹具 A 的 Vite 构建配置
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-13
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-13) B1 测试夹具
// 版权所有 (C) 2026 AGRSEarth 项目

import { defineExtensionConfig } from '@agrsearth/vite-config'

export default defineExtensionConfig({
  entry: './src/index.ts',
  name: 'Capability_css_fixture_a',
  exports: 'named',
  cssFileName: 'tool.css',
  packageId: 'css-fixture-a'
})
