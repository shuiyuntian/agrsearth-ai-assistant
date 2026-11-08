#!/usr/bin/env node
//
// 文件作用：模板仓本地脚手架（Node 唯一实现）——从 skeletons 生成插件包到
//          extensions/<track>/<tier>/<id>/；tools/create-extension.sh / .cmd 为薄 shim
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：2.1.0
// 修改记录：
//   - 2.1.0 (2026-11-08) 随包 CSS 骨架纳入包级占位符替换
//   - 2.0.1 (2026-11-08) menujson.py 退役连带：生成 README 的 menu.json 校验提示改指
//     tools/publish.sh 发布期自动校验（validateMenuDocument）
//   - 2.0.0 (2026-11-07) Node 单实现替代 bash 脚手架（同 publish.mjs 2.0.0 模式）：不再依赖
//     bash/jq/python3/sed/tr；jq 的 manifest 改写由 JSON.parse+stringify 等价（2 空格缩进、
//     保序、原生 UTF-8、尾换行，已实测字节一致）；pom 改造与公开示例控制器改写内联为 JS；
//     TODAY 支持 AGRSEARTH_TODAY 覆盖（golden master 重放锚点）。有意差异：复制骨架时跳过
//     node_modules/（骨架内的 node_modules 是本地 npm install 产物，gitignored 不随仓分发，
//     属环境污染而非契约；新包依赖一律经仓根 npm install 重建）
//   - 1.x 见 git 历史中 bash 版 tools/create-extension.sh 的文件头（1.0.0 初始创建 …
//     1.1.1 AGRSEARTH_PYTHON 覆盖）
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 用法：node tools/create-extension.mjs <pkg-id> --track tool|system --tier platform|business
//          [--delivery bundled|optional] [--name <中文名>] [--icon <图标>]
//          [--with-backend] [--backend <service-id>]（可重复；tool 轨至多 1 个）
//          [--with-admin-ui]
//
// 生成位置：extensions/<track>/<tier>/<pkg-id>/（与平台仓布局同构，验收后管理员纯拷贝移植）
// 生成后：npm install（根 workspace glob 自动覆盖新包）→ 开发 → tools/check-extension-versions.sh
//         → tools/publish.sh extensions/<track>/<tier>/<pkg-id>（仅测试底座）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const VALID_ID = /^[a-z0-9-]+$/;
// 包树内统一占位符替换的文件类型过滤（含随包 CSS 的包级类名）
const TOKEN_FILE = /\.(json|ts|md|yaml|yml|sh|css)$/;

export class ScaffoldError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ScaffoldError";
  }
}

function fail(message, options) {
  throw new ScaffoldError(message, options);
}

function usage() {
  return "用法：create-extension <pkg-id> --track tool|system --tier platform|business"
    + " [--delivery bundled|optional] [--name <中文名>] [--icon <图标>]"
    + " [--with-backend] [--backend <service-id>] [--with-admin-ui]";
}

export function parseArgs(argv) {
  const result = {
    pkgId: "",
    track: "",
    tier: "",
    delivery: "",
    name: "",
    icon: "MapLocation",
    withBackend: false,
    withAdminUi: false,
    backends: [],
    help: false,
  };
  const take = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined) fail(`参数 ${flag} 缺少取值\n${usage()}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--track") { result.track = take(i, arg); i += 1; }
    else if (arg === "--tier") { result.tier = take(i, arg); i += 1; }
    else if (arg === "--delivery") { result.delivery = take(i, arg); i += 1; }
    else if (arg === "--name") { result.name = take(i, arg); i += 1; }
    else if (arg === "--icon") { result.icon = take(i, arg); i += 1; }
    else if (arg === "--with-backend") result.withBackend = true;
    else if (arg === "--with-admin-ui") result.withAdminUi = true;
    else if (arg === "--backend") { result.backends.push(take(i, arg)); i += 1; }
    else if (arg === "-h" || arg === "--help") result.help = true;
    else if (arg.startsWith("-")) fail(`无法识别的参数：${arg}`);
    else if (!result.pkgId) result.pkgId = arg;
    else fail(`多余的参数：${arg}`);
  }
  return result;
}

// 参数校验与派生（顺序与原 bash 版一致：先组合校验，再默认服务名注入）
export function resolvePlan(args) {
  if (!args.pkgId || !args.track || !args.tier) fail(usage());
  if (!VALID_ID.test(args.pkgId)) fail(`pkg-id 只能包含小写字母、数字和中划线：${args.pkgId}`);
  if (args.track !== "tool" && args.track !== "system") fail("--track 仅支持 tool（工具轨）/ system（系统轨）");
  if (args.tier !== "platform" && args.tier !== "business") fail("--tier 仅支持 platform（平台归属）/ business（业务归属）");
  let delivery = args.delivery;
  if (args.track === "tool" && args.tier === "business") {
    delivery = delivery || "optional";
    if (delivery !== "bundled" && delivery !== "optional") {
      fail(`--delivery 仅支持 bundled（标配）/ optional（选装）：${delivery}`);
    }
  } else if (delivery) {
    fail("--delivery 仅适用于 --track tool --tier business 组合");
  }
  const backends = [...args.backends];
  if (args.track === "tool" && backends.length > 1) {
    fail(`工具轨（tool）至多一个后台微服务（--backend 重复 ${backends.length} 次）——多服务体量请归系统轨（--track system）`);
  }
  if (args.withBackend && backends.length === 0) backends.push(`${args.pkgId}-server`);
  if (args.track === "system" && backends.length === 0) {
    // 系统轨默认沿用骨架示例：主服务 + 工作组件
    backends.push(`${args.pkgId}-server`, `${args.pkgId}-worker`);
  }
  for (const svc of backends) {
    if (!VALID_ID.test(svc)) fail(`--backend service-id 只能包含小写字母、数字和中划线：${svc}`);
  }
  return { ...args, delivery, backends, name: args.name || args.pkgId };
}

// 派生命名：球端 UMD 全局名 / admin-ui UMD 全局名（AdminUI_<packageId 去非字母数字>）
export function deriveNames(pkgId) {
  return {
    globalName: `Capability_${pkgId.replaceAll("-", "_")}`,
    adminGlobalName: `AdminUI_${pkgId.replace(/[^a-zA-Z0-9]/g, "")}`,
  };
}

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    fail(`JSON 解析失败（${file}）：${error.message}`, { cause: error });
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

// 复制骨架树：跳过 node_modules（本地环境污染，见文件头 2.0.0 记录）与 .DS_Store
function copySkeleton(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("node_modules") && path.basename(source) !== ".DS_Store",
  });
}

// 包树内统一占位符替换（token 全集 = skeletons 实际占位值 + backend/container 模板 __TOKEN__；
// pairs 顺序敏感：长 token 先替换，与原 bash sed 多 -e 顺序语义一致）
function replaceTokens(root, pairs, { allFiles = false } = {}) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!allFiles && !TOKEN_FILE.test(entry.name) && entry.name !== "Dockerfile") continue;
      const original = readText(full);
      let text = original;
      for (const [from, to] of pairs) {
        if (text.includes(from)) text = text.replaceAll(from, to);
      }
      if (text !== original) fs.writeFileSync(full, text, "utf8");
    }
  };
  walk(root);
}

// pom 改造（模板仓关键差异，platform 仓实例化为 6 层 relativePath 指回主仓）：
//   ① parent relativePath 直指 vendored 根 pom 文件（相对模块目录定位，免表达式免仓库解析——
//     parent 解析阶段 ${project.basedir} 尚未插值，仓库 URL 里的表达式此时不可用）；
//   ② 同步改写集成约定注释（模板仓 vendored 形态 6 层，不再保留骨架的平台仓表述）；
//   ③ 注入 <repositories> 指向 vendored file:// 仓（依赖解析期插值生效，basedir 六层到仓根）
function rewritePom(pomFile) {
  let text = readText(pomFile);
  text = text.replaceAll(
    /<relativePath>[^<]*<\/relativePath>/g,
    "<relativePath>../../../../../../maven-repo/com/ruoyi/ruoyi/3.6.8/ruoyi-3.6.8.pom</relativePath>",
  );
  text = text.replaceAll(
    "  - parent 对齐平台 platform/backend/ruoyi-cloud/pom.xml；relativePath 固定 6 层，\n"
      + "    对应仓内布局 extensions/<track>/<tier>/<pkg>/backend/<svc>/pom.xml（目录唯一规则，ADR-010）",
    "  - parent 指向 vendored 根 pom（file://maven-repo，相对本 pom 六层到仓根）——模板仓实例化形态，\n"
      + "    独立构建不依赖平台仓（平台仓内实例化才是 6 层 relativePath 回 platform/backend/ruoyi-cloud）",
  );
  const repos = "    <repositories>\n"
    + "        <repository>\n"
    + "            <id>agrsearth-vendored</id>\n"
    + "            <name>AGRSEarth vendored com.ruoyi artifacts</name>\n"
    + "            <url>file://${project.basedir}/../../../../../../maven-repo</url>\n"
    + "        </repository>\n"
    + "    </repositories>\n"
    + "\n"
    + "</project>";
  if (!text.includes("agrsearth-vendored")) {
    if (!text.includes("</project>")) fail(`pom 缺少 </project> 结束标签：${pomFile}`);
    text = text.replace("</project>", repos);
  }
  fs.writeFileSync(pomFile, text, "utf8");
  if (!text.includes("agrsearth-vendored") || !text.includes("maven-repo/com/ruoyi/ruoyi")) {
    fail(`pom 改造失败（relativePath 直指 vendored 根 pom / repositories 注入）：${pomFile}`);
  }
  if (text.includes("relativePath 固定 6 层")) {
    fail(`pom 集成约定注释改写失败（仍残留平台仓 6 层表述）：${pomFile}`);
  }
}

// 公开示例控制器改写：info 自检端点 → example/list 空列表样例（与前端 API.exampleList 契约对齐）
function rewritePublicController(controllerFile) {
  const replacements = [
    ["示例信息控制器（服务自检/版本信息）", "示例列表控制器（rows/total 空样例）"],
    ["示例信息控制器：服务自检与版本信息（联通性冒烟用，可按需删除）。", "示例列表控制器：与前端 API.exampleList 契约对齐。"],
    ['@RequestMapping("/info")', '@RequestMapping("/example")'],
    ["@GetMapping\n", '@GetMapping("/list")\n'],
    ["服务信息自检端点", "示例列表端点"],
    ["@return 服务 id、所属能力包、版本与当前时间", "@return 示例列表（rows/total）及服务元信息"],
    ["public R<Map<String, Object>> info()", "public R<Map<String, Object>> list()"],
    [
      "        Map<String, Object> data = new LinkedHashMap<>();",
      "        Map<String, Object> data = new LinkedHashMap<>();\n"
        + "        data.put(\"rows\", java.util.List.of());\n"
        + "        data.put(\"total\", 0);",
    ],
  ];
  let text = readText(controllerFile);
  for (const [from, to] of replacements) {
    if (!text.includes(from)) fail(`公开示例控制器对齐失败，缺少预期片段：${from}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(controllerFile, text, "utf8");
}

// 后端骨架实例化（backend/svc-placeholder + container/svc-placeholder），pom 改造指向 vendored maven-repo
function instantiateBackend(context, svcId, svcPort, publicApi) {
  const tplBackend = path.join(REPO_ROOT, "backend", "svc-placeholder");
  const tplContainer = path.join(REPO_ROOT, "container", "svc-placeholder");
  const backendDir = path.join(context.pkgDir, "backend", svcId);
  const containerDir = path.join(context.pkgDir, "container", svcId);
  if (!fs.existsSync(tplBackend) || !fs.existsSync(tplContainer)) {
    fail(`后端骨架模板缺失（${tplBackend} / ${tplContainer}）`);
  }

  // 派生值：Java 包段（服务 id 去中划线）/ 启动类名（帕斯卡+Application）/ 环境变量写法（大写下划线）
  const javaDir = svcId.replaceAll("-", "");
  const appClass = `${svcId.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}Application`;
  const svcEnv = svcId.toUpperCase().replaceAll("-", "_");

  fs.mkdirSync(backendDir, { recursive: true });
  fs.mkdirSync(containerDir, { recursive: true });
  copySkeleton(tplBackend, backendDir);
  fs.rmSync(path.join(backendDir, "README.md"), { force: true });
  copySkeleton(tplContainer, containerDir);
  fs.rmSync(path.join(containerDir, "README.md"), { force: true });
  const buildSh = path.join(containerDir, "build.sh");
  try {
    fs.chmodSync(buildSh, fs.statSync(buildSh).mode | 0o111);
  } catch { /* Windows 无 exec 位语义，忽略 */ }

  // 目录/文件名占位符：Java 包目录与启动类文件改名
  fs.renameSync(
    path.join(backendDir, "src", "main", "java", "com", "ruoyi", "__JAVA_DIR__"),
    path.join(backendDir, "src", "main", "java", "com", "ruoyi", javaDir),
  );
  fs.renameSync(
    path.join(backendDir, "src", "main", "java", "com", "ruoyi", javaDir, "__APP_CLASS__.java"),
    path.join(backendDir, "src", "main", "java", "com", "ruoyi", javaDir, `${appClass}.java`),
  );

  // 内容占位符替换（token 全集见 backend/svc-placeholder/README.md 占位符表；全文件无类型过滤）
  replaceTokens(backendDir, backendTokens(context, { svcId, svcPort, javaDir, appClass, svcEnv }), { allFiles: true });
  replaceTokens(containerDir, backendTokens(context, { svcId, svcPort, javaDir, appClass, svcEnv }), { allFiles: true });

  rewritePom(path.join(backendDir, "pom.xml"));

  if (publicApi) {
    rewritePublicController(
      path.join(backendDir, "src", "main", "java", "com", "ruoyi", javaDir, "controller", "SampleController.java"),
    );
  }
}

function backendTokens(context, svc) {
  return [
    ["__SVC_ENV__", svc.svcEnv],
    ["__SVC_PORT__", String(svc.svcPort)],
    ["__SVC_ID__", svc.svcId],
    ["__APP_CLASS__", svc.appClass],
    ["__JAVA_DIR__", svc.javaDir],
    ["__PKG_ID__", context.pkgId],
    ["__PKG_NAME__", context.name],
    ["__TRACK__", context.track],
    ["__TIER__", context.tier],
    ["__TODAY__", context.today],
  ];
}

// admin-ui 骨架实例化（两轨共用）：复制 + npm 包名/UMD 全局名替换 + 入口 manifest 单点改写
function instantiateAdminUi(context, extraPairs = []) {
  const adminDir = path.join(context.pkgDir, "admin-ui");
  copySkeleton(path.join(REPO_ROOT, "skeletons", "admin-ui"), adminUiDir(context));
  fs.rmSync(path.join(adminUiDir(context), "dist"), { recursive: true, force: true });
  replaceTokens(adminUiDir(context), [
    ["agrsearth-plugin-admin-ui-example", `@agrsearth/ext-${context.pkgId}-admin`],
    ["AdminUI_example", context.adminGlobalName],
    ...extraPairs,
  ]);
  // admin-ui 入口 manifest 同步本包 id/中文名（sed 无 g：各模式各据一行，等价于全文件首个替换）
  const indexFile = path.join(adminUiDir(context), "src", "index.ts");
  let text = readText(indexFile);
  text = text.replace("id: 'example-tool'", `id: '${context.pkgId}'`);
  text = text.replace("name: '示例工具（管理页）'", `name: '${context.name}（管理页）'`);
  fs.writeFileSync(indexFile, text, "utf8");
  return adminDir;
}

function adminUiDir(context) {
  return path.join(context.pkgDir, "admin-ui");
}

function scaffoldTool(context) {
  copySkeleton(path.join(REPO_ROOT, "skeletons", "tool"), context.pkgDir);
  // 骨架预置的示例产物与文档不随包带走（构建期重新生成）
  fs.rmSync(path.join(context.pkgDir, "frontend", "dist"), { recursive: true, force: true });
  // 骨架示例值 → 本包值（顺序敏感：长 token 先替换）
  replaceTokens(context.pkgDir, [
    ["工具轨能力包最小骨架：球端面板，可选管理页/薄后端；复制本骨架改名即用", `${context.name}（工具轨能力包）`],
    ["示例工具（骨架）", context.name],
    ["示例工具", context.name],
    ["example-tool", context.pkgId],
    ["example:data", `${context.pkgId}:data`],
    ["agrsearth-plugin-tool-example", `@agrsearth/ext-${context.pkgId}`],
    ["Capability_example", context.globalName],
    ["工具轨能力包骨架（复制后修改）", `${context.name}（工具轨能力包）`],
  ]);
  if (context.withAdminUi) {
    instantiateAdminUi(context);
    // manifest components.adminUi 显式置真（admin-ui 通道契约，禁止推导）
    const manifestFile = path.join(context.pkgDir, "manifest.json");
    const manifest = readJson(manifestFile);
    manifest.components.adminUi = true;
    writeJson(manifestFile, manifest);
  }
  if (context.backends.length) {
    const svc = context.backends[0];
    instantiateBackend(context, svc, 8080, true);
    const k8sDir = path.join(context.pkgDir, "deploy", "k8s");
    fs.renameSync(path.join(k8sDir, "10-example-server.yaml"), path.join(k8sDir, `10-${svc}.yaml`));
    replaceTokens(k8sDir, [["example-server", svc]]);
    replaceTokens(path.join(context.pkgDir, "frontend", "src", "api"), [["example-server", svc]]);
    if (context.withAdminUi) replaceTokens(adminUiDir(context), [["example-server", svc]]);
    // manifest components.backend / backendServices 与骨架服务一致
    const manifestFile = path.join(context.pkgDir, "manifest.json");
    const manifest = readJson(manifestFile);
    manifest.components.backend = [svc];
    manifest.backendServices = [{
      serviceId: svc,
      name: `${svc} 服务`,
      required: true,
      apiPrefix: `/${svc}`,
      healthEndpoint: `/${svc}/actuator/health`,
      imageSource: "self",
    }];
    writeJson(manifestFile, manifest);
  }
}

function scaffoldSystem(context) {
  copySkeleton(path.join(REPO_ROOT, "skeletons", "system"), context.pkgDir);
  // 骨架示例值 → 本包值（顺序敏感：service 名先于包名；长 token 先替换）
  replaceTokens(context.pkgDir, [
    ["系统轨能力包最小骨架：管理面远程页 + 多后端服务 + k8s-bundle；复制本骨架改名即用", `${context.name}（系统轨能力包）`],
    ["示例系统（骨架）", context.name],
    ["示例系统", context.name],
    ["示例主服务", `${context.name}主服务`],
    ["示例工作器", `${context.name}工作器`],
    ["example-system", context.pkgId],
    ["example-server", `${context.pkgId}-server`],
    ["example-worker", `${context.pkgId}-worker`],
  ]);
  // 目录/文件名占位符（container 组件目录与 k8s 工作负载文件名）
  fs.renameSync(
    path.join(context.pkgDir, "container", "example-server"),
    path.join(context.pkgDir, "container", `${context.pkgId}-server`),
  );
  const k8sDir = path.join(context.pkgDir, "deploy", "k8s");
  fs.renameSync(path.join(k8sDir, "10-example-server.yaml"), path.join(k8sDir, `10-${context.pkgId}-server.yaml`));
  fs.renameSync(path.join(k8sDir, "20-example-worker.yaml"), path.join(k8sDir, `20-${context.pkgId}-worker.yaml`));
  // admin-ui：系统轨骨架声明 adminUi=true，复制远程页骨架
  instantiateAdminUi(context, [["example-server", context.backends[0]]]);
  // 后端多组件实例化（端口 8080/8081…，与 skeleton deploy 样例 containerPort 一致）
  context.backends.forEach((svc, index) => {
    instantiateBackend(context, svc, 8080 + index, index === 0);
  });
}

function readmeText(context) {
  const { pkgId, name, track, tier, delivery } = context;
  const deliveryText = delivery ? `，delivery: ${delivery}` : "";
  const deliveryLabel = delivery ? "/delivery" : "";
  const hasAdminUi = context.withAdminUi || track === "system";
  const hasBackend = context.backends.length > 0;
  return `# ${name}（${pkgId}）

${track} 轨能力包（track: ${track}，tier: ${tier}${deliveryText}）。
脚手架由 tools/create-extension.sh 生成（模板仓）。

## 目录

- manifest.json      能力包清单（track/tier${deliveryLabel}+components 显式段；发布时 entries.url 自动回填）
- VERSION            包版本唯一事实源
- frontend/          球端 Capability 工程（cd frontend && npm run build）
${hasAdminUi ? "- admin-ui/          管理面远程页（cd admin-ui && npm run build）" : ""}
${hasBackend ? "- backend/<svc>/     后端微服务（mvn package；com.ruoyi 构件由仓根 maven-repo/ 供给）\n- container/<svc>/   镜像构建（Dockerfile+build.sh+VERSION 组件版本轴）" : ""}
${track === "system" ? "- deploy/k8s/        k8s-bundle（publish 打包一键安装）" : ""}
- data/menu.json     管理面菜单声明样例（示意段禁止直发：package_register 自动切段，dev-mcp resource_list 查实分段后全文替换 menuId；tools/publish.sh 发布时自动校验）

## 开发 → 发布

1. 仓根 npm install（workspace glob 自动覆盖本包 frontend/admin-ui）
2. 开发自测（RELEASE_CHECKLIST.md）
3. ./tools/check-extension-versions.sh
4. ./tools/publish.sh extensions/${track}/${tier}/${pkgId}（仅测试底座；生产发布由平台管理员执行）
`;
}

function changelogText(context) {
  return `# ${context.name} 变更记录

## [0.1.0] - ${context.today}

- 初始脚手架（tools/create-extension.sh 生成，${context.track} 轨）
`;
}

export function runCreate(argv, options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const args = parseArgs(argv);
  if (args.help) {
    logger.log(usage());
    return null;
  }
  const plan = resolvePlan(args);
  const pkgDir = path.join(REPO_ROOT, "extensions", plan.track, plan.tier, plan.pkgId);
  fs.mkdirSync(path.dirname(pkgDir), { recursive: true });
  if (fs.existsSync(pkgDir)) fail(`目录已存在：extensions/${plan.track}/${plan.tier}/${plan.pkgId}`);
  fs.mkdirSync(pkgDir, { recursive: true });

  const context = {
    ...plan,
    ...deriveNames(plan.pkgId),
    pkgDir,
    today: options.today ?? env.AGRSEARTH_TODAY ?? localToday(),
  };
  if (plan.track === "tool") scaffoldTool(context);
  else scaffoldSystem(context);

  fs.writeFileSync(path.join(pkgDir, "README.md"), readmeText(context), "utf8");
  fs.writeFileSync(path.join(pkgDir, "CHANGELOG.md"), changelogText(context), "utf8");

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(toPosix(path.relative(REPO_ROOT, full)));
    }
  };
  walk(pkgDir);
  files.sort();

  const relative = `extensions/${plan.track}/${plan.tier}/${plan.pkgId}`;
  logger.log("==========================================");
  logger.log(`脚手架已生成：${relative}`);
  for (const file of files) logger.log(`  ${file}`);
  logger.log("------------------------------------------");
  logger.log("下一步：");
  logger.log("  1. 完善实现（契约见 docs/L4-概念手册.md / L6-参考契约.md）");
  logger.log("  2. 仓根 npm install && ./tools/check-extension-versions.sh");
  logger.log(`  3. 发布：./tools/publish.sh ${relative}`);
  logger.log("==========================================");
  return { pkgDir, relative, files };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    runCreate(process.argv.slice(2));
  } catch (error) {
    console.error(`错误：${error.message}`);
    if (process.env.SCAFFOLD_DEBUG && error.cause) console.error(error.cause);
    process.exitCode = 1;
  }
}
