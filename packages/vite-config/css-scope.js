// 文件作用：能力包 CSS 包级作用域构建、源码防护与发布产物 AST 校验
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-13
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-13) B1 初始版本：data-cap-package 作用域、禁 Preflight、发布预检
// 版权所有 (C) 2026 AGRSEarth 项目

import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

export const CAPABILITY_PACKAGE_ATTRIBUTE = 'data-cap-package'

const SOURCE_EXTENSIONS = new Set(['.css', '.vue', '.scss', '.sass', '.less', '.styl'])
const GLOBAL_AT_RULES = new Set([
  'charset',
  'counter-style',
  'custom-media',
  'custom-selector',
  'font-face',
  'font-feature-values',
  'import',
  'namespace',
  'page',
  'property',
  'viewport'
])

function fail(packageId, filename, message) {
  throw new Error(`能力包 ${packageId} CSS 校验失败（${filename}）：${message}`)
}

function assertPackageId(packageId) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(packageId || '')) {
    throw new Error(`packageId 非法：${packageId || '(空)'}；仅允许小写字母、数字和中划线`)
  }
}

export function capabilityNamespace(packageId) {
  assertPackageId(packageId)
  return `[${CAPABILITY_PACKAGE_ATTRIBUTE}="${packageId}"]`
}

function isKeyframes(atRule) {
  return /(^|-)keyframes$/i.test(atRule.name)
}

function keyframesParent(rule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && isKeyframes(parent)) return parent
    parent = parent.parent
  }
  return null
}

function namespaceNode(packageId) {
  return selectorParser().astSync(capabilityNamespace(packageId)).first.first.clone()
}

function attributeValue(node) {
  return String(node.value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
}

function assertNoGlobalElementSelectors(parsed, packageId, filename) {
  parsed.walkTags(tag => {
    if (tag.value === 'html' || tag.value === 'body') {
      fail(packageId, filename, `禁止 html/body 全局 reset：${parsed.toString()}`)
    }
  })
}

function scopeOneSelector(selector, packageId, filename) {
  const parsed = selectorParser().astSync(selector)
  assertNoGlobalElementSelectors(parsed, packageId, filename)

  let hasNamespace = false
  parsed.walkAttributes(attribute => {
    if (attribute.attribute !== CAPABILITY_PACKAGE_ATTRIBUTE) return
    if (attributeValue(attribute) !== packageId) {
      fail(packageId, filename, `选择器引用了其他包命名空间：${selector}`)
    }
    hasNamespace = true
  })

  parsed.walkPseudos(pseudo => {
    if (pseudo.value === ':root' || pseudo.value === ':host') {
      if (pseudo.nodes?.length) {
        fail(packageId, filename, `不支持带参数的 ${pseudo.value}，请从本包根节点编写选择器`)
      }
      pseudo.replaceWith(namespaceNode(packageId))
      hasNamespace = true
    }
  })

  return hasNamespace ? parsed.toString() : `${capabilityNamespace(packageId)} ${parsed.toString()}`
}

function renameKeyframes(root, packageId) {
  const names = new Map()
  root.walkAtRules(atRule => {
    if (!isKeyframes(atRule)) return
    const original = atRule.params.trim().replace(/^(['"])(.*)\1$/, '$2')
    const scoped = `cap-${packageId}-${original}`
    names.set(original, scoped)
    atRule.params = scoped
  })

  if (!names.size) return
  root.walkDecls(decl => {
    if (!/^(?:-\w+-)?animation(?:-name)?$/i.test(decl.prop)) return
    let value = decl.value
    for (const [original, scoped] of names) {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      value = value.replace(new RegExp(`(^|[^\\w-])${escaped}(?=$|[^\\w-])`, 'g'), `$1${scoped}`)
    }
    decl.value = value
  })
}

export function createExtensionCssScopePlugin(packageId) {
  assertPackageId(packageId)
  return {
    postcssPlugin: 'agrsearth-extension-css-scope',
    Once(root, { result }) {
      const filename = result.opts.from || 'inline CSS'
      renameKeyframes(root, packageId)
      root.walkAtRules(atRule => {
        if (GLOBAL_AT_RULES.has(atRule.name.toLowerCase())) {
          fail(packageId, filename, `全局 @${atRule.name} 无法包级隔离，请移除或改用包内资源约定`)
        }
      })
      root.walkRules(rule => {
        if (keyframesParent(rule)) return
        rule.selectors = rule.selectors.map(selector => scopeOneSelector(selector, packageId, filename))
      })
    }
  }
}
createExtensionCssScopePlugin.postcss = true

export async function transformExtensionCss(code, packageId, filename = 'inline.css') {
  const result = await postcss([createExtensionCssScopePlugin(packageId)]).process(code, { from: filename })
  return result.css
}

export function assertNoForbiddenCssSource(code, packageId, filename = 'source') {
  assertPackageId(packageId)
  if (/@tailwind\s+base\b/.test(code) || /@import\s+(?:url\()?['"]?tailwindcss\/base/.test(code) || /tailwindcss\/preflight/.test(code)) {
    fail(packageId, filename, '禁止 Tailwind Preflight/base；请只使用 @tailwind utilities 或本包普通 CSS')
  }
}

export function createExtensionCssSourceGuard(packageId) {
  assertPackageId(packageId)
  return {
    name: 'agrsearth-extension-css-source-guard',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?', 1)[0]
      if (!SOURCE_EXTENSIONS.has(path.extname(cleanId))) return null
      assertNoForbiddenCssSource(code, packageId, cleanId)
      return null
    }
  }
}

export function validateExtensionCss(code, packageId, filename = 'tool.css') {
  assertPackageId(packageId)
  const root = postcss.parse(code, { from: filename })
  root.walkAtRules(atRule => {
    const name = atRule.name.toLowerCase()
    if (GLOBAL_AT_RULES.has(name)) {
      fail(packageId, filename, `产物残留全局 @${name}`)
    }
    if (isKeyframes(atRule) && !atRule.params.startsWith(`cap-${packageId}-`)) {
      fail(packageId, filename, `keyframes 未使用包级名称：${atRule.params}`)
    }
  })
  root.walkRules(rule => {
    if (keyframesParent(rule)) return
    for (const selector of rule.selectors) {
      const parsed = selectorParser().astSync(selector)
      assertNoGlobalElementSelectors(parsed, packageId, filename)
      let valid = false
      parsed.walkAttributes(attribute => {
        if (attribute.attribute !== CAPABILITY_PACKAGE_ATTRIBUTE) return
        if (attributeValue(attribute) !== packageId) {
          fail(packageId, filename, `产物混入其他包命名空间：${selector}`)
        }
        valid = true
      })
      if (!valid) fail(packageId, filename, `选择器未限定到 ${capabilityNamespace(packageId)}：${selector}`)
    }
  })
  return true
}

function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(file))
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(file)
  }
  return files
}

export function validateExtensionCssSources(frontendDir, packageId) {
  const files = sourceFiles(path.join(frontendDir, 'src')).sort()
  for (const file of files) assertNoForbiddenCssSource(fs.readFileSync(file, 'utf8'), packageId, file)
  return files
}

export function validateExtensionCssArtifacts(distDir, packageId) {
  if (!fs.existsSync(distDir)) return []
  const files = fs.readdirSync(distDir)
    .filter(name => name.toLowerCase().endsWith('.css'))
    .sort()
    .map(name => path.join(distDir, name))
  for (const file of files) validateExtensionCss(fs.readFileSync(file, 'utf8'), packageId, file)
  return files
}

export function validateExtensionCssPackage(pluginDir, packageId) {
  const frontendDir = path.join(pluginDir, 'frontend')
  return {
    sources: validateExtensionCssSources(frontendDir, packageId),
    artifacts: validateExtensionCssArtifacts(path.join(frontendDir, 'dist'), packageId)
  }
}
