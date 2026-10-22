/**
 * 文件作用：宿主-扩展共享依赖契约（host-contract）构建期硬校验——读取目标宿主的
 *           host-contract.json，校验扩展 package.json（dependencies/devDependencies/
 *           peerDependencies）中声明的共享依赖区间是宿主 accepts 范围的子集，违例即
 *           抛错使构建失败；被 vite.base.ts / vite.admin.base.ts 在配置定义期调用，
 *           亦被 check-host-contract.mjs CLI 复用（批4-P0，echarts 代际分裂治理）。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-04
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-04) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓根：packages/vite-config → 上两级 */
export const REPO_ROOT = path.resolve(HERE, '..', '..')

/** 宿主 id → 契约文件（相对仓根） */
export const HOST_CONTRACTS = {
  'gis-platform-ui': 'platform/frontend/gis-platform-ui/host-contract.json',
  'ruoyi-admin': 'platform/frontend/ruoyi-admin/host-contract.json'
}

const SKIP_ENV = 'HOST_CONTRACT_CHECK'

/**
 * 契约文件解析候选（按序命中）：
 * 1. 环境变量 HOST_CONTRACT_FILE_<HOST 大写、- 转 _>（显式覆盖）
 * 2. 平台仓布局：<仓根>/platform/frontend/<host>/host-contract.json
 * 3. 模板仓 vendored 布局：与本模块同级的 ../contracts/<host>.host-contract.json
 *    （模板仓 packages/vite-config/contracts/，经 sync-template.sh 同步）
 */
function resolveContractFile(host) {
  const envKey = `HOST_CONTRACT_FILE_${host.toUpperCase().replace(/-/g, '_')}`
  if (process.env[envKey]) return path.resolve(process.env[envKey])
  const rel = HOST_CONTRACTS[host]
  if (rel) {
    const platformFile = path.join(REPO_ROOT, rel)
    if (fs.existsSync(platformFile)) return platformFile
  }
  const vendoredFile = path.join(HERE, '..', 'contracts', `${host}.host-contract.json`)
  if (fs.existsSync(vendoredFile)) return vendoredFile
  if (rel) return path.join(REPO_ROOT, rel) // 平台布局但文件缺失 → 让调用方报「契约文件缺失」
  return null
}

// ---------- 迷你 semver（仅支持本仓实际使用的区间文法；不认识的写法判失败并明示） ----------

/** @typedef {{ min: number[], minIncl: boolean, max: number[] | null, maxIncl: boolean }} SemRange */

function parseVersion(text) {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(text)
  if (!m) return null
  return [m[1] ? Number(m[1]) : 0, m[2] !== undefined && m[2] !== 'x' && m[2] !== '*' ? Number(m[2]) : null, m[3] !== undefined && m[3] !== 'x' && m[3] !== '*' ? Number(m[3]) : null]
}

function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

function bump(v, idx) {
  const r = [v[0] || 0, v[1] || 0, v[2] || 0]
  r[idx] += 1
  for (let i = idx + 1; i < 3; i++) r[i] = 0
  return r
}

/**
 * 解析区间表达式为 [min, max]。
 * 支持：`*`、精确/部分版本（1 / 1.2 / 1.2.3 / 1.2.x）、`^`、`~`、`>=`/`>`/`<=`/`<` 空格合取。
 * 不支持：`||` 并集、连字符范围、预发布号——遇到即抛错（宁可误拦，不可漏放）。
 */
export function parseRange(expr) {
  const raw = String(expr || '').trim()
  if (!raw) throw new Error(`空版本区间`)
  if (raw === '*' || raw === 'x') return { min: [0, 0, 0], minIncl: true, max: null, maxIncl: false }
  if (raw.includes('||')) throw new Error(`不支持的区间表达式「${raw}」（|| 并集）`)
  if (/\d\s+-\s+\d/.test(raw)) throw new Error(`不支持的区间表达式「${raw}」（连字符范围）`)
  // 预发布/构建元数据（如 1.2.3-beta.1）一律拒绝
  const badToken = raw.split(/\s+/).find((t) => /-/.test(t.replace(/^[<>=~^v]+/, '')) || /\+/.test(t))
  if (badToken) throw new Error(`不支持的版本表达式「${raw}」（含预发布/构建元数据）`)

  const range = { min: [0, 0, 0], minIncl: true, max: null, maxIncl: false }
  for (const token of raw.split(/\s+/)) {
    let m
    if ((m = /^>=(.+)$/.exec(token))) {
      const v = parseVersion(m[1]); if (!v || v[1] === null || v[2] === null) throw new Error(`不支持的比较器「${token}」`)
      if (cmpVer(v, range.min) > 0 || (cmpVer(v, range.min) === 0 && !range.minIncl)) { range.min = v; range.minIncl = true }
    } else if ((m = /^>(.+)$/.exec(token))) {
      const v = parseVersion(m[1]); if (!v || v[1] === null || v[2] === null) throw new Error(`不支持的比较器「${token}」`)
      if (cmpVer(v, range.min) > 0 || (cmpVer(v, range.min) === 0 && range.minIncl)) { range.min = v; range.minIncl = false }
    } else if ((m = /^<=(.+)$/.exec(token))) {
      const v = parseVersion(m[1]); if (!v || v[1] === null || v[2] === null) throw new Error(`不支持的比较器「${token}」`)
      if (range.max === null || cmpVer(v, range.max) < 0) { range.max = v; range.maxIncl = true }
    } else if ((m = /^<(.+)$/.exec(token))) {
      const v = parseVersion(m[1]); if (!v || v[1] === null || v[2] === null) throw new Error(`不支持的比较器「${token}」`)
      if (range.max === null || cmpVer(v, range.max) < 0) { range.max = v; range.maxIncl = false }
    } else if ((m = /^\^(.+)$/.exec(token))) {
      const v = parseVersion(m[1]); if (!v) throw new Error(`不支持的区间「${token}」`)
      const base = [v[0], v[1] ?? 0, v[2] ?? 0]
      range.min = base; range.minIncl = true
      if (v[0] > 0 || v[1] === null) range.max = bump(base, 0)
      else if (v[1] > 0 || v[2] === null) range.max = bump(base, 1)
      else range.max = bump(base, 2)
      range.maxIncl = false
    } else if ((m = /^~(.+)$/.exec(token))) {
      const v = parseVersion(m[1]); if (!v) throw new Error(`不支持的区间「${token}」`)
      const base = [v[0], v[1] ?? 0, v[2] ?? 0]
      range.min = base; range.minIncl = true
      range.max = v[1] === null ? bump(base, 0) : bump(base, 1)
      range.maxIncl = false
    } else {
      const v = parseVersion(token)
      if (!v) throw new Error(`不支持的版本表达式「${token}」`)
      if (v[1] === null) { range.min = [v[0], 0, 0]; range.minIncl = true; range.max = bump([v[0], 0, 0], 0); range.maxIncl = false }
      else if (v[2] === null) { range.min = [v[0], v[1], 0]; range.minIncl = true; range.max = bump([v[0], v[1], 0], 1); range.maxIncl = false }
      else { range.min = v; range.minIncl = true; range.max = v; range.maxIncl = true }
    }
  }
  return range
}

/** ext 是否为 host 的子集 */
export function isSubset(ext, host) {
  const minCmp = cmpVer(ext.min, host.min)
  const minOK = minCmp > 0 || (minCmp === 0 && (host.minIncl || !ext.minIncl))
  if (!minOK) return false
  if (ext.max === null) return host.max === null
  if (host.max === null) return true
  const maxCmp = cmpVer(ext.max, host.max)
  return maxCmp < 0 || (maxCmp === 0 && (host.maxIncl || !ext.maxIncl))
}

// ---------- 契约校验 ----------

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies']

export function loadContract(host) {
  if (!HOST_CONTRACTS[host]) throw new Error(`[host-contract] 未知宿主「${host}」，已知：${Object.keys(HOST_CONTRACTS).join(', ')}`)
  const file = resolveContractFile(host)
  if (!file || !fs.existsSync(file)) {
    throw new Error(`[host-contract] 契约文件缺失：宿主 ${host}（查找 ${HOST_CONTRACTS[host]} 与 ../contracts/${host}.host-contract.json，可用 HOST_CONTRACT_FILE_${host.toUpperCase().replace(/-/g, '_')} 显式指定）`)
  }
  return { file: path.relative(REPO_ROOT, file), contract: JSON.parse(fs.readFileSync(file, 'utf8')) }
}

/**
 * 校验 pkgDir 的 package.json 对目标宿主的共享依赖声明。
 * @param {string} host 宿主 id（gis-platform-ui / ruoyi-admin）
 * @param {string} [pkgDir] 扩展包（frontend 或 admin-ui）目录，默认 process.cwd()
 * @returns {{ checked: string[], skipped: string[] }} 通过项与未声明跳过项
 */
export function assertHostContract(host, pkgDir = process.cwd()) {
  if (process.env[SKIP_ENV] === 'off') {
    console.warn(`[host-contract] ⚠ ${SKIP_ENV}=off，跳过共享依赖契约校验（仅限临时调试，禁止随发布使用）`)
    return { checked: [], skipped: [] }
  }
  const { file, contract } = loadContract(host)
  const pkgFile = path.join(pkgDir, 'package.json')
  if (!fs.existsSync(pkgFile)) throw new Error(`[host-contract] 未找到 package.json：${pkgFile}`)
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))

  const violations = []
  const checked = []
  const skipped = []
  for (const [dep, info] of Object.entries(contract.shared || {})) {
    if (info.bridge) { skipped.push(dep); continue }
    for (const field of DEP_FIELDS) {
      const declared = pkg[field] && pkg[field][dep]
      if (!declared) continue
      try {
        if (!isSubset(parseRange(declared), parseRange(info.accepts))) {
          violations.push(
            `  ✗ ${dep}：${field} 声明「${declared}」\n` +
            `    宿主 ${host} 实际提供 ${dep}@${info.version}，接受范围「${info.accepts}」`
          )
        } else {
          checked.push(`${dep}@${declared} ⊆ ${info.accepts}`)
        }
      } catch (e) {
        violations.push(`  ✗ ${dep}：${field} 声明「${declared}」无法解析（${e.message}）；请改用 ^/~ / 精确版本 / >=a <b 形式`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `\n[host-contract] 共享依赖契约校验失败：包 ${pkg.name || pkgDir} → 宿主 ${host}（契约 ${file}）\n` +
      violations.join('\n') +
      `\n  处置：把该依赖声明区间改到宿主接受范围内，或先升级宿主（同步 host-contract.json + import map/window 暴露 + esm-libs + 宿主 CHANGELOG）。\n` +
      `  临时跳过：${SKIP_ENV}=off（禁止随发布使用）\n`
    )
  }
  if (checked.length > 0) {
    console.log(`[host-contract] ✓ ${pkg.name || path.basename(pkgDir)} → ${host}：${checked.join('；')}`)
  }
  return { checked, skipped }
}
