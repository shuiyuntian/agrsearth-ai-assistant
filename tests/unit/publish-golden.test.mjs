//
// 文件作用：bash 与 Node 发布请求 golden master 自动对拍
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-03
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-03) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (name) => path.join(root, "tests", "fixtures", "publish-golden", name);

function normalized(entries) {
  return entries.filter((entry) => entry.step !== "smoke").map((entry) => {
    if (entry.step === "upload-complete") {
      return { ...entry, path: entry.path.replace(/\/upload-sessions\/[^/]+\/complete$/, "/upload-sessions/{uploadId}/complete") };
    }
    if (entry.step === "minio-upload") {
      return { ...entry, formFields: Object.keys(entry.formFields).sort() };
    }
    return entry;
  });
}

test("bash golden master 与 Node 重放逐请求一致", () => {
  const bash = JSON.parse(fs.readFileSync(fixture("kimi-publish-demo-20261103-0.1.0-bash.json"), "utf8"));
  const node = JSON.parse(fs.readFileSync(fixture("kimi-publish-demo-20261103-0.1.0-node.json"), "utf8"));
  assert.deepEqual(normalized(node), normalized(bash));
});
