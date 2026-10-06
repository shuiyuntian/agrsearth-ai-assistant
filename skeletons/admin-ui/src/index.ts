/**
 * 文件作用：<pkg> 管理端远程页面入口（ADR-007 契约：导出 { manifest, adminViews }）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（复制后改 manifest.id/name/version，adminViews 键与菜单 viewPath 对齐）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import ExampleIndex from './views/example/index.vue'

export const manifest = {
  id: 'example-tool',
  name: '示例工具（管理页）',
  version: '0.1.0'
}

export const adminViews = {
  'example/index': ExampleIndex
}

export default { manifest, adminViews }
