/**
 * 文件作用：admin-ui 构建配置（管理端远程页产物 admin.*.js，宿主依赖经 import map 共享）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.1
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（公共配置经 @agrsearth/vite-config/admin 子路径导出）
 *   - 1.0.1 (2026-10-06) exports 置 named：入口同时 export default + export { manifest, adminViews }，
 *     named 模式消除 Vite「named and default exports together」警告；宿主 AdminRemoteLoader
 *     按 mod.adminViews ?? mod.default.adminViews 读取，行为不变
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { defineAdminUiConfig } from '@agrsearth/vite-config/admin'

export default defineAdminUiConfig({
  entry: './src/index.ts',
  // 与宿主 AdminRemoteLoader 的 UMD 读取约定一致：AdminUI_<packageId 去非字母数字>
  name: 'AdminUI_example',
  exports: 'named'
})
