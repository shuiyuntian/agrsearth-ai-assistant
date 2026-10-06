# 示例系统（骨架）

> 系统轨能力包最小骨架（track: system / tier: business）：子系统体量业务包——管理面远程页（ADR-007）+
> 多后端服务（backendServices 多组件 + 组件版本轴）+ k8s-bundle 一键安装 + 数据/菜单声明。
> 使用方式：**整目录复制**后按「改名清单」替换占位符。

**两轨判据（体量，不是形态）**：工具轨 = 最多一个自建后端微服务 + 管理页 + 球端工具；
系统轨 = 体量大、一个服务装不下、多服务组成、子系统级需求。系统轨**可以**带球平台前端
（ai-assistant-mcp 先例）——需要时复制 `skeletons/tool/frontend` 进包，并把 `components.frontend` 置 true。

## 改名清单（复制后必改）

| 位置 | 占位值 | 改为 |
|:---|:---|:---|
| `manifest.json` | `id: "example-system"`、`name`、`description`、`author` | 包 id 与团队信息；`track`/`tier` 按包实际象限调整（系统轨多为 system/business） |
| `manifest.json` | `components.backend[]` | 与各 `backendServices[].serviceId` 完全一致 |
| `manifest.json` | `components.menu.menuPath` | = 顶层菜单 path（包 id 或平台方指定值） |
| `backend/<svc>/` | 目录名/Java 包名 | 后端源码不入骨架：用 `tools/create-extension.sh`（模板仓脚手架）从 `backend/svc-placeholder/` 实例化（占位符表见其 README） |
| `container/example-server/` | 目录名 | 与 serviceId 一致（组件版本轴 `container/<svc>/VERSION`） |
| `deploy/k8s/*.yaml` | `example-server`/`example-worker` 资源名 | 与服务一致（workload 名 = service_id 约定） |
| `data/menu.json` | 示例号段 | 平台方分配号段（sys_config `menu.segment.<pkg>` 台账，批4 起 menuId 必须落段内） |

## 目录

- `manifest.json`              能力包清单（track/tier + components 显式声明 + backendServices 多组件）
- `VERSION`                    包版本唯一事实源
- `admin-ui/`                  【复制 `skeletons/admin-ui` 进来】管理面远程页（ADR-007），产物 admin.es.js
- `backend/`                   【不随骨架携带】用 `tools/create-extension.sh`（模板仓脚手架）从 `backend/svc-placeholder/` 实例化（可运行 Spring Boot 骨架），服务数与 `backendServices` 一致
- `container/<svc>/`           组件镜像构建目录（Dockerfile/build.sh，规范见平台 CONTAINER_IMAGE_SPEC）
- `deploy/k8s/`                k8s-bundle（白名单：Deployment/StatefulSet/Service/ConfigMap，namespace 由部署服务端覆写，禁 Secret）
- `data/menu.json`             管理面菜单声明样例（批4 通道，publish 时 menu-provision 幂等落地）

## 多组件部署惯例（包内组件衔接）

1. **网络**：包内组件互调走集群内 Service DNS（`http://<service-name>:<port>`），不经网关
2. **非密共享配置**：`envFrom.configMapRef` 整体引入共享 ConfigMap（见 deploy/k8s/00 样例）
3. **凭据**：`secretKeyRef` 引用平台方手工预建的 Secret（bundle 禁 Secret，只引用不创建）

> 退役注记：原「域（domain）分组 / 域内衔接三通道」的域实体机制已撤回（ADR-005，rm_domain/域视图
> 下线）；上述三条作为多组件部署的技术惯例保留，命名按包级（`<pkg>-shared` / 平台方预建 Secret）。

## 开发

1. 后端本地开发/构建（平台铁律：本地优先），镜像构建后推 `localhost:32000`
2. 管理页：`admin-ui/` 内 `npm install && npm run build`（依赖 @cesiumai/* workspace 包）
3. 发布权在平台方：自测通过 → 按 `docs/L8-提测与发布.md` 提交提测单
