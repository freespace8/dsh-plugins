/**
 * dsh-sidebar-helper — host 半体。
 *
 * 职责：只有一条配置（enabled 总开关）与一条 HTTP 路由。所有交互都在
 * client 半体（lib/client.js）：它监听左侧工作区浏览器行的 contextmenu 事件，
 * 用 ctx.sessions / ctx.workspaces 服务解析被右键的行，弹出自带「复制路径」
 * 的右键菜单，并驱动重命名 / 分叉 / 归档 / 删除。
 *
 * 为什么 host 需要一个路由：client fiber 没有配置通道，client 半体只能经
 * 服务 / remote / HTTP 读取可调值。enabled 就是这样一个值——在 profile 的
 * cordis.patch.yml 里改 config.enabled 即可整体关闭右键菜单（client 每次
 * 启动时 fetch 一次，取不到就默认开启）。
 *
 * 设计约束：
 * - 除 schemastery（Config schema）外零第三方 import，因此 file: 安装后
 *   不需要在插件目录里 pnpm install。
 * - 路由懒注册：webServer 在 headless profile 不存在、或并发激活时晚于本
 *   插件绑定，所以在 apply 时先试一次，再监听 internal/service 补注册。
 */
import z from '@deepseek-ai/schemastery'

/** Cordis 插件名（Loader entry id 与 patch 行 id）。 */
export const name = 'sidebar-helper'

/** 无 host 侧服务依赖。 */
export const inject = []

/** Host 插件配置，加载时由 Loader 校验。 */
export const Config = z.object({
  /** 总开关：false 时 client 半体不挂右键菜单（经设置路由下发）。 */
  enabled: z.boolean().default(true),
})

/** 设置路由路径；client 半体从这里 fetch 配置。 */
const ROUTE_PATH = '/plugins/dsh-sidebar-helper/settings'

/** webServer 服务键候选（最新在前）。 */
const WEB_SERVER_KEYS = ['webServer', 'httpServer']

/**
 * 挂载设置路由。路由本身是 fiber effect（webServer.register 返回 disposer），
 * 随插件 dispose 一并清理。
 */
export function apply(ctx, config) {
  const resolved = Config(config || {})

  const registerRoute = () => {
    if (registerRoute.done) return
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])
    if (webServer === undefined) return
    registerRoute.done = true
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (_req, res) => {
        const body = JSON.stringify({ enabled: resolved.enabled })
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(body)
      },
    }), 'sidebar-helper: settings route')
  }
  registerRoute()
  ctx.on('internal/service', (svcName) => {
    if (WEB_SERVER_KEYS.includes(svcName)) registerRoute()
  })
}
