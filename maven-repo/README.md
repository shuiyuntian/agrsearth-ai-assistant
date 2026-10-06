# maven-repo：vendored file:// Maven 仓库（com.ruoyi 构件闭包）

本目录是 **file:// 协议的 Maven 远程仓库形态**，装齐插件后端骨架（`backend/svc-placeholder/`）
实际依赖的 `com.ruoyi` 构件——**com.ruoyi 全部构件不在 Maven 中央仓**，外部开发者无平台仓
时构建后端全靠本目录。

## 内容（闭包清单，实测自 `mvn dependency:list`）

| 构件 | 形态 | 来源 |
|:---|:---|:---|
| com.ruoyi:ruoyi:3.6.8 | pom（根 parent） | parent 链 |
| com.ruoyi:ruoyi-common:3.6.8 | pom | ruoyi-common-*/ruoyi-common-security 的 parent |
| com.ruoyi:ruoyi-api:3.6.8 | pom | ruoyi-api-system 的 parent |
| com.ruoyi:ruoyi-common-core:3.6.8 | pom+jar | 传递依赖 |
| com.ruoyi:ruoyi-common-redis:3.6.8 | pom+jar | 传递依赖 |
| com.ruoyi:ruoyi-common-security:3.6.8 | pom+jar | 骨架直接依赖 |
| com.ruoyi:ruoyi-api-system:3.6.8 | pom+jar | 传递依赖 |

## 使用方式

脚手架实例化的后端 pom 已自动配置：

```xml
<parent>
    <groupId>com.ruoyi</groupId>
    <artifactId>ruoyi</artifactId>
    <version>3.6.8</version>
    <!-- 直指 vendored 根 pom 文件（相对模块目录四层到仓根；parent 解析期表达式未插值，
         不能用 ${project.basedir} 走仓库，故 relativePath 直给文件路径） -->
    <relativePath>../../../../maven-repo/com/ruoyi/ruoyi/3.6.8/ruoyi-3.6.8.pom</relativePath>
</parent>
<repositories>
    <repository>
        <id>cesiumai-vendored</id>
        <url>file://${project.basedir}/../../../../maven-repo</url>
    </repository>
</repositories>
```

- parent 根 pom 经 `relativePath` 直读（免仓库解析）；传递 com.ruoyi 构件（ruoyi-common-security
  等）经 `cesiumai-vendored` file 仓解析（依赖解析期 `${project.basedir}` 已插值，表达式可用）。
- 其余依赖（spring-boot/spring-cloud/alibaba 等）照常从 Maven 中央仓解析。

## 扩充

需要清单外的 com.ruoyi 构件（如 ruoyi-common-datasource）时：联系平台方补发构件，
放入 `com/ruoyi/<artifact>/<version>/`（pom 必带，jar 按需要），并同步更新上表；
平台方重跑 `scripts/build/export-plugin-template.sh` 时会从本地 `~/.m2/repository/com/ruoyi/`
自动补齐闭包。
