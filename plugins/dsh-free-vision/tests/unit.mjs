// dsh-free-vision 纯函数单测（不依赖 harness）：SSRF 边界、魔数嗅探、loopback 判定、上传落盘。
// 运行：node tests/unit.mjs（包根目录）
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  sniffImageExt,
  sniffExt,
  isBlockedDownloadUrl,
  prepareImage,
} from '../src/swift.js'
import {
  isLoopback,
  handleImageUpload,
  DEFAULT_SAVE_DIR,
} from '../src/upload.js'

test('sniffImageExt 识别常见图片魔数', () => {
  // PNG 头
  assert.equal(sniffImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), '.png')
  // JPEG 头
  assert.equal(sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), '.jpg')
  // GIF
  assert.equal(sniffImageExt(Buffer.from('GIF89a....', 'ascii')), '.gif')
  // WebP
  assert.equal(sniffImageExt(Buffer.from('RIFF....WEBP', 'ascii')), '.webp')
  // HEIC（ftyp heic）
  assert.equal(sniffImageExt(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(8)])), '.heic')
  // 未知字节 → null；sniffExt 兜底 .png
  assert.equal(sniffImageExt(Buffer.from('not an image', 'ascii')), null)
  assert.equal(sniffExt(Buffer.from('not an image', 'ascii')), '.png')
})

test('isBlockedDownloadUrl 拦截本机/内网地址', () => {
  for (const url of [
    'http://localhost:8080/x.png',
    'http://127.0.0.1/x.png',
    'http://[::1]/x.png',
    'http://10.0.0.1/x.png',
    'http://172.16.0.1/x.png',
    'http://192.168.1.1/x.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/x.png',
    'not-a-url',
  ]) {
    assert.equal(isBlockedDownloadUrl(url), true, `应拦截: ${url}`)
  }
  for (const url of [
    'https://example.com/a.png',
    'https://api.deepseek.com/user/balance',
    'https://images.example.com/x.png',
  ]) {
    assert.equal(isBlockedDownloadUrl(url), false, `不应拦截: ${url}`)
  }
})

test('isLoopback 仅接受本机来源', () => {
  const req = (addr) => ({ socket: { remoteAddress: addr } })
  assert.equal(isLoopback(req('127.0.0.1')), true)
  assert.equal(isLoopback(req('::1')), true)
  assert.equal(isLoopback(req('::ffff:127.0.0.1')), true)
  assert.equal(isLoopback(req('192.168.1.5')), false)
  assert.equal(isLoopback(req(undefined)), false)
})

test('handleImageUpload 写入目录并返回绝对路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fv-unit-'))
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const path = await handleImageUpload(png, dir)
    assert.ok(path.startsWith(dir), '路径应在 saveDir 下')
    assert.ok(path.endsWith('.png'), '扩展名按魔数嗅探')
    const written = await readFile(path)
    assert.deepEqual([...written], [...png])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('DEFAULT_SAVE_DIR 指向用户 Pictures 下的本包目录', () => {
  assert.ok(DEFAULT_SAVE_DIR.endsWith(join('Pictures', 'dsh-free-vision')))
})

test('prepareImage 本地路径原样返回且 cleanup 为 no-op', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fv-prep-'))
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const file = join(dir, 'a.png')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, png)
    const { path, cleanup } = await prepareImage(file)
    assert.equal(path, file)
    await cleanup() // 不应抛错
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('prepareImage base64 输入落到临时文件且字节一致', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
  const b64 = 'data:image/png;base64,' + png.toString('base64')
  const { path, cleanup } = await prepareImage(b64)
  try {
    assert.ok(path.endsWith('.png'), '扩展名按魔数嗅探')
    const { readFile } = await import('node:fs/promises')
    const written = await readFile(path)
    assert.deepEqual([...written], [...png])
  } finally {
    await cleanup()
  }
})
