/**
 * 文件作用：管理端远程扩展页（admin-ui）公共 Vite Library 配置（模板仓 vendored 共享包 @agrsearth/vite-config/admin）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.1.1
 * 修改记录：
 *   - 1.1.1 (2026-10-06) AdminUiConfigOptions 增加 exports 透传（对齐球端 vite.base.ts 的同名
 *                       选项）：骨架入口为 named+default 混合导出，named 模式消除 Vite 警告，
 *                       宿主 AdminRemoteLoader 双兼容读取不受影响
 *   - 1.1.0 (2026-10-04) 同步平台仓 _shared 1.1.0：接入 host-contract 构建期硬校验（契约取本包
 *                       contracts/ vendored 快照）；补齐 marked external/globals（修与 _shared 的漂移）
 *   - 1.0.0 (2026-09-14) 自平台仓 extensions/_shared/vite-config vendor：改包名
 *                       @agrsearth/vite-config（admin 子路径导出），用法示例改 workspace 包引用
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 *
 * 扩展包的 admin-ui/vite.config.ts 中这样使用：
 *
 *   import { defineAdminUiConfig } from '@agrsearth/vite-config/admin'
 *   export default defineAdminUiConfig({ entry: './src/index.ts', name: 'AdminUI_example' })
 *
 * 加载机制：同 vite.base.ts——Node 直接 import 本包，入口为 esbuild 预编译产物 dist/*.js。
 *
 * 与球平台 vite.base.ts 的差异：
 * - 产物文件名 admin.es.js / admin.umd.js（球平台为 tool.*.js）
 * - external 增加 '@/utils/request'、'@/utils/iconlib'（经宿主 import map 别名桥接，源码零改写）
 * - 内置 unplugin-auto-import（vue/vue-router/pinia，复刻宿主隐式注入）与
 *   unplugin-vue-setup-extend-plus（<script setup name> → keep-alive 缓存匹配）
 * 注意：本文件被各扩展 vite.config.ts import，裸导入的插件包由 vite 配置打包后
 * 从扩展自身 node_modules 解析——admin-ui/package.json 必须声明
 * unplugin-auto-import / unplugin-vue-setup-extend-plus 为 devDependencies（骨架已内置）。
 */
import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import VueSetupExtend from 'unplugin-vue-setup-extend-plus/vite'
import { resolve } from 'path'
import { assertHostContract } from './host-contract.js'

export interface AdminUiConfigOptions {
  /** 库入口文件 */
  entry: string
  /** UMD 全局变量名（约定 AdminUI_<packageId 去非字母数字>，与宿主 AdminRemoteLoader 读取一致） */
  name: string
  /** 构建输出目录 */
  outDir?: string
  /** 额外的 external 依赖 */
  extraExternals?: string[]
  /** 额外的 UMD globals 映射 */
  extraGlobals?: Record<string, string>
  /** 追加的 resolve.alias */
  alias?: Record<string, string>
  /** rollup output.exports；默认不设置（仅默认导出时自动为 'default'）。骨架入口同时导出
   *  命名成员（manifest/adminViews）与默认导出，named 模式消除 Vite「named and default exports
   *  together」警告；宿主 AdminRemoteLoader 按 mod.adminViews ?? mod.default.adminViews 双兼容读取 */
  exports?: 'named' | 'default'
  /** 附加 Vite 配置 */
  overrides?: UserConfig
}

export function defineAdminUiConfig(options: AdminUiConfigOptions) {
  const { entry, name, outDir = 'dist', extraExternals = [], extraGlobals = {}, alias = {}, exports, overrides = {} } = options

  // 构建期硬校验（批4-P0）：扩展声明的共享依赖区间必须是管理面宿主 host-contract 接受范围的子集
  assertHostContract('ruoyi-admin')

  return defineConfig({
    plugins: [
      vue(),
      // 复刻宿主 vite/plugins/auto-import.ts：存量页面依赖隐式注入（ref/computed/getCurrentInstance 等无显式 import）
      AutoImport({
        imports: ['vue', 'vue-router', 'pinia'],
        dts: true
      }),
      // <script setup name="Xxx"> → 组件 name（tagsView keep-alive 按组件名缓存，须与菜单路由名一致）
      VueSetupExtend()
    ],
    resolve: {
      alias: {
        // echarts 主题等 UMD 子模块内部 require('echarts/lib/echarts')，归一到 external 的共享 echarts 单例
        //（否则 echarts 核心被打进产物：体积爆炸 + 引入 process.env 等 NODE 环境引用导致浏览器崩）
        'echarts/lib/echarts': 'echarts',
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
        fileName: (format) => `admin.${format}.js`,
        name,
      },
      rollupOptions: {
        external: [
          'vue',
          'vue-router',
          'pinia',
          'element-plus',
          '@element-plus/icons-vue',
          'echarts',
          'opencc-js',
          'marked',
          // 宿主能力桥接（import map 别名 → /esm-libs/admin-request.mjs 等）
          '@/utils/request',
          '@/utils/iconlib',
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
            echarts: 'echarts',
            'opencc-js': 'OpenCC',
            marked: 'marked',
            '@/utils/request': '__AdminRequestModule',
            '@/utils/iconlib': '__AdminIconlib',
            ...extraGlobals,
          },
        },
      },
    },
    ...overrides,
  })
}
