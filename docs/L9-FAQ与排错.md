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

**Q：球端与管理页的 CSS 为什么必须用不同文件名？**
A：发布产物按键平铺，同名会冲突。当前球端骨架通过 `cssFileName: 'tool.css'` 产出 `tool.css`，
管理页骨架使用默认 `style.css`；自定义构建时也必须保持包内唯一，不要依赖后传覆盖先传。

## 9.2 球端运行期

**Q：工具栏没有我的插件图标？**
A：① 团队是否已通过 DC 发布到共享开发调试环境；② 清单接口是否返回你的包（浏览器 Network 查
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
A：① `data/menu.json` 是否已随 publish 经 menu-provision 布设（看发布回执 inserted/updated/unchanged；
失败时按 DC 错误修复并递增版本重发，不直连 resource-manager 手工补布）；② 角色是否授权该菜单
（roleIds 只增不删，补绑走 18850 角色管理，平台方操作）；
③ component 是否 `remote:<pkg>/<viewPath>` 且与 adminViews 键一致；
④ 组件 name 与菜单路由 name 一致（keep-alive 匹配）。

**Q：页面 401/空白？**
A：request 走宿主别名桥才有 token——检查是否误用自建 axios；API 前缀是否经 `getBaseApi()` 或
直接相对路径（不要 `import.meta.env`）。

**Q：图标按钮显示文字或方块？**
A：先用 dev-mcp `icon_search` 确认真实资产名，再用返回的 `iconRef`；普通 Vue 内容用 `AppIcon`，不要手写 EP 名字。`AppIcon` 未命中/远程加载失败会回退 MoreFilled，浏览器 Network 检查相对 `/icon-library/api/v1/**` 请求；管理页全局组件（Pagination/RightToolbar 等）在宿主注册，拼写与宿主一致。

**Q：Coder 调图标工具提示未登录或无权限？**
A：先 `auth_login_start` → 浏览器完成统一身份登录 → `auth_login_wait`，再用 `auth_status` 复核。图标工具要求开发者中心只读权限；无权限时联系平台方，不要尝试直连数据库或调用图标库管理接口。

**Q：`icon_search` 返回 `requiresInstance=true`？**
A：这是自定义/派生资产，没有可直接写入代码的稳定 `iconRef`。让使用者在管理面 IconPicker 选择并确认签发，再把返回的 `iconlib:<instanceId>` 写入代码；不要调上传、派生或实例签发 API 代替用户确认。

## 9.4 发布相关

**Q：publish 拒发「track/tier 缺失或非法」「目录与分类不符」？**
A：manifest.json 补 `track`/`tier`（tool|system / platform|business，显式必填零推断；`delivery` 仅
tool·business 象限填 bundled/optional）；平台仓内包目录必须是 `extensions/<track>/<tier>/<pkg>/`，
提测时保持目录与分类一致（旧 `class` 字段已全退役，不要再填）。

**Q：publish 告警「声明 menu 但菜单未注册」？**
A：告警不阻断——确认 `data/menu.json` 已随包发布并经 menu-provision 布设（缺文件会被 pre-check 拒发），
角色授权后复测。

**Q：release-complete 失败「禁止越段写菜单」？**
A：**这不是缺号段，不要 quota_request**。号段在 `package_register`（resources.menu=true）时已自动
从团队池切好——报错文本自带本包实分段 [start-end]（或 dev-mcp `resource_list` 查 menu 资源位），
把 `data/menu.json` 全部 menuId（含 parentId 引用）改成段内值、递增版本重发即可。典型根因：
skeleton/演示包示意值（2004000/3004000 段）忘了替换，或照抄了别的包的段。
特例：`resource_list` 查不到本包 menu 资源位 = 注册时 menu=false（注册一次性定资源位，重注册 409）——
需要菜单的包必须注册时就 menu=true，误注册走「`package_manage` remove → 重新注册」，不要 quota_request。

**Q：`team_manage quota_request` 之后任务一直 PENDING？**
A：quota_request 仅用于团队菜单池真正用尽（默认 10 块×10000 号/band，约 100 个带菜单的包才触得到，
正常团队用不到——多数「以为要申请」其实是上一条的越段误读）。审批权在平台管理员：
18850 管理面「开发者中心→任务」页按钮，或平台方 dev-mcp `quota_approve`；TEAM_OWNER 自审 403
属设计行为。PENDING 期间联系平台方审批，不要重发版本烧号；误提交的申请请平台方 `quota_reject` 收口。

**Q：AI 工具/同事想 SSH 到 aiearth01 初始化数据库或改配置？**
A：一律禁止。开发团队对服务端零 SSH、零直连——数据库初始化 = `data/sql/*.sql` 随 release-complete
幂等落库；配置/实例/日志全部走 DC 控制 API（dev-mcp 工具）。文档中出现的 `ssh -N -D`（SOCKS 转发）
与 `PUSH_VIA=ssh`（镜像搬运）只是本机发起的客户端通道，不代表可以登录服务器执行任何命令。

**Q：部署后接口 404？**
A：先确认发布响应含 `gatewayRoutes` 且网关已加载 `ruoyi-gateway-dynamic-<profile>.yml`；标准 apiPrefix 由 DC 自动注册。仍 404 时查动态配置与 Nacos 发布日志，不要手工改静态路由表。

**Q：面板报 `Request method 'GET' is not supported`，或前端路径与控制器看似只差一段？**
A：先跑 `node tools/check-api-contract.mjs <包目录>`，按报告核对 `src/api/index.ts`、公开服务的
`apiPrefix`、类级 `@RequestMapping` 与方法级 Mapping 的拼接全路径。不要在业务组件里临时拼 URL
绕过；对账通过但仍 404 时再按上一条查 DC 动态网关路由。

## 9.5 后端与部署（wind-field 实战落账 2026-10-07）

**Q：PostgreSQL 后端使用 PageHelper 时分页 SQL 报错？**
A：显式配置 `pagehelper.helper-dialect: postgresql`，不要让方言自动识别落到其他数据库；
修正后同时核对 `startPage` 紧挨查询调用，避免分页上下文污染下一条 SQL。

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
A：标准路由应为 `Path=/<svcId>/**` + `StripPrefix=1` + `lb://<svcId>`，由 DC 在 deploy 时写入
`ruoyi-gateway-dynamic-<profile>.yml`。若响应没有 `gatewayRoutes`，先确认当前环境 DC/网关运行产物
确实包含动态路由能力，以及该 dynamic dataId 是否存在且已被网关加载；网关须通过独立监听器组合动态路由，
不能再把动态 dataId 按同名 `routes` 列表 import 到静态配置（否则静态路由会被覆盖）。恢复既有包时只修动态配置，
不要重烧插件版本号，也不要改静态路由表。仍 404 再查服务发现与控制器前缀。

**Q：本地服务注册上了 Nacos，网关却没有路由或请求不一定到本机？**
A：Nacos 注册不会创建路由；DC 仅在 `deploy=true` 时写动态路由。已有路由也按服务发现负载均衡，
本机和平台实例同时在线时请求可能到任一端。确定性调试请直接调用本机端口。需要网关全链时，确认路由已存在、
平台到本机 IP/端口可达，并在结束后停止注销本机实例；详见 L8 §8.6。

## 9.6 开发机环境（Windows 实战落账 2026-10-24）

**Q：跑 `create-extension.sh` 无任何输出、退出码 49，或报「目录已存在」但上次明明失败了？**
A：2026-11-07 起脚手架已 Node 化（`create-extension.mjs` 唯一实现），不再调用 python3；菜单声明
手工校验也已内置进 `node tools/publish.mjs <包目录> --check-only`（`tools/menujson.py` 已退役删除，
勿再找它）。历史 bash 版脚手架失败留下的半成品目录删除后重跑即可；若仍有 `python3` 相关诡异退出，
检查是否命中 Microsoft Store 的 App Execution Alias 占位程序（`where python3` 显示在 `WindowsApps` 下即中枪）。

**Q：`mvn` 报「failed to connect to the docker API at npipe://...」？**
A：有些预装环境的 PATH 里 `mvn` 是包装脚本（优先找 `mvn.cmd`，找不到就回退 `docker run maven`），
Docker 守护进程没起时即报此错。用真实 Maven 安装目录下的 `bin/mvn`（或修 PATH 顺序），
与 k8s 无关——插件开发机本就不需要本地集群，deploy/k8s 清单由 publish 打包后服务端 apply。

**Q：命令行发布需要 `AGRSEARTH_TOKEN`，已完成 dev-mcp 登录后从哪里取？**
A：交互使用优先直接走 dev-mcp，不必手工复制令牌。CI 确需覆盖时，读取
`~/.config/agrsearth/dev-mcp-token.json` 的 `access_token` 注入 `AGRSEARTH_TOKEN`；
不要把文件内容或令牌贴进日志、Issue 和提测单。

**Q：Windows Docker Desktop 下 buildx 找不到默认 `multiarch` builder？**
A：先 `docker buildx ls` 核对本机 builder；使用 Docker Desktop 自带的 `desktop-linux` 时执行
`BUILDER=desktop-linux ./build.sh`。镜像脚本的 `--builder` 参数支持该覆盖，无需改仓内脚本。

**Q：Windows 发布后中文菜单变成问号或菱形乱码？**
A：旧版 Git Bash + mingw curl 会把 argv 中的中文按 ANSI 重编码。使用新版 `tools\publish.cmd`
或 `./tools/publish.sh`（两者都执行 `publish.mjs`），请求体由 Node 直接按 UTF-8 发送；已发布版本不可变，
修复后递增版本号重发。

**Q：fresh clone 后 `.sh` 报 `set: pipefail: invalid option name`？**
A：旧仓缺少行尾约束时，Windows `autocrlf=true` 会把脚本签出为 CRLF。当前仓根 `.gitattributes`
已强制 `.sh/.py/.mjs` 为 LF，重新 clone 或重新签出即可，不要再用 sed 手工剥 `\r`。

**Q：MinIO 返回 `SignatureDoesNotMatch`，或 API 前缀变成 `C:/Program Files/Git/...`？**
A：新版发布器使用原生 JSON 与 Node multipart，不再经过 jq/curl/argv，可消除旧链路的 CRLF 与
MSYS 转换问题；保留服务端下发的 PostPolicy 字段和 host，不要自行改写。publish 2.2.1 起非 2xx
会输出 MinIO 的 `Code/Message`；若仍报签名错误，按该详情核对服务端凭据与签名配置，不要先换密钥。

**Q：Qoder/Windows 经 MCP 调用报 `spawn bash ENOENT` 或 `spawn python3 ENOENT`？**
A：dev-mcp 1.6.2 起全部本地通道（package_scaffold/package_precheck/package_contract_check/
package_publish）直调 Node，**不再需要 bash/python**——升级到最新 tools/dev-mcp 即可根治。
旧版本可用 `AGRSEARTH_BASH` 指向 Git Bash（如 `C:\Git\bin\bash.exe`）、`AGRSEARTH_PYTHON`
指向真实 `python.exe` 兜底。

**Q：MCP 客户端在浏览器登录完成前就报工具调用超时？**
A：dev-mcp 1.4.0 起改用 `auth_login_start` 获取 loginId 和完整授权链接，完成浏览器登录后调用
`auth_login_wait`。原 `auth_login` 仍兼容保留，但客户端工具超时较短时不要再用一次性入口。

**Q：Docker Desktop 推不了 `localhost:32000`？**
A：镜像推送使用 `PUSH_VIA=ssh PUSH_SSH_HOST=aiearth01 ./build.sh`，走 buildx `--load` +
docker save + SSH 到 aiearth01 后 load/push，不在 Docker Desktop VM 内解析集群 localhost。

**Q：拉取 arm64 基础镜像元数据经 hubproxy 失败？**
A：aiearth01 为 x86_64，骨架已默认 `PLATFORMS=linux/amd64`；不要为该环境强制多平台构建。
SSH 搬运模式的 `--load` 也只接受单平台。


## 9.7 国际资源访问与代理

**Q：npm/Maven/Docker 或文档下载在国际站点超时、连接重置、TLS 失败？**
A：先保存原始错误，确认 URL、版本、凭据、DNS 和服务端状态；只对确认的国际网络访问问题启用代理排查。
只读检查本机已有 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`、代理进程和实际监听地址。开发团队默认使用 Clash，
发现既有 Clash 时优先复用当前配置，不假定固定端口，不擅自启停 Clash 或修改系统代理。

代理仅用于当前命令或构建进程，内网和环回地址保持直连。可用工具自带代理参数或标准环境变量做最小化重试验证；
不要把代理地址、凭据写入仓库。需要持久配置时由用户确认。该通道与访问开发底座的 `AGRSEARTH_SOCKS_PROXY`
SSH 动态转发不同，不要混用。代理不可用或重试仍失败时，报告原始错误、已检查项和最小复现结果，不盲目连续重试。
