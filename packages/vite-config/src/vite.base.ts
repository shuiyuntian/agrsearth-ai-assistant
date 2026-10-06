/**
 * 文件作用：能力包公共 Vite Library 配置（球端面板产物 tool.*.js，模板仓 vendored 共享包 @cesiumai/vite-config）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-10-04) 同步平台仓 _shared 1.1.0：接入 host-contract 构建期硬校验（契约取本包
 *                       contracts/ vendored 快照，须随平台 host-contract.json 升级同步）
 *   - 1.0.0 (2026-09-14) 自平台仓 extensions/_shared/vite-config vendor：改包名 @cesiumai/vite-config，
 *                       用法示例由相对路径改为 workspace 包引用，external/globals 约定同源
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 *
 * 扩展包的 vite.config.ts 中这样使用：
 *
 *   import { defineExtensionConfig } from '@cesiumai/vite-config'
 *   export default defineExtensionConfig({ entry: './src/index.ts', name: 'Capability_example' })
 *
 * 加载机制：Vite 加载 vite.config.ts 时 packages:'external' 由 Node 直接 import 本包，
 * 因此入口为 esbuild 预编译产物 dist/*.js（npm run build 生成，types 指向 src/*.ts 源）。
 */
import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { assertHostContract } from './host-contract.js'

export interface ExtensionConfigOptions {
  /** 库入口文件 */
  entry: string
  /** UMD 全局变量名 */
  name: string
  /** 构建输出目录 */
  outDir?: string
  /** 额外的 external 依赖 */
  extraExternals?: string[]
  /** 额外的 UMD globals 映射（与 extraExternals 配合，如 { 'opencc-js': 'OpenCC' }） */
  extraGlobals?: Record<string, string>
  /** 追加的 resolve.alias */
  alias?: Record<string, string>
  /** rollup output.exports；默认不设置（仅默认导出时自动为 'default'，UMD 全局即导出实例本身） */
  exports?: 'named' | 'default'
  /** 附加 Vite 配置 */
  overrides?: UserConfig
}

export function defineExtensionConfig(options: ExtensionConfigOptions) {
  const { entry, name, outDir = 'dist', extraExternals = [], extraGlobals = {}, alias = {}, exports, overrides = {} } = options

  // 构建期硬校验（批4-P0）：扩展声明的共享依赖区间必须是球端宿主 host-contract 接受范围的子集
  assertHostContract('gis-platform-ui')

  return defineConfig({
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(process.cwd(), 'src'),
        ...alias,
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: resolve(process.cwd(), entry),
        formats: ['es', 'umd'],
        fileName: (format) => `tool.${format}.js`,
        name,
      },
      rollupOptions: {
        external: [
          'vue',
          'vue-router',
          'pinia',
          'element-plus',
          '@element-plus/icons-vue',
          'cesium',
          'echarts',
          ...extraExternals,
        ],
        output: {
          ...(exports ? { exports } : {}),
          globals: {
            vue: 'Vue',
            'vue-router': 'VueRouter',
            pinia: 'Pinia',
            'element-plus': 'ElementPlus',
            '@element-plus/icons-vue': 'ElementPlusIconsVue',
            cesium: 'Cesium',
            echarts: 'echarts',
            ...extraGlobals,
          },
        },
      },
    },
    ...overrides,
  })
}
