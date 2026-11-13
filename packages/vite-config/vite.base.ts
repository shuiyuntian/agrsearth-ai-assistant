/**
 * 文件作用：vite.base 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-13
 * 版本：1.3.0
 * 修改记录：
 *   - 1.3.0 (2026-11-13) 新能力包 packageId opt-in：本包 Tailwind、CSS 包级作用域与 Preflight 防护
 *   - 1.2.0 (2026-11-08) 支持显式 cssFileName，避免球端与管理端随包 CSS 平铺重名
 *   - 1.1.0 (2026-10-04) 构建期共享依赖契约硬校验：配置定义即调 assertHostContract('gis-platform-ui')，
 *                       扩展声明的共享依赖区间不满足球端 host-contract.json 即构建失败（批4-P0）
 *   - 1.0.0 (2026-07-13) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * 能力包公共 Vite Library 配置
 *
 * 扩展包的 vite.config.ts 中这样使用：
 *
 *   import { defineExtensionConfig } from '../../../../../packages/vite-config/vite.base'
 *   export default defineExtensionConfig({ entry: './src/index.ts', name: 'Twwater' })
 */
import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from 'tailwindcss'
import { resolve } from 'path'
import { assertHostContract } from './host-contract.js'
import { createExtensionCssScopePlugin, createExtensionCssSourceGuard } from './css-scope.js'

export interface ExtensionConfigOptions {
  /** 库入口文件 */
  entry: string
  /** UMD 全局变量名 */
  name: string
  /** 构建输出目录 */
  outDir?: string
  /** 随包 CSS 文件名；默认 style.css，与管理端共存时应改为 tool.css 等包内唯一值 */
  cssFileName?: string
  /** 新能力包包 ID；传入后启用本包 Tailwind 编译和 data-cap-package CSS 作用域 */
  packageId?: string
  /** 额外的 external 依赖 */
  extraExternals?: string[]
  /** 额外的 UMD globals 映射（与 extraExternals 配合，如 { 'opencc-js': 'OpenCC' }） */
  extraGlobals?: Record<string, string>
  /** 追加的 resolve.alias（如 '@shared/ui-utils' 指向共享源码） */
  alias?: Record<string, string>
  /** rollup output.exports；默认不设置（仅默认导出时自动为 'default'，UMD 全局即导出实例本身） */
  exports?: 'named' | 'default'
  /** 附加 Vite 配置 */
  overrides?: UserConfig
}

export function defineExtensionConfig(options: ExtensionConfigOptions) {
  const {
    entry,
    name,
    outDir = 'dist',
    cssFileName = 'style.css',
    packageId,
    extraExternals = [],
    extraGlobals = {},
    alias = {},
    exports,
    overrides = {}
  } = options

  // 构建期硬校验（批4-P0）：扩展声明的共享依赖区间必须是球端宿主 host-contract.json 接受范围的子集
  assertHostContract('gis-platform-ui')

  const { css: overrideCss, ...restOverrides } = overrides
  let css = overrideCss
  if (packageId) {
    if (typeof overrideCss?.postcss === 'string') {
      throw new Error('启用 packageId 后不支持外部 postcss 配置文件，请在 overrides.css.postcss 中显式合并插件')
    }
    const overridePostcss = overrideCss?.postcss
    const contentRoot = resolve(process.cwd(), 'src').replace(/\\/g, '/')
    css = {
      ...overrideCss,
      postcss: {
        ...overridePostcss,
        plugins: [
          tailwindcss({
            content: [`${contentRoot}/**/*.{vue,js,ts,jsx,tsx}`],
            corePlugins: { preflight: false },
            theme: { extend: {} },
            plugins: []
          }),
          createExtensionCssScopePlugin(packageId),
          ...(overridePostcss?.plugins ?? [])
        ]
      }
    }
  }

  return defineConfig({
    plugins: [vue(), ...(packageId ? [createExtensionCssSourceGuard(packageId)] : [])],
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
          assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css')
            ? cssFileName
            : 'assets/[name]-[hash][extname]',
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
    ...(css ? { css } : {}),
    ...restOverrides,
  })
}
