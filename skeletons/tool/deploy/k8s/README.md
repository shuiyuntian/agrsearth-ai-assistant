# deploy/k8s/ —— tool 轨单后端部署样例

publish 时本目录整体打包为 `k8s-bundle.tar.gz`，部署时一键安装（dry-run 预检 → 受限 apply → 实例自动补齐）。
工具轨至多一个自建后端，单文件样例即可；多服务体量（共享 ConfigMap + 多工作负载）请归系统轨骨架。

## 白名单（硬性约束，违反即拒）

| 项 | 规则 |
|:---|:---|
| 允许的 kind | **仅** Deployment / StatefulSet / Service / ConfigMap |
| 禁止的 kind | Secret / RBAC（Role/ClusterRole/Binding）/ CRD / Namespace |
| 命名空间 | 不写（服务端强制校验/覆写为目标环境命名空间） |
| 时区 | workload 显式 `env: TZ=Asia/Shanghai`（一票否决项，勿只经 envFrom 间接注入） |
| 镜像拉取 | `imagePullPolicy: Always`（同 tag 迭代防节点缓存旧镜像） |
| 内存 | `limits.memory ≥ 1536Mi`（Spring Boot 4 基线：覆盖 -Xmx + non-heap 余量，512Mi 实测 OOMKilled） |
| 凭据 | 一律 `secretKeyRef` 引用平台方预建的环境级 Secret 或包级 Secret——**只引用不创建** |

## 文件组织

- `10-example-server.yaml`：ConfigMap（非密应用配置，`envFrom` 整体引入）+ Deployment（探针/资源基线）+ Service（ClusterIP）

可多文档平铺，也可用 `kustomization.yaml` 组织（publish 时 `kubectl kustomize` 拍平后打包）。
workload 名 = service_id 约定（实例自动补齐依据），可用 label `gis-platform/service-id` 覆盖。
