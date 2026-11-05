#!/usr/bin/env node
//
// 文件作用：前后端 URL 契约静态对账——API 常量表与公开后端 Spring Mapping 全路径双向 diff
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-05
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-05) 初始创建（issue #6；Node 跨平台实现，支持发布前本地闸口）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAPPING_NAMES = new Set([
  "RequestMapping",
  "GetMapping",
  "PostMapping",
  "PutMapping",
  "DeleteMapping",
  "PatchMapping",
]);

export class ApiContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiContractError";
  }
}

function fail(message) {
  throw new ApiContractError(message);
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function walk(directory, extension, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, extension, output);
    else if (entry.isFile() && file.endsWith(extension)) output.push(file);
  }
  return output.sort();
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) quote = char;
    else if (char === "(") round += 1;
    else if (char === ")") round -= 1;
    else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (char === "," && round === 0 && square === 0 && curly === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function stringLiterals(text) {
  const values = [];
  let quote = "";
  let escaped = false;
  let value = "";
  for (const char of text) {
    if (!quote) {
      if (char === "\"" || char === "'") {
        quote = char;
        value = "";
      }
      continue;
    }
    if (escaped) {
      value += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      values.push(value);
      quote = "";
    } else {
      value += char;
    }
  }
  return values;
}

function findAnnotations(source) {
  const annotations = [];
  const pattern = /@([A-Za-z]+Mapping)\b/g;
  for (const match of source.matchAll(pattern)) {
    if (!MAPPING_NAMES.has(match[1])) continue;
    let cursor = match.index + match[0].length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    let args = "";
    if (source[cursor] === "(") {
      const start = cursor + 1;
      let depth = 1;
      let quote = "";
      let escaped = false;
      cursor += 1;
      for (; cursor < source.length && depth > 0; cursor += 1) {
        const char = source[cursor];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === quote) quote = "";
          continue;
        }
        if (char === "\"" || char === "'") quote = char;
        else if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
      }
      if (depth !== 0) fail(`Mapping 注解括号未闭合：${match[0]}`);
      args = source.slice(start, cursor - 1);
    }
    annotations.push({ name: match[1], args, index: match.index });
  }
  return annotations;
}

function annotationPaths(args) {
  if (!args.trim()) return [""];
  const paths = [];
  for (const segment of splitTopLevel(args)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const named = trimmed.match(/^(value|path)\s*=\s*([\s\S]+)$/);
    if (trimmed.includes("=") && !named) continue;
    paths.push(...stringLiterals(named ? named[2] : trimmed));
  }
  return paths.length ? paths : [""];
}

function joinUrl(...parts) {
  const joined = parts
    .filter((part) => part != null && String(part).trim() !== "")
    .map((part) => String(part).trim())
    .join("/")
    .replace(/\/+/g, "/");
  const withLeadingSlash = joined.startsWith("/") ? joined : `/${joined}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

function backendEndpoints(pluginDir, service) {
  const serviceDir = path.join(pluginDir, "backend", service.serviceId);
  if (!fs.existsSync(serviceDir)) fail(`公开后端服务缺少源码目录：backend/${service.serviceId}`);
  const endpoints = new Map();
  const files = walk(path.join(serviceDir, "src"), ".java");
  for (const file of files) {
    const source = stripComments(readText(file));
    const classMatch = /\b(?:class|interface)\s+[A-Za-z_$][\w$]*/.exec(source);
    if (!classMatch) continue;
    const classAnnotations = findAnnotations(source.slice(0, classMatch.index))
      .filter((annotation) => annotation.name === "RequestMapping");
    const classAnnotation = classAnnotations.at(-1);
    const classPaths = classAnnotation ? annotationPaths(classAnnotation.args) : [""];
    const methodAnnotations = findAnnotations(source.slice(classMatch.index));
    for (const method of methodAnnotations) {
      for (const classPath of classPaths) {
        for (const methodPath of annotationPaths(method.args)) {
          const url = joinUrl(service.apiPrefix, classPath, methodPath);
          if (!endpoints.has(url)) endpoints.set(url, []);
          endpoints.get(url).push(path.relative(pluginDir, file));
        }
      }
    }
  }
  return endpoints;
}

function objectBody(source, startIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex + 1, index);
    }
  }
  fail("API 常量表对象括号未闭合");
}

function frontendEndpoints(pluginDir, publicServices) {
  const files = [
    path.join(pluginDir, "frontend", "src", "api", "index.ts"),
    path.join(pluginDir, "admin-ui", "src", "api", "index.ts"),
  ].filter((file) => fs.existsSync(file));
  const endpoints = new Map(publicServices.map((service) => [service.serviceId, new Map()]));
  const errors = [];
  const prefixes = [...publicServices].sort((left, right) => right.apiPrefix.length - left.apiPrefix.length);

  for (const file of files) {
    const relative = path.relative(pluginDir, file);
    const source = stripComments(readText(file));
    const constants = new Map();
    for (const match of source.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(["'])(\/[^"']*)\2/g)) {
      constants.set(match[1], match[3]);
    }
    const apiMatch = /export\s+const\s+API\s*=\s*\{/.exec(source);
    if (!apiMatch) fail(`${relative} 缺少 export const API = { ... } 常量表`);
    const body = objectBody(source, apiMatch.index + apiMatch[0].length - 1);
    const propertyCount = [...body.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/gm)].length;
    let parsedCount = 0;
    for (const match of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(["'`])([\s\S]*?)\2/g)) {
      parsedCount += 1;
      let url = match[3];
      if (match[2] === "`") {
        url = url.replace(/\$\{([^}]+)\}/g, (_, expression) => {
          const name = expression.trim();
          if (constants.has(name)) return constants.get(name);
          if (/^[a-z_$][\w$]*$/.test(name)) return `{${name}}`;
          return fail(`${relative} 的 API.${match[1]} 含无法静态解析的表达式：\${${expression}}`);
        });
      }
      if (url.includes("${")) fail(`${relative} 的 API.${match[1]} 含未解析模板表达式`);
      if (!url.startsWith("/")) fail(`${relative} 的 API.${match[1]} 不是以 / 开头的后端路径：${url}`);
      url = joinUrl(url);
      const service = prefixes.find((candidate) => url === candidate.apiPrefix || url.startsWith(`${candidate.apiPrefix}/`));
      if (!service) {
        errors.push(`${relative} 的 API.${match[1]} 未命中任何公开 apiPrefix：${url}`);
        continue;
      }
      const serviceEndpoints = endpoints.get(service.serviceId);
      if (!serviceEndpoints.has(url)) serviceEndpoints.set(url, []);
      serviceEndpoints.get(url).push(`${relative}#API.${match[1]}`);
    }
    if (parsedCount !== propertyCount) {
      fail(`${relative} 的 API 常量表含不支持的动态值；仅支持字符串或 \`\${SVC}/path\` 静态模板`);
    }
  }
  return { files, endpoints, errors };
}

function scatteredUrls(pluginDir, publicServices) {
  const errors = [];
  for (const sourceRoot of ["frontend/src", "admin-ui/src"]) {
    const root = path.join(pluginDir, sourceRoot);
    if (!fs.existsSync(root)) continue;
    const files = walk(root, ".ts").concat(walk(root, ".vue"));
    for (const file of files) {
      const relative = path.relative(pluginDir, file).split(path.sep).join("/");
      if (relative.includes("/api/")) continue;
      const source = stripComments(readText(file));
      for (const match of source.matchAll(/(["'`])(\/[^"'`]*)\1/g)) {
        for (const service of publicServices) {
          if (match[2] === service.apiPrefix || match[2].startsWith(`${service.apiPrefix}/`)) {
            errors.push(`${relative} 散落本包服务 URL：${match[2]}`);
          }
        }
      }
    }
  }
  return errors;
}

export function checkApiContract(pluginArg) {
  const pluginDir = path.resolve(pluginArg);
  const manifestFile = path.join(pluginDir, "manifest.json");
  if (!fs.existsSync(manifestFile)) fail(`未找到 manifest.json：${manifestFile}`);
  const manifest = JSON.parse(readText(manifestFile));
  const publicServices = (manifest.backendServices ?? [])
    .filter((service) => service.serviceId && service.apiPrefix)
    .map((service) => ({ ...service, apiPrefix: joinUrl(service.apiPrefix) }));
  if (!publicServices.length) {
    return { skipped: true, reason: "无带 apiPrefix 的公开后端服务", services: [], endpointCount: 0 };
  }
  const hasUi = manifest.components?.frontend === true || manifest.components?.adminUi === true ||
    fs.existsSync(path.join(pluginDir, "frontend", "src")) || fs.existsSync(path.join(pluginDir, "admin-ui", "src"));
  if (!hasUi) return { skipped: true, reason: "无球端或管理页", services: [], endpointCount: 0 };

  const backend = new Map(publicServices.map((service) => [service.serviceId, backendEndpoints(pluginDir, service)]));
  const frontend = frontendEndpoints(pluginDir, publicServices);
  const errors = [...frontend.errors, ...scatteredUrls(pluginDir, publicServices)];
  const services = publicServices.map((service) => {
    const frontendUrls = frontend.endpoints.get(service.serviceId);
    const backendUrls = backend.get(service.serviceId);
    const frontendOnly = [...frontendUrls.keys()].filter((url) => !backendUrls.has(url)).sort();
    const backendOnly = [...backendUrls.keys()].filter((url) => !frontendUrls.has(url)).sort();
    for (const url of frontendOnly) errors.push(`[${service.serviceId}] 前端声明但后端缺失：${url}`);
    for (const url of backendOnly) errors.push(`[${service.serviceId}] 后端存在但前端未声明：${url}`);
    return {
      serviceId: service.serviceId,
      frontend: [...frontendUrls.keys()].sort(),
      backend: [...backendUrls.keys()].sort(),
      frontendOnly,
      backendOnly,
    };
  });
  if (errors.length) fail(`URL 契约对账失败：\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  return {
    skipped: false,
    services,
    frontendFiles: frontend.files.map((file) => path.relative(pluginDir, file)),
    endpointCount: services.reduce((total, service) => total + service.backend.length, 0),
  };
}

export function formatApiContractReport(report) {
  if (report.skipped) return `URL 契约对账：跳过（${report.reason}）`;
  return `URL 契约对账通过：${report.services.length} 个公开服务、${report.endpointCount} 个端点（${report.frontendFiles.join("、")}）`;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const pluginDir = process.argv[2];
  if (!pluginDir) {
    console.error("用法：node tools/check-api-contract.mjs <package-dir>");
    process.exitCode = 2;
  } else {
    try {
      console.log(formatApiContractReport(checkApiContract(pluginDir)));
    } catch (error) {
      console.error(`错误：${error.message}`);
      process.exitCode = 1;
    }
  }
}
