/**
 * dsh-deepseek-balance — host half.
 *
 * 职责：解析 DeepSeek 官方 API Key（经 ctx.credentials），用 shell 拉取官方
 * 余额接口，并通过一条 HTTP 路由把结果交给浏览器端的 client 半体。
 *
 * 设计约束：
 * - 除 schemastery（Config schema）外零第三方 import，全部通过 ctx 服务访问，
 *   因此 file: 安装后不需要在插件目录里 pnpm install。
 * - 路由懒注册：webServer 在 headless profile 不存在、或并发激活时晚于本插件
 *   绑定，所以在 apply 时先试一次，再监听 internal/service 补注册。
 * - 余额接口地址是 DeepSeek 官方外部规范，保持固定（协议常量）。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'deepseek-balance'

/** 插件配置；profile 的 cordis.patch.yml 里可覆盖任意字段。 */
export const Config = z.object({
  /** 余额请求使用的凭据环境变量名。 */
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  /** client 半体的自动刷新间隔（毫秒）；经余额路由响应下发。 */
  refreshIntervalMs: z.number().default(300000),
  /** 会话头部胶囊在 utilities slot 里的排列序（越小越靠前）。 */
  order: z.number().default(-1),
  /** shell 执行 curl 的总超时（毫秒）。 */
  shellTimeoutMs: z.number().default(8000),
})

/** 官方余额接口（外部规范，保持固定）。 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** 余额路由路径；client 半体从这里 fetch。 */
const ROUTE_PATH = '/plugins/dsh-deepseek-balance/balance'

/** webServer 服务键候选（最新在前）。 */
const WEB_SERVER_KEYS = ['webServer', 'httpServer']

/**
 * 拉取一次官方余额。
 * @returns 统一结果对象；ok=false 时 error 为面向用户的说明。
 */
async function fetchBalance(ctx, config) {
  const t0 = Date.now()
  const credentials = ctx.get('credentials')
  const shell = ctx.get('shell')
  if (credentials === undefined || shell === undefined) {
    return { ok: false, error: 'credentials or shell service is not mounted', elapsedMs: Date.now() - t0 }
  }
  let apiKey = ''
  try {
    const resolved = await credentials.resolve(config.apiKeyEnv)
    apiKey = resolved === undefined ? '' : resolved.value
  } catch (err) {
    return { ok: false, error: `failed to resolve ${config.apiKeyEnv}`, elapsedMs: Date.now() - t0 }
  }
  if (apiKey === '') {
    return { ok: false, error: `${config.apiKeyEnv} is not configured`, elapsedMs: Date.now() - t0 }
  }
  let spec
  try {
    spec = shell.resolve({
      command: `curl -sS --connect-timeout 3 --max-time 6 -H "Authorization: Bearer $DSK_API_KEY" ${BALANCE_URL}`,
      env: { DSK_API_KEY: apiKey },
      timeoutMs: config.shellTimeoutMs,
      stdoutMaxBytes: 8192,
    })
  } catch (err) {
    return { ok: false, error: 'shell spec resolve failed', elapsedMs: Date.now() - t0 }
  }
  let result
  try {
    result = await shell.run(spec)
  } catch (err) {
    return { ok: false, error: 'balance request failed', elapsedMs: Date.now() - t0 }
  }
  let data = null
  try {
    data = JSON.parse(result.stdout.text)
  } catch (err) {
    data = null
  }
  if (data === null || typeof data !== 'object') {
    return {
      ok: false,
      error: `unexpected balance response (exit ${String(result.exitCode)})`,
      elapsedMs: Date.now() - t0,
    }
  }
  if (data.error !== undefined && data.error !== null) {
    const msg = (typeof data.error === 'object' && data.error !== null && data.error.message !== undefined)
      ? String(data.error.message)
      : String(data.error)
    return { ok: false, error: msg, elapsedMs: Date.now() - t0 }
  }
  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
  if (infos.length === 0) {
    return { ok: false, error: 'balance_infos is empty', elapsedMs: Date.now() - t0 }
  }
  const info = infos[0]
  const pick = (value) => String(value === undefined || value === null ? '' : value)
  return {
    ok: true,
    isAvailable: data.is_available === true,
    currency: pick(info.currency),
    total: pick(info.total_balance),
    granted: pick(info.granted_balance),
    toppedUp: pick(info.topped_up_balance),
    elapsedMs: Date.now() - t0,
  }
}

export function apply(ctx, config) {
  // client 半体的自动刷新间隔经余额路由响应一并下发（client 无配置通道）。
  const respond = async (res) => {
    const balance = await fetchBalance(ctx, config)
    const body = JSON.stringify({ ...balance, intervalMs: config.refreshIntervalMs })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  let webRegistered = false
  const registerRoute = () => {
    if (webRegistered) return
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])
    if (webServer === undefined) return
    webRegistered = true
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (_req, res) => respond(res),
    }), 'deepseek-balance: balance route')
  }
  registerRoute()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name)) registerRoute()
  })
}
