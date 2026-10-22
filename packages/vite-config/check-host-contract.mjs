#!/usr/bin/env node
/**
 * 文件作用：host-contract 契约校验 CLI——单包模式（--host/--dir）或全量扫描模式（--all，
 *           遍历 extensions/ 下所有含 package.json 且带 vite.config.ts 的 frontend/admin-ui
 *           目录，按目录名归到对应宿主：frontend→gis-platform-ui（tool.*.js）、
 *           admin-ui→ruoyi-admin（admin.*.js））；任一违例 exit 1。供 CI/发布前批量复核，
 *           构建期硬校验由 vite.base.ts / vite.admin.base.ts 内嵌调用同一逻辑。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-04
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-04) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 *
 * 用法：
 *   node packages/vite-config/check-host-contract.mjs --host gis-platform-ui --dir extensions/tool/business/tide/frontend
 *   node packages/vite-config/check-host-contract.mjs --all
 */

import fs from 'node:fs'
import path from 'node:path'
import { assertHostContract, REPO_ROOT } from './host-contract.js'

function parseArgs(argv) {
  const args = { all: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--all') args.all = true
    else if (argv[i] === '--host') args.host = argv[++i]
    else if (argv[i] === '--dir') args.dir = argv[++i]
    else { console.error(`未知参数：${argv[i]}`); process.exit(2) }
  }
  return args
}

function scanTargets() {
  const targets = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', 'vendor', 'dist', '.git', '_template'].includes(name)) continue
      const p = path.join(dir, name)
      if (!fs.statSync(p).isDirectory()) continue
      if (name === 'frontend' && fs.existsSync(path.join(p, 'vite.config.ts')) && fs.existsSync(path.join(p, 'package.json'))) {
        targets.push({ host: 'gis-platform-ui', dir: p })
      } else if (name === 'admin-ui' && fs.existsSync(path.join(p, 'vite.config.ts')) && fs.existsSync(path.join(p, 'package.json'))) {
        targets.push({ host: 'ruoyi-admin', dir: p })
      }
      walk(p)
    }
  }
  walk(path.join(REPO_ROOT, 'extensions'))
  return targets
}

const args = parseArgs(process.argv)
const targets = args.all
  ? scanTargets()
  : [{ host: args.host, dir: args.dir ? path.resolve(args.dir) : process.cwd() }]

if (!args.all && !args.host) {
  console.error('单包模式须指定 --host <gis-platform-ui|ruoyi-admin> [--dir <pkgDir>]；或用 --all 全量扫描')
  process.exit(2)
}

let failed = 0
for (const t of targets) {
  const rel = path.relative(REPO_ROOT, t.dir)
  try {
    assertHostContract(t.host, t.dir)
  } catch (e) {
    failed++
    console.error(`✗ ${rel}（${t.host}）: ${e.message}`)
  }
}
console.log(args.all ? `\nhost-contract 全量扫描：${targets.length} 个构建单元，违例 ${failed}` : '')
process.exit(failed > 0 ? 1 : 0)
