/**
 * 文件作用：vitest.config 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
