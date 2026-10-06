/**
 * 文件作用：admin-ui 构建配置（管理端远程页产物 admin.*.js，宿主依赖经 import map 共享）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（公共配置经 @cesiumai/vite-config/admin 子路径导出）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import { defineAdminUiConfig } from '@cesiumai/vite-config/admin'

export default defineAdminUiConfig({
  entry: './src/index.ts',
  // 与宿主 AdminRemoteLoader 的 UMD 读取约定一致：AdminUI_<packageId 去非字母数字>
  name: 'AdminUI_windfield',
  exports: 'named'
})
