/**
 * dsh-free-vision — 本地 Swift Vision 执行层。
 *
 * - 复用 scripts/ocr.swift（macOS Vision，业务逻辑与上游 free-vision-skill 一致）
 * - 处理三种输入：本机绝对路径 / http(s) 链接 / base64
 * - http 与 base64 输入落到系统临时目录，用完即清
 * - swift 进程经 DSH 的 subprocess 服务启动：进程组管理、有界输出收集、
 *   超时/取消时 SIGTERM→SIGKILL 升级，组合销毁时不会遗留孤儿进程
 *
 * 依赖：仅 node 内置模块，无需 pnpm install。
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件内置脚本：src/swift.js 向上一级 = 包根目录 scripts/ocr.swift */
export const DEFAULT_SCRIPT = fileURLToPath(
  new URL('../scripts/ocr.swift', import.meta.url),
)

/** swift 一次调用的输出收集上限（stdout/stderr 各一个，超出保留尾部）。 */
const STDOUT_MAX_BYTES = 32 * 1024 * 1024
const STDERR_MAX_BYTES = 8 * 1024 * 1024
/** 进程组终止升级的宽限期（毫秒）。 */
const GRACE_MS = 5000

/**
 * 魔数嗅探表（与上游 free-vision-skill 逐字节一致）：
 * heic/heif 通过 ISO BMFF 的 ftyp box 品牌名区分，generic BMFF（如
 * `ftypmp42` 视频）拒绝保存为图片。macOS Vision 原生支持这些全部格式。
 */
const SNIFFERS = [
  {
    ext: '.png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { ext: '.jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', test: (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  {
    ext: '.webp',
    test: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    ext: '.heic',
    test: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 4, 8) === 'ftyp' &&
      ['heic', 'heix', 'hevc', 'hevx'].includes(b.toString('ascii', 8, 12)),
  },
  {
    ext: '.heif',
    test: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 4, 8) === 'ftyp' &&
      ['mif1', 'msf1', 'heif'].includes(b.toString('ascii', 8, 12)),
  },
]

/** 严格嗅探：返回扩展名，字节不匹配任何已知图片头时返回 null。 */
export function sniffImageExt(buf) {
  for (const { ext, test } of SNIFFERS) {
    if (test(buf)) return ext
  }
  return null
}

/** 宽松嗅探：未知格式兜底 .png（ImageIO 仍能按内容识别，扩展名仅作兜底）。 */
export function sniffExt(buf) {
  return sniffImageExt(buf) ?? '.png'
}

function isBase64(input) {
  if (input.startsWith('data:image/')) return true
  if (/^https?:\/\//i.test(input)) return false
  // 本地路径不存在时，按 base64 尝试解码（要求长度合理且字符合法）
  if (existsSync(input)) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(input) && input.length > 32
}

/**
 * SSRF 边界：拒绝向本机/内网地址发起下载（与上传路由的 loopback-only 对称）。
 * 只做 hostname 级拦截（字面 IP / localhost）；DNS 重绑定等高级手法超出
 * 本地单用户工具的风险模型。
 */
export function isBlockedDownloadUrl(url) {
  let hostname
  try {
    hostname = new URL(url).hostname
  } catch {
    return true
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  // new URL().hostname 对 IPv6 字面量保留方括号，两种形态都拦
  if (hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0') return true
  // 字面 IPv4：环回 / 私网 / 链路本地 / 组播与保留段
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const [a, b] = hostname.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

/**
 * 把 image_url 参数解析为本地文件路径；http/base64 输入落到临时文件。
 * @returns {Promise<{path: string, cleanup: () => Promise<void>}>}
 */
export async function prepareImage(imageUrl) {
  if (/^https?:\/\//i.test(imageUrl)) {
    if (isBlockedDownloadUrl(imageUrl)) {
      throw new Error(`拒绝下载本机/内网地址: ${imageUrl}`)
    }
    const dir = await mkdtemp(join(tmpdir(), 'dsh-free-vision-'))
    try {
      const resp = await fetch(imageUrl)
      if (!resp.ok) {
        throw new Error(`下载图片失败: HTTP ${resp.status} ${imageUrl}`)
      }
      const buf = Buffer.from(await resp.arrayBuffer())
      const file = join(dir, `image${sniffExt(buf)}`)
      await writeFile(file, buf)
      return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) }
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  }

  if (isBase64(imageUrl)) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-free-vision-'))
    try {
      const b64 = imageUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length) {
        throw new Error('base64 图片解码失败: 内容为空')
      }
      const file = join(dir, `image${sniffExt(buf)}`)
      await writeFile(file, buf)
      return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) }
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  }

  // 本地路径
  if (!existsSync(imageUrl)) {
    throw new Error(`图片文件不存在: ${imageUrl}`)
  }
  return { path: imageUrl, cleanup: async () => {} }
}

/**
 * 执行 ocr.swift，返回 stdout（去首尾空白）。
 *
 * 经 DSH subprocess 服务 spawn，绝不 shell 解释（argv 数组直传）；超时与取消
 * 通过 AbortSignal 触发进程组终止。stderr 仅当 stdout 为空时兜底返回
 * （swift 首次运行会有编译输出）。
 *
 * @param {object|undefined} subprocess ctx.get('subprocess') 服务
 * @param {string} scriptPath ocr.swift 绝对路径
 * @param {string[]} args 传给脚本的参数（--describe / --layout / 图片路径）
 * @param {number} timeoutMs 执行超时(毫秒)
 * @param {AbortSignal|undefined} signal 调用方取消信号（工具调用的 exec.signal）
 * @returns {Promise<string>}
 */
export async function runSwift(subprocess, scriptPath, args, timeoutMs, signal) {
  if (subprocess === undefined) {
    throw new Error('subprocess service is not mounted')
  }
  if (signal !== undefined && signal.aborted) {
    throw new Error('图片识别已取消')
  }
  // 合并调用方取消与自身超时：任一先到都终止 swift 进程组。
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (signal !== undefined) signal.addEventListener('abort', onOuterAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const handle = subprocess.spawn({
      argv: ['swift', scriptPath, ...args],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: STDOUT_MAX_BYTES, spill: { maxBytes: STDOUT_MAX_BYTES * 2 } },
        stderr: { maxBytes: STDERR_MAX_BYTES, spill: { maxBytes: STDERR_MAX_BYTES * 2 } },
      },
      graceMs: GRACE_MS,
      signal: controller.signal,
    })
    const readAll = (reader) => (reader === undefined ? '' : reader.readFrom(0).text)
    let outcome
    try {
      outcome = await handle.done
    } catch (err) {
      const stderr = readAll(handle.collected.stderr)
      throw new Error(`swift 启动失败: ${stderr.trim() || (err instanceof Error ? err.message : String(err))}`)
    }
    const stdout = readAll(handle.collected.stdout)
    const stderr = readAll(handle.collected.stderr)
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      if (signal !== undefined && signal.aborted) {
        throw new Error('图片识别已取消')
      }
      if (controller.signal.aborted) {
        throw new Error(`swift 执行超时(>${timeoutMs}ms)：首次运行需编译约 5~10s，可调大 timeout 配置`)
      }
      if (outcome.signal !== null) {
        throw new Error(`swift 执行被终止(${outcome.signal})`)
      }
      const detail = (stderr.trim() || stdout.trim() || '无输出').slice(0, 1000)
      throw new Error(`swift 执行失败(exit ${String(outcome.exitCode)}): ${detail}`)
    }
    return stdout.trim() || stderr.trim()
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', onOuterAbort)
  }
}
