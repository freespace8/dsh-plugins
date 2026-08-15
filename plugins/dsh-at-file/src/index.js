/**
 * dsh-at-file host 半体：挂载 `atFile` Typert Remote 服务（浏览器 @ 选择器的
 * 工作区索引搜索 + 插件自有设置），注册严格 Typert manifest，注册设置命名空间，
 * 并在每个 agent 的 pre-step 边界标记校验过的 `@path` 引用。插件永不读取被
 * 提及文件的内容。client 半体在同一个包里（./client），由 web 服务器在
 * /plugins/dsh-at-file/client.js 提供。
 *
 * 纯 JS 实现要点：
 * - Remote service 继承 TypertRemoteService（构造即注册 ctx.atFile + typertRemote
 *   绑定），方法不需要 @Remote 装饰器——网关按 ctx.typert.register 的严格
 *   manifest 描述符直接解析和调用。
 * - 设置用 schemastery schema（可调用），线编码用 zod（见 contract.js）。
 * - agent/pre-step 在根 ctx 注册：scope 事件会向上流动，根监听器收到每个
 *   agent 的事件（payload 自带 agent）。
 */
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT_MANIFEST } from './contract.js'
import { indexWorkspace } from './files.js'
import { mentionPreStep } from './mention.js'
import {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILES,
  effectiveIgnoreFiles,
  normalizeIgnoreFiles,
  normalizeWorkspaceIgnoreFiles,
} from './defaults.js'

/** Cordis 插件名（Loader entry 与 client bundle id）。 */
export const name = 'dsh-at-file'

/** 硬依赖：Typert 注册表 + settings provider。 */
export const inject = ['typert', 'settings']

export { DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_FILES } from './defaults.js'

/** Host 插件配置，加载时由 Loader 校验。 */
export const Config = z.object({
  /** 每个工作区索引条目上限；达到后停止遍历并如实报告截断。 */
  maxIndexedFiles: z.natural().min(1).default(5000),
  /** 索引遍历整体跳过的目录 basename。 */
  ignoreDirs: z.array(z.string()).default([...DEFAULT_IGNORE_DIRS]),
})

/** 设置命名空间（Web 设置页的 allowlist 必须与它一致）。 */
const AT_FILE_NAMESPACE = settingsNamespace('at-file')

/** at-file 设置命名空间的 schemastery schema。 */
const AtFileSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  ignoreFiles: z.array(z.union([
    z.string(),
    z.object({
      kind: z.union(['exact', 'regex']),
      pattern: z.string(),
      caseSensitive: z.boolean(),
    }),
  ])).default([...DEFAULT_IGNORE_FILES]),
  workspaceIgnoreFiles: z.array(z.object({
    workspace: z.string(),
    ignoreFiles: z.array(z.union([
      z.string(),
      z.object({
        kind: z.union(['exact', 'regex']),
        pattern: z.string(),
        caseSensitive: z.boolean(),
      }),
    ])),
  })).default([]),
})

/**
 * atFile Remote 服务：索引寻址 agent 的工作区，并把设置读写给浏览器。
 * 服务注册在 ctx.atFile（TypertRemoteService 构造即注册），网关按 manifest
 * 解析端点。文件内容不跨这条线。
 */
class AtFileRuntime extends TypertRemoteService {
  constructor(ctx, config, readSettings, writeSettings) {
    super(ctx, 'atFile')
    this._config = config
    this._read = readSettings
    this._write = writeSettings
  }

  /** 读取持久化设置。 */
  getSettings() {
    return this._read()
  }

  /** 持久化一个设置字段并返回解析后的 section。 */
  async updateSettings(update) {
    return this._write(update)
  }

  /** 索引寻址 agent 的工作区并返回有界条目列表（client 缓存后逐键过滤）。 */
  async search(agent, signal) {
    const settings = this._read()
    if (!settings.enabled) {
      throw new Error('at-file is disabled in Settings')
    }
    const cwd = agent.session.header.cwd
    if (cwd === undefined) {
      throw new Error('at-file: the session has no workspace directory')
    }
    const index = await indexWorkspace(cwd, {
      maxFiles: this._config.maxIndexedFiles,
      ignoreDirs: this._config.ignoreDirs,
      ignoreFiles: effectiveIgnoreFiles(settings, cwd),
    }, signal)
    return index.files
  }
}

/**
 * 挂载 atFile 服务、严格 manifest、设置命名空间，并在 pre-step 边界标记
 * @path 引用。
 */
export function apply(ctx, config) {
  const resolved = Config(config || {})

  // 持久开关 + 过滤规则：runtime 与边界每次调用都读实时值，Web 设置里切换立即生效。
  const settings = ctx.settings.register(AT_FILE_NAMESPACE, AtFileSettingsSchema, { applies: 'live' })
  const readSettings = () => settings.get()
  const writeSettings = async (update) => {
    if (update.field === 'enabled') {
      await settings.update({ enabled: update.value })
    } else if (update.field === 'ignoreFiles') {
      await settings.update({ ignoreFiles: normalizeIgnoreFiles(update.value) })
    } else {
      await settings.update({
        workspaceIgnoreFiles: normalizeWorkspaceIgnoreFiles(update.value),
      })
    }
    return settings.get()
  }

  new AtFileRuntime(ctx, resolved, readSettings, writeSettings)

  // 严格端点注册：网关从这份 manifest 解析 atFile/search 等端点，与装饰器
  // 标记状态无关。注册本身已是 fiber effect，返回的 disposer 即清理函数。
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-at-file: typert manifest')

  // 在根 ctx 监听 pre-step：scope 事件向上流动，根监听器收到每个 agent 的
  // 事件（payload 自带 agent），无需 agent/created 装配。
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    return mentionPreStep(agent, () => settings.get().enabled, messages, signal, next)
  })
}
