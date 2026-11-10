//
// 文件作用：脚手架应用内、Pod 直连与网关外部健康路径契约回归测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-10
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-10) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCreate } from "../../tools/create-extension.mjs";

const combinations = [
  { id: "health-contract-tool", track: "tool", tier: "business", args: ["--with-backend"] },
  { id: "health-contract-system", track: "system", tier: "platform", args: [] },
];

for (const combo of combinations) {
  test(`${combo.id}：应用内与 Pod 为 /actuator/health，网关保留服务前缀`, (t) => {
    const result = runCreate([combo.id, "--track", combo.track, "--tier", combo.tier, ...combo.args], {
      logger: { log() {} },
    });
    t.after(() => fs.rmSync(result.pkgDir, { recursive: true, force: true }));
    const manifest = JSON.parse(fs.readFileSync(path.join(result.pkgDir, "manifest.json"), "utf8"));

    for (const service of manifest.backendServices) {
      if (!service.healthEndpoint) continue;
      assert.equal(service.healthEndpoint, `/${service.serviceId}/actuator/health`);
      const bootstrap = fs.readFileSync(path.join(
        result.pkgDir, "backend", service.serviceId, "src", "main", "resources", "bootstrap.yml",
      ), "utf8");
      assert.doesNotMatch(bootstrap, /base-path\s*:/);
    }

    const primary = manifest.backendServices[0].serviceId;
    const workload = fs.readFileSync(path.join(result.pkgDir, "deploy", "k8s", `10-${primary}.yaml`), "utf8");
    assert.match(workload, /readinessProbe:\s*\n\s*httpGet:\s*\n(?:\s*#.*\n)?\s*path: \/actuator\/health/);
    assert.doesNotMatch(workload, new RegExp(`path: /${primary}/actuator/health`));
  });
}
