# L2 接入准备：SSO 与开发环境

## 2.1 开发者账号申请（SSO 统一身份）

平台用户由 **SSO 统一身份**集中管理（OpenLDAP 权威目录 + Casdoor 协议门面 + sso-manager 管理面），
应用侧（18850/18880）只读消费。**插件开发者账号不走自助注册**，流程：

1. **申请**：向平台管理方提交（团队/姓名/邮箱/所属项目/需要的角色）；
2. **开通**：平台统一身份管理员在「统一身份」创建用户，分配**开发者角色**与初始密码
   （首登强制改密，等保要求）；
3. **MFA**：管理面操作要求绑定 TOTP（Authenticator App 扫码），按页面提示完成；
4. **拿到入口**：共享开发调试环境访问地址（18850 管理面 / 18880 球平台，aiearth02 公司网 LAN 10.82.11.52）随开通通知下发。

> 角色口径：开发者默认持「普通员工」+ 插件开发所需的最小菜单授权；
> 平台管理与发布权限**不下放**（发布权集中在平台方，见 L8）。

## 2.2 登录与日常

- 登录：浏览器访问测试底座入口 → SSO 登录页（账号 + 密码 + MFA TOTP）。
- 会话：空闲 30 分钟过期需重新登录；密码 90 天过期（以 SSO 提示为准）。
- 账号问题（锁定/重置/MFA 换机）：找平台统一身份管理员，**不要**在应用侧尝试重置。

## 2.3 API 调用方式与 token

| 场景 | 方式 |
|:---|:---|
| 球端插件调后端 | `ctx.http.get/post`——自动带网关前缀与 Bearer token，**插件侧零处理** |
| 管理页调后端 | `import request from '@/utils/request'`（宿主别名桥，token/401/防重全继承） |
| 团队本地脚本/CI 调测试底座 API | 经网关 `http://<底座网关>/...`，从浏览器登录态复制 Bearer token（仅自测，不外传） |

- 内部约定：服务间调用**直连 ClusterIP 不走网关**、路径不带网关前缀（平台方集成时处理）；
  团队插件只需关心 `apiPrefix`（manifest.backendServices 声明）。
- 第三方密钥（如大模型 API key）：**不进仓库**，提测时列入依赖清单由平台方注入
  （k8s Secret 只引用不创建）。

## 2.4 开发机准备

| 依赖 | 版本要求 | 说明 |
|:---|:---|:---|
| Node.js | ≥ 18（建议 20+） | 模板仓用 npm workspaces；pnpm 亦可（版本管理自理） |
| Git | 任意近期版本 | 分支模型见 L7 |
| Python 3 | ≥ 3.9 | 仅文档转 HTML 工具（tools/md-to-html.py）需要 |
| Java 17 + Maven | 仅系统轨后端 | 本地构建自研服务（平台方集成期对齐 parent pom） |

## 2.5 模板仓获取

```bash
# 方式 A：平台方下发模板仓压缩包/目录（export-plugin-template.sh 产物）
unzip AGRSEarth-plugin-template.zip && cd AGRSEarth-plugin-template

# 方式 B：平台方建立团队可见的模板仓克隆后 fork
git clone <团队模板生成仓地址> && cd AGRSEarth-plugin-template

npm install        # 安装全部 workspace 依赖（含 @agrsearth/* 本地包）
npm run check      # 骨架自检：全部骨架可构建即通过
```

> 模板仓是**同步源** `extensions/_template/` 的导出产物；平台方升级模板后按同样方式重新下发。
> 团队定制只发生在自己包目录内（`extensions/<track>/<tier>/<pkg>/`），`packages/`（平台供给包）与 `skeletons/` 保持原样以便 diff 跟进升级。
