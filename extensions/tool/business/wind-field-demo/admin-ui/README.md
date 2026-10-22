# admin-ui 骨架（管理端远程页面，ADR-007）

> 管理面页面**不再编进 ruoyi-admin 单体**，改为随包发布、运行时远程加载。
> 本骨架两轨通用：系统轨复制为包内 `admin-ui/`；工具轨需要管理页时同样复制。

## 契约（违反即验收打回）

- `src/index.ts` 导出 `{ manifest, adminViews }`；`adminViews` 键 = 菜单 component 中
  `remote:<packageId>/<viewPath>` 的 `<viewPath>`（如 `example/index`）
- 菜单登记：`sys_menu.component = 'remote:<packageId>/<viewPath>'`（声明在 skeletons/*/data/menu.json 样例，批4 通道）
- 页面内 `import request from '@/utils/request'` 原样可用（宿主 import map 别名桥接，token/401/防重全继承）；
  `@/types` 构建期解析到本包 `src/types/index.ts`（re-export `@agrsearth/admin-sdk`）
- **禁止**自建 `createApp`（丢失宿主 app context）；**禁止** `import.meta.env.*` 烘焙
  （API 前缀用 `@agrsearth/admin-sdk` 的 `getBaseApi()` 运行时读取）；
  **禁止** import 宿主内部组件/layout/store
- element-plus/vue/vue-router/pinia/echarts/opencc-js 经 import map 与宿主单例共享（构建已 external）
- `v-hasPermi`、`$modal`、`parseTime`、`Pagination`/`RightToolbar` 全局组件、tagsView keep-alive
  （组件 `name` = 菜单路由 name，`<script setup name="XxxIndex">` 已内置 unplugin 注入）天然可用

## 文件

- `src/index.ts`               入口契约（manifest + adminViews）
- `src/types/index.ts`         类型契约桥（`export * from '@agrsearth/admin-sdk'`）
- `src/api/example.ts`         API 封装样例（经 '@/utils/request'）
- `src/views/example/index.vue` 页面骨架（查询区/工具栏/表格/分页/对话框，风格规范见 docs/L10-UI规范.md）

## 构建

```bash
npm install && npm run build   # 产物 dist/admin.es.js / admin.umd.js / style.css
```

发布时 `components.adminUi=true` + manifest 声明 `"adminUi": { "entry": "admin-ui/dist/admin.es.js" }`。
