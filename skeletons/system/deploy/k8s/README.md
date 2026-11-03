# deploy/k8s/ —— k8s-bundle 白名单样例

publish 时本目录整体打包为 `k8s-bundle.tar.gz`，部署时一键安装（dry-run 预检 → 受限 apply → 实例自动补齐）。

## 白名单（硬性约束，违反即拒）

| 项 | 规则 |
|:---|:---|
| 允许的 kind | **仅** Deployment / StatefulSet / Service / ConfigMap |
| 禁止的 kind | Secret / RBAC（Role/ClusterRole/Binding）/ CRD / Namespace |
| 命名空间 | 不写（服务端强制校验/覆写为目标环境命名空间） |
| 时区 | 每个 workload 显式 `env: TZ=Asia/Shanghai`（一票否决项） |
| 凭据 | 一律 `secretKeyRef` 引用平台方预建的环境级 Secret 或包级 Secret——**只引用不创建** |

主服务模板声明 `DB_URL/DB_USERNAME/DB_PASSWORD/DB_SCHEMA` 四个映射，键固定为 `jdbc-url/username/password/schema`。`__DB_SECRET_NAME__` 仅是占位符；DC 在 deploy 前会自动收敛为本包实际发放的 Secret，无需手工替换。真实 Secret 名和值均不进模板仓。

## 文件组织

- `00-shared-configmap.yaml`：包级共享配置（`<pkg>-shared`，非密配置，包内组件 `envFrom` 整体引入）
- `10-example-server.yaml`：自研主服务 Deployment + Service（探针惯例、镜像 tag = 组件版本）
- `20-example-worker.yaml`：工作器 Deployment（`dependsOn` 顺序靠文件序号与 manifest 拓扑序双重表达）

可多文档平铺，也可用 `kustomization.yaml` 组织（publish 时 `kubectl kustomize` 拍平后打包）。
workload 名 = service_id 约定（实例自动补齐依据），可用 label `gis-platform/service-id` 覆盖。
