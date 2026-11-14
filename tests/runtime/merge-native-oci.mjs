// 文件作用：S11 原生 arm64/amd64 OCI layout 合并、digest 与 tar 证据生成
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-14
// 版本：1.0.0
// 修改记录：1.0.0 (2026-11-14) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const work = process.env.S11_OCI_WORK_DIR
if (!work) throw new Error('必须设置 S11_OCI_WORK_DIR')
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const services = [
  { id: 'ai-assistant-mcp', prefix: 'ai', repository: 'gis-platform/system/business/ai-assistant-mcp/ai-assistant-mcp' },
  { id: 'cesium-mcp', prefix: 'cesium', repository: 'gis-platform/system/business/ai-assistant-mcp/cesium-mcp' }
]
const evidence = {}

function leafDescriptor(layout, architecture) {
  const index = readJson(path.join(layout, 'index.json'))
  const descriptors = []
  for (const descriptor of index.manifests) {
    if (String(descriptor.mediaType).includes('manifest.list') || String(descriptor.mediaType).includes('image.index')) {
      const nested = readJson(path.join(layout, 'blobs', 'sha256', descriptor.digest.split(':')[1]))
      descriptors.push(...nested.manifests)
    } else {
      descriptors.push(descriptor)
    }
  }
  const leaf = descriptors.find((item) => item.platform?.architecture === architecture)
  if (leaf) return leaf
  const single = descriptors[0]
  assert.ok(single, `${layout} 缺 manifest`)
  const manifest = readJson(path.join(layout, 'blobs', 'sha256', single.digest.split(':')[1]))
  const config = readJson(path.join(layout, 'blobs', 'sha256', manifest.config.digest.split(':')[1]))
  assert.equal(config.architecture, architecture, `${layout} config 架构不符`)
  return { ...single, platform: { os: config.os, architecture: config.architecture } }
}

function copyBlobs(source, target) {
  const sourceBlobs = path.join(source, 'blobs', 'sha256')
  const targetBlobs = path.join(target, 'blobs', 'sha256')
  fs.mkdirSync(targetBlobs, { recursive: true })
  for (const file of fs.readdirSync(sourceBlobs)) {
    const bytes = fs.readFileSync(path.join(sourceBlobs, file))
    assert.equal(sha(bytes), file, `${source} blob digest 不符：${file}`)
    fs.writeFileSync(path.join(targetBlobs, file), bytes)
  }
}

for (const service of services) {
  const target = path.join(work, `${service.prefix}-multiarch`)
  fs.mkdirSync(target, { recursive: true })
  const manifests = []
  const digests = {}
  const references = {}
  for (const architecture of ['arm64', 'amd64']) {
    const source = path.join(work, `${service.prefix}-${architecture}`)
    assert.ok(fs.existsSync(source), `缺 OCI layout：${source}`)
    const leaf = leafDescriptor(source, architecture)
    manifests.push(leaf)
    digests[architecture] = leaf.digest
    references[architecture] = `localhost:32000/${service.repository}:2.1.4`
    copyBlobs(source, target)
  }
  const index = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests
  }
  const indexBytes = Buffer.from(JSON.stringify(index, null, 2) + '\n')
  fs.writeFileSync(path.join(target, 'index.json'), indexBytes)
  fs.writeFileSync(path.join(target, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }) + '\n')
  const indexDigest = `sha256:${sha(indexBytes)}`
  const tarFile = `${service.repository.replaceAll('/', '_')}_2.1.4.oci.tar`
  const tarPath = path.join(work, tarFile)
  execFileSync('tar', ['-cf', tarPath, '-C', target, '.'], { stdio: 'inherit' })
  const tarDigest = sha(fs.readFileSync(tarPath))
  evidence[service.id] = {
    digests,
    references,
    indexDigest,
    ociFile: tarFile,
    sha256: tarDigest,
    nativeBuild: true,
    registryPublished: false
  }
  console.log(`PASS ${service.id} index=${indexDigest} arm64=${digests.arm64} amd64=${digests.amd64} tar=${tarDigest}`)
}
writeJson(path.join(work, 'image-evidence.json'), evidence)
console.log(`EVIDENCE=${path.join(work, 'image-evidence.json')}`)
