#!/usr/bin/env node
//
// 文件作用：模板仓扩展包版本与文档一致性校验（Node 唯一实现；CI / publish 前置）——
//          tools/check-extension-versions.sh / .cmd 为薄 shim
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-07
// 版本：2.0.1
// 修改记录：
//   - 2.0.1 (2026-11-08) menujson.py 退役：失败详情文案改指 validateMenuDocument
//     （tools/publish.mjs），golden 夹具同步再基线化
//   - 2.0.0 (2026-11-07) Node 单实现替代 bash 校验（同 publish.mjs 2.0.0 模式）：不再依赖
//     bash/jq/python3；menu.json 校验改复用 publish.mjs 的 validateMenuDocument（JS 单实现，
//     规则与已退役 menujson.py validate 等价，由 tests/fixtures/check-versions-golden 夹具背书）；
//     输出表格按字节宽补 padding（bash printf %-Ns 语义，CJK 按 UTF-8 字节计）；
//     CLI 支持 --root <dir>（测试注入夹具根，默认脚本相对仓根）
//   - 1.0.0 (2026-10-06) 初始创建（模板仓 v2.0.0 工具链）——见 git 历史中 bash 版文件头
//
// 版权所有 (C) 2026 AGRSEarth 项目
//
// 校验内容（extensions/*/*/*/ 下 manifest.json 含 track 字段者为受管包；packages/ 供给包无
// manifest 天然豁免）：
//   1. 版本一致：VERSION == manifest.json == frontend/package.json
//      == frontend/src/manifest.ts（如有）== container/*/build.sh SERVICE_VERSION（如有）
//      （组件版本轴例外：container/<svc>/VERSION 存在时该组件走自有版本轴）
//   2. 四必备文件存在：README.md / VERSION / manifest.json / CHANGELOG.md
//   3. DESIGN.md / REPORT.md（如有）文首含「状态：」行
//   4. data/menu.json（如有）通过菜单声明校验
//
// 输出逐包结果表；任一校验失败则 exit 1。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateMenuDocument } from "./publish.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJsonLenient(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

// bash printf 的字段宽度按字节计（CJK 一个字符 3 字节）——Node 侧用 Buffer.byteLength 复刻
function bytePad(value, width) {
  const pad = width - Buffer.byteLength(value, "utf8");
  return pad > 0 ? value + " ".repeat(pad) : value;
}

// 对应 printf '%-32s %-10s %-8s %-8s %-8s %s\n'
function tableRow(name, version, docs, status, menu, verdict) {
  return `${bytePad(name, 32)} ${bytePad(version, 10)} ${bytePad(docs, 8)} ${bytePad(status, 8)} ${bytePad(menu, 8)} ${verdict}`;
}

function stripWhitespace(text) {
  return text.replace(/\s/g, "");
}

// DESIGN.md / REPORT.md 文首 10 行内含「状态：」行（兼容 **状态**: 写法）
function hasStatusLine(file) {
  return readText(file).split("\n").slice(0, 10)
    .some((line) => /状态\*{0,2}\s*[:：]/.test(line));
}

export function checkPackage(pkgDir, pkgName) {
  const details = [];
  const addDetail = (message) => details.push(`  [${pkgName}] ${message}`);
  const pkgVersion = fs.existsSync(path.join(pkgDir, "VERSION"))
    ? stripWhitespace(readText(path.join(pkgDir, "VERSION")))
    : "";
  let failed = false;

  // ---- 1. 版本一致 ----
  let versionOk = "✔";
  const manifest = readJsonLenient(path.join(pkgDir, "manifest.json"));
  const manifestVersion = manifest?.version ?? "";
  if (manifestVersion !== pkgVersion) {
    versionOk = "✘";
    addDetail(`版本不一致：VERSION=${pkgVersion}，manifest.json=${manifestVersion || "缺失"}`);
    failed = true;
  }
  const frontendPkgFile = path.join(pkgDir, "frontend", "package.json");
  if (fs.existsSync(frontendPkgFile)) {
    const frontendVersion = readJsonLenient(frontendPkgFile)?.version ?? "";
    if (frontendVersion !== pkgVersion) {
      versionOk = "✘";
      addDetail(`版本不一致：VERSION=${pkgVersion}，frontend/package.json=${frontendVersion || "缺失"}`);
      failed = true;
    }
  }
  const manifestTs = path.join(pkgDir, "frontend", "src", "manifest.ts");
  if (fs.existsSync(manifestTs)) {
    const tsVersion = readText(manifestTs).match(/^[ \t]*version:[ \t]*'([^']*)'/m)?.[1] ?? "";
    if (tsVersion !== pkgVersion) {
      versionOk = "✘";
      addDetail(`版本不一致：VERSION=${pkgVersion}，frontend/src/manifest.ts=${tsVersion || "未找到"}`);
      failed = true;
    }
  }
  const containerDir = path.join(pkgDir, "container");
  if (fs.existsSync(containerDir)) {
    const services = fs.readdirSync(containerDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const svc of services) {
      const buildSh = path.join(containerDir, svc, "build.sh");
      if (!fs.existsSync(buildSh)) continue;
      let shVersion = readText(buildSh).match(/^SERVICE_VERSION="([^"]*)"/m)?.[1] ?? "";
      const svcVersionFile = path.join(containerDir, svc, "VERSION");
      // 组件版本轴：container/<svc>/VERSION 存在时组件走自有版本轴，build.sh 与其对齐
      if (fs.existsSync(svcVersionFile)) {
        const svcVersion = stripWhitespace(readText(svcVersionFile));
        if (shVersion.includes("$(cat VERSION")) shVersion = svcVersion;
        if (shVersion !== svcVersion) {
          versionOk = "✘";
          addDetail(`组件版本不一致：container/${svc}/VERSION=${svcVersion}，build.sh SERVICE_VERSION=${shVersion || "未找到"}`);
          failed = true;
        }
      } else if (shVersion !== pkgVersion) {
        versionOk = "✘";
        addDetail(`版本不一致：VERSION=${pkgVersion}，container/${svc}/build.sh SERVICE_VERSION=${shVersion || "未找到"}`);
        failed = true;
      }
    }
  }

  // ---- 2. 四必备文件 ----
  let docsOk = "✔";
  for (const required of ["README.md", "VERSION", "manifest.json", "CHANGELOG.md"]) {
    if (!fs.existsSync(path.join(pkgDir, required))) {
      docsOk = "✘";
      addDetail(`缺少必备文件：${required}`);
      failed = true;
    }
  }

  // ---- 3. DESIGN.md / REPORT.md 状态行（如有）----
  let statusOk = "-";
  for (const doc of ["DESIGN.md", "REPORT.md"]) {
    const docFile = path.join(pkgDir, doc);
    if (fs.existsSync(docFile)) {
      statusOk = "✔";
      if (!hasStatusLine(docFile)) {
        statusOk = "✘";
        addDetail(`${doc} 文首缺少「状态：」行`);
        failed = true;
      }
    }
  }

  // ---- 4. data/menu.json 本地校验（如有）----
  let menuOk = "-";
  const menuFile = path.join(pkgDir, "data", "menu.json");
  if (fs.existsSync(menuFile)) {
    menuOk = "✔";
    const pkgId = manifest?.id ?? "";
    const menuDoc = readJsonLenient(menuFile);
    if (!menuDoc || validateMenuDocument(menuDoc, pkgId).length > 0) {
      menuOk = "✘";
      addDetail("data/menu.json 未通过 validateMenuDocument 校验（tools/publish.mjs）");
      failed = true;
    }
  }

  return { versionOk, docsOk, statusOk, menuOk, failed, details };
}

// 包发现：extensions/*/*/*/manifest.json 且含 track 字段（等价 find -mindepth 4 -maxdepth 4
// + jq has("track")；JSON 解析失败视同无 track 跳过，与 bash 管道静默语义一致）
function discoverManifests(rootDir) {
  const extensionsDir = path.join(rootDir, "extensions");
  const manifests = [];
  if (!fs.existsSync(extensionsDir)) return manifests;
  const subdirs = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => path.join(dir, entry.name));
  for (const trackDir of subdirs(extensionsDir)) {
    for (const tierDir of subdirs(trackDir)) {
      for (const pkgDir of subdirs(tierDir)) {
        const manifestFile = path.join(pkgDir, "manifest.json");
        if (!fs.existsSync(manifestFile)) continue;
        const doc = readJsonLenient(manifestFile);
        if (doc && Object.hasOwn(doc, "track")) manifests.push(manifestFile);
      }
    }
  }
  manifests.sort();
  return manifests;
}

export function runCheck(options = {}) {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const lines = [];
  const log = (line) => {
    lines.push(line);
    options.logger?.log?.(line);
  };

  log("==============================================");
  log("扩展包版本与文档一致性检查（extensions/）");
  log("==============================================");
  log(tableRow("包", "版本一致", "四必备", "状态行", "menu.json", "结论"));
  log(tableRow("--------------------------------", "--------", "------", "------", "---------", "--------"));

  let passCount = 0;
  let failCount = 0;
  const details = [];
  for (const manifestFile of discoverManifests(rootDir)) {
    const pkgDir = path.dirname(manifestFile);
    const pkgName = toPosix(path.relative(rootDir, pkgDir));
    const result = checkPackage(pkgDir, pkgName);
    details.push(...result.details);
    if (result.failed) {
      failCount += 1;
      log(tableRow(pkgName, result.versionOk, result.docsOk, result.statusOk, result.menuOk, "✘ 失败"));
    } else {
      passCount += 1;
      log(tableRow(pkgName, result.versionOk, result.docsOk, result.statusOk, result.menuOk, "✔ 通过"));
    }
  }

  log("==============================================");
  log(`共 ${passCount + failCount} 个包：通过 ${passCount}，失败 ${failCount}`);
  if (failCount > 0) {
    log("");
    log("失败详情：");
    for (const detail of details) log(detail);
  }
  return { passCount, failCount, output: `${lines.join("\n")}\n` };
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  let rootDir;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root" && argv[i + 1]) {
      rootDir = path.resolve(argv[i + 1]);
      i += 1;
    } else {
      console.error(`错误：无法识别的参数：${argv[i]}（仅支持 --root <dir>）`);
      process.exit(1);
    }
  }
  const result = runCheck({ rootDir });
  process.stdout.write(result.output);
  if (result.failCount > 0) process.exitCode = 1;
}
