/**
 * 文件作用：ast-verifier 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";

/**
 * codegen AST 安全校验（P3-A，parse-only，不执行代码）。
 *
 * 防线（参照 cesiumjs-ai-starter-app codegen-cesium 并堵死其两个已知绕过面：
 * allowedSymbols 未启用、MemberExpression callee 不检查）：
 *  1. 禁用标识符（引用或调用均拒）；
 *  2. 动态 import() / with 语句拒；
 *  3. 计算属性访问拒（obj[expr]，expr 非字面量 —— 防 x['ev'+'al']）；
 *  4. MemberExpression callee 检查（a.b(...) 的 b 命中禁单如 constructor 即拒）；
 *  5. 自由标识符白名单【强制启用】：只允许 Cesium/viewer/内建纯对象，其余一律拒；
 *  6. 4000 字符 / 100 行上限；死循环启发式（while(true){}/for(;;){} 无 break 拒）。
 */
export interface Violation {
  line: number;
  rule: string;
  snippet: string;
}

export interface VerifyResult {
  ok: boolean;
  violations: Violation[];
}

export const MAX_CODE_CHARS = 4000;
export const MAX_CODE_LINES = 100;

/** 自由标识符白名单（强制启用；其余自由标识符一律拒） */
export const FREE_IDENTIFIER_WHITELIST: ReadonlySet<string> = new Set([
  "Cesium",
  "viewer",
  // 内建纯对象/函数
  "Math",
  "JSON",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "Date",
  "Promise",
  "console",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "BigInt",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Infinity",
  "NaN",
  "undefined",
]);

/** 禁用标识符（引用或调用均拒；同时并入成员名禁单） */
export const DENIED_IDENTIFIERS: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "open",
  "alert",
  "confirm",
  "prompt",
  // setTimeout/setInterval：白名单本就不含（全禁）；字符串首参形态一并覆盖
  "setTimeout",
  "setInterval",
  "Worker",
  "SharedWorker",
  "ServiceWorker",
  "navigator",
  "document",
  "window",
  "globalThis",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "location",
  "history",
]);

/** 成员名禁单（a.b / a.b(...) 的属性名命中即拒；含原型链逃逸面） */
export const DENIED_MEMBER_NAMES: ReadonlySet<string> = new Set([
  ...DENIED_IDENTIFIERS,
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

type AnyNode = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 收集全部声明名（var/let/const/函数/参数/类/catch 参数），用于区分自由/绑定标识符 */
function collectDeclared(ast: AnyNode): Set<string> {
  const declared = new Set<string>();
  const collectPattern = (node: AnyNode | null | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        declared.add(node.name);
        return;
      case "ObjectPattern":
        for (const p of node.properties ?? []) {
          collectPattern(p.type === "Property" ? p.value : p);
        }
        return;
      case "ArrayPattern":
        for (const el of node.elements ?? []) collectPattern(el);
        return;
      case "RestElement":
        collectPattern(node.argument);
        return;
      case "AssignmentPattern":
        collectPattern(node.left);
        return;
      default:
        return;
    }
  };
  walk.full(ast as never, (node: AnyNode) => {
    switch (node.type) {
      case "VariableDeclarator":
        collectPattern(node.id);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) collectPattern(node.id);
        for (const p of node.params ?? []) collectPattern(p);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) collectPattern(node.id);
        break;
      case "CatchClause":
        collectPattern(node.param);
        break;
      default:
        break;
    }
  });
  return declared;
}

/** 标识符是否处于非引用位置（属性名/键/标签/声明位） */
function isNonReferencePosition(parent: AnyNode | undefined, node: AnyNode): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return !parent.computed && parent.property === node;
    case "Property":
    case "PropertyDefinition":
    case "MethodDefinition":
      // {x: ...} 的 key（非 shorthand、非 computed）；shorthand 的 {x} 同时是值引用
      return parent.key === node && !parent.computed && parent.shorthand !== true;
    case "ObjectPattern":
    case "ArrayPattern":
      return true; // 绑定位置
    case "AssignmentPattern":
      return parent.left === node; // 右侧默认值仍是表达式
    case "RestElement":
      return true;
    case "VariableDeclarator":
      return parent.id === node;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return parent.id === node || (parent.params ?? []).includes(node);
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id === node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label === node;
    case "CatchClause":
      return parent.param === node;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return true;
    default:
      return false;
  }
}

/** 死循环启发式：循环体子树内是否存在 break */
function hasBreak(loopNode: AnyNode): boolean {
  let found = false;
  walk.simple(loopNode as never, {
    BreakStatement() {
      found = true;
    },
  });
  return found;
}

export function verifyCode(code: string): VerifyResult {
  const violations: Violation[] = [];
  const push = (line: number, rule: string, snippet: string): void => {
    violations.push({ line, rule, snippet });
  };

  // 体积上限
  if (code.length > MAX_CODE_CHARS) {
    push(1, "max-chars", `代码 ${code.length} 字符，超过上限 ${MAX_CODE_CHARS}`);
  }
  const lineCount = code.split("\n").length;
  if (lineCount > MAX_CODE_LINES) {
    push(1, "max-lines", `代码 ${lineCount} 行，超过上限 ${MAX_CODE_LINES}`);
  }

  let ast: AnyNode;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "script", // import/export 直接 parse 失败 → 拒
      locations: true,
      allowReturnOutsideFunction: true,
    }) as AnyNode;
  } catch (err) {
    push(
      (err as { loc?: { line: number } }).loc?.line ?? 1,
      "parse-error",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, violations };
  }

  const declared = collectDeclared(ast);

  walk.fullAncestor(
    ast as never,
    (node: AnyNode, _state: unknown, ancestors: AnyNode[]) => {
      const line: number = node.loc?.start?.line ?? 1;
      const parent = ancestors[ancestors.length - 2];

      switch (node.type) {
        case "ImportExpression":
          push(line, "dynamic-import", "import(...)");
          return;
        case "WithStatement":
          push(line, "with-statement", "with (...) 禁止");
          return;
        case "MetaProperty":
          push(line, "meta-property", `${node.meta?.name}.${node.property?.name}`);
          return;
        case "MemberExpression":
        case "OptionalMemberExpression": {
          if (node.computed) {
            // 计算属性：只允许字面量键（防 x['ev'+'al'] / x[`ev${x}l`]）
            if (node.property?.type !== "Literal") {
              push(line, "computed-member-access", "obj[非字面量表达式]");
            }
          } else if (
            node.property?.type === "Identifier" &&
            DENIED_MEMBER_NAMES.has(node.property.name)
          ) {
            push(line, "denied-member", `.${node.property.name}`);
          }
          return;
        }
        case "CallExpression":
        case "NewExpression": {
          const callee = node.callee;
          if (callee?.type === "Identifier" && DENIED_IDENTIFIERS.has(callee.name)) {
            push(line, "denied-call", `${callee.name}(...)`);
          } else if (
            callee?.type === "MemberExpression" &&
            !callee.computed &&
            callee.property?.type === "Identifier" &&
            DENIED_MEMBER_NAMES.has(callee.property.name)
          ) {
            // MemberExpression callee 检查（堵 x.constructor('...')()）
            push(line, "denied-member-call", `*.${callee.property.name}(...)`);
          }
          return;
        }
        case "Identifier": {
          if (isNonReferencePosition(parent, node)) return;
          const name: string = node.name;
          if (declared.has(name)) return;
          if (FREE_IDENTIFIER_WHITELIST.has(name)) return;
          if (DENIED_IDENTIFIERS.has(name)) {
            push(line, "denied-identifier", name);
          } else {
            push(line, "free-identifier-not-whitelisted", name);
          }
          return;
        }
        case "WhileStatement": {
          if (node.test?.type === "Literal" && node.test.value === true && !hasBreak(node)) {
            push(line, "infinite-loop", "while (true) 无 break");
          }
          return;
        }
        case "DoWhileStatement": {
          if (node.test?.type === "Literal" && node.test.value === true && !hasBreak(node)) {
            push(line, "infinite-loop", "do { } while (true) 无 break");
          }
          return;
        }
        case "ForStatement": {
          if (node.test == null && !hasBreak(node)) {
            push(line, "infinite-loop", "for (;;) 无 break");
          }
          return;
        }
        default:
          return;
      }
    },
  );

  return { ok: violations.length === 0, violations };
}
