/**
 * 文件作用：ast-verifier.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it } from "vitest";
import { verifyCode } from "../src/codegen/ast-verifier.js";

/** 注入用例集：必须全部被拦截，且命中预期规则 */
const INJECTION_CASES: Array<[string, string, string]> = [
  ["fetch 网络访问", "fetch('https://evil.example/x')", "denied-identifier"],
  ["document.cookie 读取", "const c = document.cookie;", "denied-identifier"],
  ["localStorage 读取", "const t = localStorage.getItem('token');", "denied-identifier"],
  ["window.open", "window.open('https://evil.example')", "denied-identifier"],
  ["new Function 构造执行", "new Function('return 1')()", "denied-identifier"],
  ["动态 import", "const m = import('x');", "dynamic-import"],
  ["constructor 逃逸", "x.constructor('return 1')()", "denied-member-call"],
  ["计算属性拼接 eval", "obj['ev'+'al']", "computed-member-access"],
  ["模板字符串计算属性", "obj[`ev${'a'}l`]", "computed-member-access"],
  ["while(true) 死循环", "while (true) { doSomething(); } function doSomething() {}", "infinite-loop"],
  ["for(;;) 死循环", "for (;;) { tick(); } function tick() {}", "infinite-loop"],
  ["__proto__ 访问", "const p = obj.__proto__;", "denied-member"],
  ["WebSocket", "const ws = new WebSocket('wss://evil.example');", "denied-identifier"],
  ["XMLHttpRequest", "const x = new XMLHttpRequest();", "denied-identifier"],
  ["EventSource", "const es = new EventSource('/x');", "denied-identifier"],
  ["alert", "alert('x');", "denied-identifier"],
  ["未白名单自由变量 process", "process.env.SECRET;", "free-identifier-not-whitelisted"],
  ["未白名单自由变量 require", "const fs = require('fs');", "free-identifier-not-whitelisted"],
  ["globalThis", "globalThis.evil = 1;", "denied-identifier"],
  ["location 跳转", "location.href = 'https://evil.example';", "denied-identifier"],
  ["setTimeout", "setTimeout(() => {}, 100);", "denied-identifier"],
];

describe("ast-verifier 注入用例集（全拦截）", () => {
  for (const [name, code, rule] of INJECTION_CASES) {
    it(`拦截：${name}`, () => {
      const result = verifyCode(code);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === rule)).toBe(true);
    });
  }

  it("拦截：超过 4000 字符", () => {
    const code = `const a = 1;\n// ${"x".repeat(4100)}`;
    const result = verifyCode(code);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "max-chars")).toBe(true);
  });

  it("拦截：超过 100 行", () => {
    const code = Array.from({ length: 101 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const result = verifyCode(code);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "max-lines")).toBe(true);
  });

  it("拦截：import 语句（script 模式 parse 失败）", () => {
    const result = verifyCode("import x from 'y';");
    expect(result.ok).toBe(false);
  });
});

describe("ast-verifier 白名单内正常 Cesium 代码（放行）", () => {
  const CLEAN_CASES: Array<[string, string]> = [
    [
      "相机飞行",
      "const c = Cesium.Cartesian3.fromDegrees(116.4, 39.9, 1000);\nviewer.camera.flyTo({ destination: c });",
    ],
    [
      "画圆（实体）",
      [
        "const center = Cesium.Cartesian3.fromDegrees(121.4737, 31.2304);",
        "viewer.entities.add({",
        "  position: center,",
        "  ellipse: { semiMajorAxis: 50000, semiMinorAxis: 50000, material: Cesium.Color.RED.withAlpha(0.5) },",
        "});",
      ].join("\n"),
    ],
    [
      "局部变量与内建对象",
      "const m = new Map();\nm.set('a', 1);\nconst r = Math.max(1, JSON.parse('{\"x\":2}').x);\nconsole.log(r);",
    ],
    [
      "声明遮蔽内建名（局部 fetch 变量，良性）",
      "const fetch = 1;\nconsole.log(fetch);",
    ],
    [
      "字面量计算属性（允许）",
      "const o = { a: 1 };\nconsole.log(o['a']);",
    ],
    [
      "带 break 的循环（允许）",
      "let i = 0;\nwhile (true) { i++; if (i > 3) break; }\nfor (;;) { i--; if (i <= 0) break; }",
    ],
  ];

  for (const [name, code] of CLEAN_CASES) {
    it(`放行：${name}`, () => {
      const result = verifyCode(code);
      expect(result.violations).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});
