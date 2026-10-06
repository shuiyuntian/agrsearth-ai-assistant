# 插件测试底座（agrslab-dev）使用说明

> 测试底座是平台方部署的独立测试环境，与生产完全隔离（独立 DB / MinIO bucket / 清单）。
> 团队自助发布**只进本环境**；生产发布由平台管理员执行。

## 1. 地址表（默认端点，全部可环境变量覆盖）

| 组件 | 地址 | 用途 |
|:---|:---|:---|
| GIS 球平台 | http://192.168.1.22:18880 | 插件面板联调入口 |
| 管理面 | http://192.168.1.22:18850 | 扩展管理/菜单对账 |
| 网关 | http://192.168.1.22:18801 | 业务 API 统一入口 |
| MinIO S3 | http://192.168.1.22:18814 | 产物存储（bucket `gis-platform-resources-test`） |
| 产物公共前缀 | http://192.168.1.22:18880/plugins | 产物经 nginx `/plugins/` 反代访问（URL 不含 bucket 名） |
| resource-manager API | http://192.168.1.22:18801/resource-manager/api/v1/package | 包/版本/资源注册（走网关） |

`tools/publish.sh` 已按上表写死默认值；如需覆盖，用环境变量
`MINIO_ENDPOINT / MINIO_BUCKET / MINIO_PUBLIC_URL / RM_API_BASE`。

## 2. 账号申请流程

1. 联系平台管理员，提供：团队名、负责人、包 id 清单、需要的菜单号段；
2. 平台管理员开通 **ext-developer 角色**并下发：
   - MinIO 凭据（`MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`）；
   - 管理端登录 token 获取方式（`RM_TOKEN`，管理面登录后从会话获取）；
   - 球端/管理面测试入口的登录账号（SSO 开发者账号）。
3. 凭据只进本机环境变量或本地 `.env`（gitignored），**禁止写进包代码/文档/提测单**。

## 3. 发布通道（tools/publish.sh）

```bash
# 1. 自助发布：构建 → MinIO 上传 → resource-manager 注册（仅测试底座）
MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... RM_TOKEN=... \
    ./tools/publish.sh packages/<pkg-id>

# 2. 联调部署（触发版本部署接口，逐组件打印结果）
./tools/publish.sh packages/<pkg-id> --deploy

# 3. 菜单布设随发布自动执行（menu-provision 幂等 upsert）；
#    号段必须已向平台方申请（sys_config menu.segment.<pkg> 台账），本地先过校验：
python3 tools/menujson.py validate packages/<pkg-id>/data/menu.json --package <pkg-id>
```

发布冒烟（产物 URL 可达 + manifest 字段比对）不通过即非零退出；重跑即可（资源/菜单均幂等）。

## 4. HMR 调试回路（--dev-url）

正常发布后要改前端？不必每次全量发布——把球端 `entries.esm.url` 指到本机：

```bash
# 1. 前端 watch 构建（产物持续输出到 dist/）
cd packages/<pkg-id>/frontend && npm run dev

# 2. 另一个终端：静态服务 dist/（本机 IP 需测试底座球端可直达）
cd packages/<pkg-id>/frontend/dist && python3 -m http.server 5173

# 3. 把已发布版本的 manifest entries 指向本机（宿主再拉 manifest 即加载本机产物）
./tools/publish.sh packages/<pkg-id> --dev-url http://<本机IP>:5173

# 4. 球端 18880 强制刷新 → 面板加载本机产物，改代码即生效（watch 自动重编）

# 5. 调试完恢复正式产物 URL
./tools/publish.sh packages/<pkg-id> --dev-url --reset
```

注意：

- `--dev-url` 基于**已发布版本**改写 manifest（先正常发布一次）；
- 本机防火墙放行端口；跨域受限时以静态服务响应头放行为准；
- 恢复（`--reset`）后建议强刷球端再验一次正式产物。

## 5. 边界

- 本环境**不保证数据持久与 SLA**：平台方升级/重建底座时可能清清单与 bucket，重要产物以团队仓库为准；
- 生产缺陷走提测单加急通道，勿绕过流程直发生产（`tools/publish.sh` 也不接受任何 prod 参数）。
