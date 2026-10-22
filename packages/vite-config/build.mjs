// 文件作用：@agrsearth/vite-config 包构建脚本（TS 源码 → Node 可加载的 ESM 产物 dist/）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-09-14
// 版本：1.1.0
// 修改记录：
//   - 1.0.0 (2026-09-14) 初始版本：esbuild 单文件转译（不打包，依赖保留 import 由消费方解析）
//   - 1.1.0 (2026-10-22) 收编进平台仓 packages/（扁平布局，入口自 src/ 改仓根平铺）；
//                        背景不变：Vite 5 加载 vite.config.ts 时 packages:'external'，
//                        Node 直接 import 本包，TS 源码不能直接被 Node ESM 加载
//                        （ERR_UNKNOWN_FILE_EXTENSION），故预编译为 dist/*.js；
//                        types 仍指向平铺 .ts 源，编辑器/类型检查不受影响
// 版权所有 (C) 2026 AGRSEarth 项目

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [
    resolve(here, 'vite.base.ts'),
    resolve(here, 'vite.admin.base.ts'),
    resolve(here, 'host-contract.js')
  ],
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outdir: resolve(here, 'dist'),
  outExtension: { '.js': '.js' }
})

console.log('[vite-config] dist/ 构建完成（vite.base.js / vite.admin.base.js / host-contract.js）')
