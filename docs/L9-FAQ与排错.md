# L9 FAQ 与排错

## 9.1 构建期

**Q：`npm run build` 报找不到 `@agrsearth/*`？**
A：包未加入仓根 `package.json` 的 `workspaces`，或加完没重跑 `npm install`。workspace 成员必须
在 `workspaces` 数组内（`extensions/*/*/*/frontend` glob 已覆盖，无需手改）。

**Q：vue-tsc 报 CapabilityManifest 类型不存在？**
A：确认 `import type { CapabilityManifest } from '@agrsearth/sdk-types'` 为 type-only 导入；
 sdk-types 的 `main/types` 指向 TS 源，moduleResolution 须为 `bundler`（骨架 tsconfig 已配）。

**Q：产物体积异常大（>500KB）？**
A：九成是宿主依赖被打进产物。查 `vite.config.ts` 是否经 `@agrsearth/vite-config` 引入 external；
若引入了 ui-utils（opencc-js），记得把 `opencc-js` 加入 extraExternals（骨架默认不含）。

## 9.2 球端运行期

**Q：工具栏没有我的插件图标？**
A：① 平台方是否已 publish test 到测试底座；② 清单接口是否返回你的包（浏览器 Network 查
`/resource-manager/api/v1/package/list?target=…`）；③ `entries.url` 是否可达；
④ 远程加载 console 报错。本地资源中心连不上属预期（首屏底图仍在）。

**Q：registerRemote 报错？**
A：同 id 重复注册——升 version 后再加载；或同包旧实例未卸载。

**Q：面板关一次就打不开？**
A：`createPanel` 前判重：`if (!panel || !panel.el.isConnected)` 才新建，否则 `panel.show()`。

**Q：面板卡顿？**
A：列表/数据面板用 `mode:'native'`，别用 shadow + 独立 Vue app。

**Q：面板里一块白？**
A：Element Plus 默认浅色。深色覆盖（Tailwind class 或 CSS 变量），或包 `el-config-provider` 设 dark。

**Q：标题栏按钮点了不生效？**
A：标题栏与内容区是两个 Vue app，props/provide 不通——用模块级 reactive store 或
`useChineseLang()` 单例（见 L4）。

## 9.3 管理面

**Q：菜单不可见？**
A：① `data/menu.json` 是否已随 publish 经 menu-provision 布设（publish 日志看 inserted/updated/unchanged
计数；手工补布设走 resource-manager `POST /<pkg>/menu-provision`，幂等可重发）；② 角色是否授权该菜单
（roleIds 只增不删，补绑走 18850 角色管理，平台方操作）；
③ component 是否 `remote:<pkg>/<viewPath>` 且与 adminViews 键一致；
④ 组件 name 与菜单路由 name 一致（keep-alive 匹配）。

**Q：页面 401/空白？**
A：request 走宿主别名桥才有 token——检查是否误用自建 axios；API 前缀是否经 `getBaseApi()` 或
直接相对路径（不要 `import.meta.env`）。

**Q：图标按钮显示文字或方块？**
A：图标用 Element Plus 图标名字符串（宿主解析）或包内 SVG；管理页全局组件
（Pagination/RightToolbar 等）在宿主注册，拼写与宿主一致。

## 9.4 发布相关

**Q：publish 拒发「track/tier 缺失或非法」「目录与分类不符」？**
A：manifest.json 补 `track`/`tier`（tool|system / platform|business，显式必填零推断；`delivery` 仅
tool·business 象限填 bundled/optional）；平台仓内包目录必须是 `extensions/<track>/<tier>/<pkg>/`，
提测时保持目录与分类一致（旧 `class` 字段已全退役，不要再填）。

**Q：publish 告警「声明 menu 但菜单未注册」？**
A：告警不阻断——确认 `data/menu.json` 已随包发布并经 menu-provision 布设（缺文件会被 pre-check 拒发），
角色授权后复测。

**Q：部署后接口 404？**
A：网关路由未加 apiPrefix——提测单已要求声明「网关路由新增需求」，找平台方补。

## 9.5 后端与部署（wind-field 实战落账 2026-10-07）

**Q：后端启动即失败「Failed to determine a suitable driver class」？**
A：骨架依赖 ruoyi-common-security 传递引入 mybatis/HikariCP，无库服务必须在启动类排除
`DataSourceAutoConfiguration`（注意平台为 Spring Boot 4，类在 `org.springframework.boot.jdbc.autoconfigure`
包下，不是老教程的 `autoconfigure.jdbc`）。0.1.1 起骨架已内置 exclude；服务需要数据库时删除
exclude 并配置数据源。

**Q：接口返回里混着 `nodeType`/`array`/`empty` 之类的垃圾字段？**
A：平台 Spring Boot 4 的 MVC 序列化走 Jackson 3（`tools.jackson`），你 `new ObjectMapper()`
产出的是 Jackson 2 的 `JsonNode`——Jackson 3 不认识它，当 POJO 反射输出了全部 getter。
出参前 `objectMapper.convertValue(node, Map.class)` 转成 Map 再放进 `R.ok(...)`。

**Q：改了代码重建镜像、重新部署，行为没变？**
A：同 tag 重推 + `imagePullPolicy: IfNotPresent` = 节点用缓存旧镜像。开发期 deployment 用
`imagePullPolicy: Always`（本仓 deploy/k8s 样例即此）；正式发布走组件版本轴
（`container/<svc>/VERSION` bump 新 tag），不要同 tag 覆盖生产引用。

**Q：pod 反复 OOMKilled（Exit Code 137）？**
A：k8s `resources.limits.memory` 必须 ≥ 镜像 `JAVA_OPTS` 的 `-Xmx` + non-heap 余量。
骨架 Dockerfile 默认 `-Xmx1024m`，配套 limit 至少 1536Mi（768Mi 实测必死）。

**Q：发布后管理页调后端 404「No static resource <svc>/...」？**
A：网关路由表里缺你服务的 `/<svcId>/**` 段——提测单声明「网关路由新增需求」由平台方补；
测试底座的现成样例见 wind-field-server 段（`Path=/wind-field-server/**` + `StripPrefix=1`，
controllers 不带服务前缀时 StripPrefix 不可省）。
