# 扩展包后端骨架模板（svc-placeholder）

最小可运行 Spring Boot 微服务骨架（parent 挂 RuoYi Cloud 根 pom、Nacos 注册/配置、
actuator 健康端点、独立构建不挂聚合）。模板仓内已 vendor `maven-repo/`（file:// 仓，
装齐 com.ruoyi 构件闭包），实例化后**无需平台仓即可 `mvn package`**。

## 实例化方式

**首选脚手架**（自动复制本目录并替换全部占位符，pom 同步改造为 vendored maven-repo）：

```bash
# 模板仓（独立开发仓）——生成到 extensions/<track>/<tier>/<pkg>/backend/<svc>/
./tools/create-extension.sh <pkg> --track tool --tier business --with-backend --name <中文名>

# 平台仓（平台方自建扩展时）——生成到 extensions/<track>/<tier>/<pkg>/backend/<svc>/
./scripts/create-extension.sh <pkg> --track tool --tier business --with-backend --name <中文名>
```

**手工实例化**：复制本目录为包内 `backend/<svc-id>/`，配套镜像目录复制
`container/svc-placeholder/` 为包内 `container/<svc-id>/`，然后按下表替换占位符
（含目录名 `__JAVA_DIR__`、文件名 `__APP_CLASS__.java`）。手工实例化还须自行改造 pom：
parent 的 `<relativePath>` 改为直指 vendored 根 pom
`../../../../../../maven-repo/com/ruoyi/ruoyi/3.6.8/ruoyi-3.6.8.pom`，并加 `<repositories>` 指向
vendored 仓 `file://${project.basedir}/../../../../../../maven-repo`（相对包内 backend/<svc>/ 六层到
仓根；脚手架实例化已自动完成本改造，细节见 `maven-repo/README.md`）。

| 占位符 | 含义 | 取值规则 |
|:---|:---|:---|
| `__SVC_ID__` | 服务 id | kebab-case，= `manifest.backendServices[].serviceId` = Nacos 注册名 |
| `__SVC_ENV__` | 服务 id 的环境变量写法 | 大写 + 中划线转下划线 |
| `__SVC_PORT__` | 服务端口 | 向平台方申请（测试底座端口段以 test-env/README.md 为准），同步改 Dockerfile `EXPOSE` |
| `__JAVA_DIR__` | Java 包目录段 | 服务 id 去中划线，全路径 `com.ruoyi.<该值>` |
| `__APP_CLASS__` | 启动类名 | 服务 id 帕斯卡命名 + `Application` |
| `__PKG_ID__` / `__PKG_NAME__` | 能力包 id / 中文名 | 目录名 / manifest.name |
| `__TRACK__` / `__TIER__` | 二维分类 | manifest 的 `track`/`tier`，决定镜像命名空间 `gis-platform/<track>/<tier>/<pkg>` |
| `__TODAY__` | 文件头创建日期 | 生成日（`YYYY-MM-DD`） |

## 实例化后必做

1. **改端口**：`bootstrap.yml` 的 `server.port` 默认值与 `container/<svc>/Dockerfile` 的 `EXPOSE`。
2. **声明服务**：`manifest.json` 的 `backendServices[]` 填 `serviceId/apiPrefix/healthEndpoint`
   （脚手架已按约定生成：`apiPrefix="/<svc>"`，`healthEndpoint="/<svc>/actuator/health"`）。
3. **网关路由**：标准 `apiPrefix` 在 `release-complete --deploy` 时由 DC 自动写入网关动态配置；
   特殊路径/过滤器需求才需在提测单单独声明。
4. **本地验证**：`mvn clean package -DskipTests`（vendored maven-repo + Maven 中央仓即可，见
   仓根 README「maven-repo」节）→ `mvn spring-boot:run`，访问
   `http://localhost:<port>/info` 与 `/actuator/health`（应用内与 Pod 直连均不带服务前缀；
   网关外部才使用 `/<svc>/actuator/health`，nacos 默认指向测试底座，地址表见 `test-env/README.md`）。
5. **业务依赖**：数据库/MyBatis 等按需往 `pom.xml` 加（com.ruoyi 构件仅限 maven-repo 已
   vendored 的范围，缺件找平台方补发或更新模板仓）。

## 规约红线

- parent `relativePath` 直指 vendored 根 pom + `<repositories>` 指向 vendored `maven-repo/`（模板仓实例化
  形态）；平台仓内实例化为 6 层 relativePath 指回 ruoyi 根 pom。**禁止**挂进
  `ruoyi-modules/pom.xml` 的 `<modules>` 聚合（契约见模板仓 docs/L6-参考契约.md）。
- Dockerfile/构建脚本只放 `container/<svc>/`，禁止与 `backend/<svc>/` 源码混放。
- 时区一票否决：容器/deployment 显式 `TZ=Asia/Shanghai`。
