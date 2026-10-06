# 模板仓套件变更记录

> 本文件版本 = 模板仓套件版本（_template/VERSION），含义：导出工具链 + skeletons + packages 供给物 + docs 的整体版本。平台方重发模板仓时随导出脚本 tag（`v<套件版本>+<主仓短 sha>`）。

## [Unreleased]

- 实战检验修复（2026-10-06 wind-field 外部开发者演练产出；组件级版本见各文件头）：
  ① `tools/publish.sh` 1.0.1——测试底座不可达场景报错体验（s3_upload 30s 超时 + 友好指认
  「无法连接 MinIO / resource-manager + 环境变量覆盖指引」，不再抛裸栈）；
  ② `tools/create-extension.sh` 1.0.1——manifest.json description 骨架文案纳入占位符替换；
  实例化 pom 同步改写「集成约定」注释（vendored 4 层形态，原平台仓 6 层表述防误导）；
  ③ `skeletons/admin-ui` 示例页 `<script setup>` 补 `lang="ts"`（原按 JS 解析，TS 语法报莫名
  babel 错——最阴踩坑点）；
  ④ 双端骨架 `vite.config.ts` 增 `exports: 'named'`（消除 Vite named/default 混合导出警告，
  宿主加载器双兼容读取不变）；`@cesiumai/vite-config` admin 工厂补 exports 透传 1.1.1；
  ⑤ 工具轨骨架内置 `frontend/src/utils/cesium.ts`（window.Cesium 取用；L5-R2 补
  「禁止裸 import 'cesium'」红线说明——宿主 import map 无 cesium 键）。

## [1.0.0] - 2026-10-06

- 导出工具链 v2.0.0（scripts/build/export-plugin-template.sh 2.0.0）：产物为完全自包含独立仓——
  ① 新增 `tools/create-extension.sh`（本地脚手架，生成到 `packages/<id>/`，后端 pom 自动改造指向 vendored `maven-repo/`：relativePath 直指 vendored 根 pom + `<repositories>` file 仓）；
  ② 新增 `tools/publish.sh`（仅测试底座：构建 + MinIO SigV4 直传 + resource-manager 注册 + `--dev-url` HMR 回路，prod 一律拒绝）；
  ③ 新增 `tools/menujson.py`（主仓同步副本）与 `tools/check-extension-versions.sh`（packages/ 适配版）；
  ④ 新增 `maven-repo/`（vendored file:// 仓：com.ruoyi 构件闭包 7 件，后端构建免平台仓）；
  ⑤ 新增 `test-env/README.md`（测试底座地址表/账号申请/发布通道/HMR 步骤）与 `packages/README.md`（提测规范）；
  ⑥ npm workspace 改 glob（`packages/*/frontend`、`packages/*/admin-ui`），建包免手改 workspaces；
  ⑦ 资产清洗：源头 9 文件去生产地址/内部路径/运维手册指针（导出闸口全量 grep 兜底）。
