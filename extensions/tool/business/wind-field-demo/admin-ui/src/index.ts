/**
 * 文件作用：风场管理端远程页面入口（ADR-007 契约：导出 { manifest, adminViews }；
 *          adminViews 键与 data/menu.json 的 remote:<packageId>/<viewPath> 一致）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本（视图键 windfield/index 对齐菜单 viewPath）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import WindFieldIndex from './views/windfield/index.vue'

export const manifest = {
  id: 'wind-field-demo',
  name: '风场（管理页）',
  version: '0.1.0'
}

export const adminViews = {
  'windfield/index': WindFieldIndex
}

export default { manifest, adminViews }
