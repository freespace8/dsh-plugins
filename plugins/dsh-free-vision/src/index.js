/**
 * dsh-free-vision — host half.
 *
 * 职责：把本地 macOS Vision 识图（OCR / 表格结构 / 无文字图片语义描述）暴露为
 * agent 可调用工具（view_image / ocr_image），并为 Web 端的「粘贴图片→落盘路径」
 * 注册一条上传路由。图片完全本地处理，不出本机。
 *
 * 实现参考：https://github.com/niyongsheng/free-vision-skill（MIT）
 * 差异：本包遵循 dsh-plugins 免构建约定 —— 纯 ESM（除 schemastery 外零
 * 第三方 import），swift 进程经 DSH 的 subprocess 服务启动（进程组管理、有界
 * 输出、超时/取消终止），路由路径归本包命名空间。
 *
 * 设计约束：
 * - inject: ['tools', 'subprocess']：工具注册与 swift 执行是硬依赖，两个服务
 *   都来自 @deepseek-ai/dsh-base，任何 profile 都具备；未就绪时插件自动 pending。
 * - 上传路由懒注册：webServer 只在 web 组成存在，headless 无此服务时跳过，
 *   工具功能不受影响；先试一次，再监听 internal/service 补注册。
 * - 工具输出契约：output.schema 校验 canonical value，render 返回 blocks 数组
 *   （`[{ type: 'text', text }]`），这是 dsh-session 对 tool-result 块的硬要求。
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SCRIPT, prepareImage, runSwift } from './swift.js'
import { registerUploadRoute } from './upload.js'

export const name = 'free-vision'

/** 声明依赖 DSH 内置 tools 与 subprocess 服务，缺任一该插件不会激活。 */
export const inject = ['tools', 'subprocess']

/** 插件配置；profile 的 cordis.patch.yml 里可覆盖任意字段。 */
export const Config = z.object({
  /** ocr.swift 脚本绝对路径；留空使用插件内置脚本。 */
  scriptPath: z.string().required(false).description('ocr.swift 脚本绝对路径，留空使用插件内置脚本'),
  /** swift 执行超时(ms)。首次运行需编译约 5~10s，请留足余量。 */
  timeout: z.number().default(120000).description('swift 执行超时(ms)，首次运行需编译约 5~10s'),
  /** 输入框粘贴图片的保存目录；留空使用 ~/Pictures/dsh-free-vision。 */
  saveDir: z.string().required(false).description('输入框粘贴图片的保存目录，默认 ~/Pictures/dsh-free-vision'),
  /** 粘贴图片大小上限(字节)，默认 20MB。 */
  maxImageSize: z.number().default(20 * 1024 * 1024).description('粘贴图片大小上限(字节)，默认 20MB'),
})

/** webServer 服务键候选（最新在前）。 */
const WEB_SERVER_KEYS = ['webServer', 'httpServer']

/** 解析 ocr.swift 路径：配置优先，其次插件内置脚本。 */
function resolveScript(config) {
  if (config.scriptPath) return config.scriptPath
  if (DEFAULT_SCRIPT) return DEFAULT_SCRIPT
  throw new Error('无法定位内置 scripts/ocr.swift，请在配置中指定 scriptPath')
}

/** 工具输出契约：schema 校验字符串值，render 产出 blocks 数组。 */
function textOutput() {
  return {
    schema: { type: 'string' },
    render(_args, value) {
      return [{ type: 'text', text: String(value) }]
    },
  }
}

export function apply(ctx, config) {
  const script = resolveScript(config)
  const subprocess = ctx.get('subprocess')

  // 工具注册：ctx.effect 归属当前 fiber，插件卸载 / Fiber 销毁时自动注销。
  ctx.effect(() => {
    const disposeViewImage = ctx.tools.register({
      name: 'view_image',
      description:
        '对图片进行语义理解：场景分类、人物/动物/人脸检测、二维码解码、构图焦点、美学评分。完全本地执行（macOS Vision），图片不出本机。适合无视觉能力的模型先理解图片内容',
      parameters: {
        type: 'object',
        required: ['image_url'],
        properties: {
          image_url: {
            type: 'string',
            description: '图片 http(s) 链接 / base64 编码 / 本机绝对路径',
          },
        },
      },
      timeoutMs: config.timeout,
      output: textOutput(),
      async execute(args, exec) {
        const { path, cleanup } = await prepareImage(String(args.image_url))
        try {
          return await runSwift(subprocess, script, ['--describe', path], config.timeout, exec.signal)
        } finally {
          await cleanup()
        }
      },
    })

    const disposeOcrImage = ctx.tools.register({
      name: 'ocr_image',
      description:
        '提取图片内全部文字（阅读顺序，支持中英文）。layout=true 时输出表格结构与坐标，适合长截图、文档照片、表格页面识别。完全本地执行，图片不出本机',
      parameters: {
        type: 'object',
        required: ['image_url'],
        properties: {
          image_url: {
            type: 'string',
            description: '图片 http(s) 链接 / base64 编码 / 本机绝对路径',
          },
          layout: {
            type: 'boolean',
            description: '是否检测表格结构并输出坐标（默认 false）',
          },
        },
      },
      timeoutMs: config.timeout,
      output: textOutput(),
      async execute(args, exec) {
        const { path, cleanup } = await prepareImage(String(args.image_url))
        try {
          const scriptArgs = args.layout === true ? ['--layout', path] : [path]
          return await runSwift(subprocess, script, scriptArgs, config.timeout, exec.signal)
        } finally {
          await cleanup()
        }
      },
    })

    return () => {
      disposeViewImage()
      disposeOcrImage()
    }
  }, 'free-vision: tools')

  // 上传路由懒注册：webServer 服务为 web 组成独有，不做硬依赖。
  // 与 dsh-deepseek-balance 同款模式：apply 时先试一次，再监听
  // internal/service 在服务出现时补注册；ctx.effect/ctx.on 归属当前 fiber。
  let webRegistered = false
  const registerRoute = () => {
    if (webRegistered) return
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])
    if (webServer === undefined) return
    webRegistered = true
    ctx.effect(() => registerUploadRoute(webServer, config), 'free-vision: upload route')
  }
  registerRoute()
  ctx.on('internal/service', (serviceName) => {
    if (WEB_SERVER_KEYS.includes(serviceName)) registerRoute()
  })
}
