/**
 * dsh-free-vision — 粘贴/拖拽图片落盘服务端。
 *
 * Web 客户端插件（lib/client.js）捕获输入框的图片粘贴后，POST 到
 * webServer 的 `/plugins/dsh-free-vision/images`，本模块把图片字节写入
 * 本地目录并返回绝对路径 —— 模型可直接用该路径调用 view_image / ocr_image。
 *
 * 安全边界（与上游 free-vision-skill 一致）：
 * - 仅接受 loopback 来源（DSH 默认监听 127.0.0.1，图片不出本机）
 * - 请求体受 maxImageSize 上限约束（边读边限流，超限立即 413）
 * - 扩展名按内容魔数嗅探（不信任客户端文件名），未知格式拒绝落盘
 */

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sniffExt, sniffImageExt } from './swift.js'

/** 上传路由路径；client 半体从这里 POST。 */
export const UPLOAD_PATH = '/plugins/dsh-free-vision/images'

export const DEFAULT_SAVE_DIR = join(homedir(), 'Pictures', 'dsh-free-vision')
export const DEFAULT_MAX_IMAGE_SIZE = 20 * 1024 * 1024

/** 时间戳文件名：fvs-YYYYMMDD-HHmmss-xxxx<ext>，随机后缀防同名覆盖。 */
export function stampName(now, buf) {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `fvs-${stamp}-${randomBytes(2).toString('hex')}${sniffExt(buf)}`
}

/** 把图片字节写入 saveDir（目录自动创建），返回绝对路径。 */
export async function handleImageUpload(body, saveDir) {
  await mkdir(saveDir, { recursive: true })
  const file = join(saveDir, stampName(new Date(), body))
  await writeFile(file, body)
  return file
}

/** 仅接受本机来源（IPv4/IPv6 loopback）。 */
export function isLoopback(req) {
  const addr = req.socket.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 构造 POST /plugins/dsh-free-vision/images 的 handler。 */
export function createUploadHandler(config) {
  const { saveDir, maxImageSize } = config
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return json(res, 405, { error: `仅支持 POST，收到 ${req.method}` })
    }
    if (!isLoopback(req)) {
      return json(res, 403, { error: '仅允许本机访问' })
    }
    // 边读边限流：超限立即回 413 并 destroy 请求（客户端还在上传时立刻感知错误，
    // 不会等整个 body 传完才被拒绝）。
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > maxImageSize) {
        json(res, 413, { error: `图片超过大小上限 ${Math.floor(maxImageSize / 1024 / 1024)}MB` })
        req.destroy()
        return
      }
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    if (!body.length) {
      return json(res, 400, { error: '请求体为空' })
    }
    // 严格嗅探：字节不匹配任何已知图片头即拒绝（不信任客户端文件名，
    // 未知内容不得以 .png 兜底落盘）
    if (!sniffImageExt(body)) {
      return json(res, 400, { error: '无法识别的图片格式（支持 png/jpeg/gif/webp/heic/heif）' })
    }
    try {
      const path = await handleImageUpload(body, saveDir)
      json(res, 201, { path })
    } catch (err) {
      json(res, 500, { error: `图片保存失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
}

/**
 * 在 DSH webServer 上注册上传路由，返回 disposer（插件卸载时注销）。
 * @param {object} webServer ctx.get('webServer') 得到的服务
 * @param {{saveDir?: string, maxImageSize?: number}} config
 * @returns {() => void}
 */
export function registerUploadRoute(webServer, config) {
  const resolved = {
    saveDir: resolve(config.saveDir ?? DEFAULT_SAVE_DIR),
    maxImageSize: config.maxImageSize ?? DEFAULT_MAX_IMAGE_SIZE,
  }
  return webServer.register({
    kind: 'exact',
    path: UPLOAD_PATH,
    handler: createUploadHandler(resolved),
  })
}
