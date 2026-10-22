# L3 Quick Start：30 分钟跑通样例

> 目标：从模板仓出发，建出自己的第一个工具轨插件包，本地构建通过，并能在 **aiearth02 ext-dev 共享开发调试环境**
> 测试底座的球平台（18880）工具栏里点出来。（发布动作由平台方执行，见 L8。）

## 步骤 0：前置（5 分钟）

- [ ] 已有 SSO 开发者账号（L2.1）与测试底座入口
- [ ] 模板仓已获取且 `npm install && npm run check` 通过（L2.5）

## 步骤 1：脚手架建包（5 分钟）

```bash
# 推荐：模板仓脚手架（自动复制骨架 + 替换占位符 + 登记 npm workspace）
./tools/create-extension.sh my-first-tool --track tool --tier business --name 我的第一个工具

# 等价手工方式：整目录复制后按步骤 2 改名清单替换
./tools/create-extension.sh my-first-tool --track tool --tier business   # 落位 extensions/tool/business/my-first-tool/
```

## 步骤 2：按改名清单替换占位符（10 分钟）

对照 `skeletons/tool/README.md` 的「改名清单」：

| 文件 | 改成 |
|:---|:---|
| `extensions/tool/business/my-first-tool/manifest.json` | `id: "my-first-tool"`、`name: "我的第一个工具"`、`author: 你的团队署名` |
| `extensions/tool/business/my-first-tool/VERSION` | `0.1.0`（保持） |
| `extensions/tool/business/my-first-tool/frontend/package.json` | `name: "@agrsearth/ext-my-first-tool"` |
| `extensions/tool/business/my-first-tool/frontend/src/manifest.ts` | id/name 同上，version 保持 `0.1.0` |
| `extensions/tool/business/my-first-tool/frontend/vite.config.ts` | `name: 'Capability_my_first_tool'` |

> npm workspace 已由仓根 `package.json` 的 glob（`extensions/*/*/*/frontend`、`extensions/*/*/*/admin-ui`）
> 全覆盖，脚手架/手工建包后**无需手改 workspaces 数组**，直接 `npm install` 即可。

## 步骤 3：改面板内容并本地构建（5 分钟）

1. 打开 `extensions/tool/business/my-first-tool/frontend/src/index.ts`，把 `ExamplePanel` 文案改成你的内容；
2. 构建：

```bash
npm install && npm run build    # 或 npm run check
# 期望：vue-tsc 无报错，产出 dist/tool.es.js / tool.umd.js
```

**验收点**：`extensions/tool/business/my-first-tool/frontend/dist/tool.es.js` 存在，且文件头部只从
`"vue"` 做 external import（无 element-plus/cesium 被打进产物）。

## 步骤 4：提测，让插件在测试底座可见（平台方接力）

1. 按 `RELEASE_CHECKLIST.md` 完成发布前自检；
2. 按 L8 填提测单，随附：代码（PR/压缩包）、版本、CHANGELOG、自测证据
   （构建产物清单 + 面板截图）、依赖清单；
3. 平台方验收（`docs/运维手册/2-部署与变更/PLUGIN_ACCEPTANCE.md`）后 publish test →
   你在 18880 工具栏看到「我的第一个工具」图标，点击弹出面板即跑通；
4. 观察窗无问题后平台方 publish prod（isDefault 人工点选）。

## 常见卡点（详见 L9）

- `npm run build` 报 `@agrsearth/*` 找不到 → 包没加进 `workspaces` 或没重跑 `npm install`；
- 面板点了没反应 → 看 L9「远程加载失败」排查清单；
- 工具栏图标出现但点击空白 → admin-ui/球端主题问题，见 L10 与 L9。
