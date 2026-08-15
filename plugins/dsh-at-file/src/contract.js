/**
 * dsh-at-file 线上契约：zod v4 编解码 schema + Typert 调用描述符。
 *
 * host 半体与 client 半体各持一份本契约（client bundle 无法 require 外部包，
 * 用最小 .parse() 兼容实现重写同一套描述符）。文件字节永远不跨这条边界：
 * host 只在 agent/pre-step 标记用户选择的路径。
 *
 * 注意：Typert 注册表 / 网关要求 zod 风格 schema（至少带 .parse()，registry 的
 * schema 记录要求完整 zod 内部结构），不能用 schemastery 的 z。
 */
import { z } from 'zod'

/** 会话 id 的线上编码（branded string）。 */
export const sessionIdSchema = z.string().min(1)

/** 一条已索引的工作区条目（文件或目录）。 */
export const fileEntrySchema = z.object({
  path: z.string().min(1),
  relative: z.string().min(1),
  kind: z.enum(['file', 'dir']),
}).readonly()

/** search 结果编码。 */
export const fileEntryArraySchema = z.array(fileEntrySchema)

/** 一条文件过滤规则（精确名或正则）。 */
export const fileIgnoreRuleSchema = z.object({
  kind: z.enum(['exact', 'regex']),
  pattern: z.string().min(1),
  caseSensitive: z.boolean(),
}).readonly()

/** 兼容旧字符串形式的过滤规则输入。 */
export const fileIgnoreRuleInputSchema = z.union([z.string(), fileIgnoreRuleSchema])

/** 绑定到某工作区路径的过滤规则列表。 */
export const workspaceIgnoreFilesSchema = z.object({
  workspace: z.string().min(1),
  ignoreFiles: z.array(fileIgnoreRuleInputSchema),
}).readonly()

/** at-file 设置命名空间的持久形状。 */
export const atFileSettingsSchema = z.object({
  enabled: z.boolean(),
  ignoreFiles: z.array(fileIgnoreRuleInputSchema),
  workspaceIgnoreFiles: z.array(workspaceIgnoreFilesSchema),
}).readonly()

/** 设置字段更新。 */
export const atFileSettingsUpdateSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('enabled'), value: z.boolean() }).readonly(),
  z.object({ field: z.literal('ignoreFiles'), value: z.array(fileIgnoreRuleInputSchema) }).readonly(),
  z.object({
    field: z.literal('workspaceIgnoreFiles'),
    value: z.array(workspaceIgnoreFilesSchema),
  }).readonly(),
])

/** atFile Remote 的三个调用描述符（host manifest 与 client contribution 共用）。 */
export const AT_FILE_INVOCATIONS = [
  {
    id: 'dsh-at-file#atFile/search',
    service: 'atFile',
    namespace: 'atFile',
    method: 'search',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'agent',
        wire: 'agentId',
        source: 'lookup',
        lookup: 'agent',
        // typeSymbol 必须与 agent lookup provider 的 wire 身份完全一致。
        codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: sessionIdSchema },
      },
    ],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-at-file#FileEntry[]',
      schema: fileEntryArraySchema,
    },
  },
  {
    id: 'dsh-at-file#atFile/getSettings',
    service: 'atFile',
    namespace: 'atFile',
    method: 'getSettings',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-at-file#AtFileSettings',
      schema: atFileSettingsSchema,
    },
  },
  {
    id: 'dsh-at-file#atFile/updateSettings',
    service: 'atFile',
    namespace: 'atFile',
    method: 'updateSettings',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'update',
        wire: 'update',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-at-file#AtFileSettingsUpdate',
          schema: atFileSettingsUpdateSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-at-file#AtFileSettings',
      schema: atFileSettingsSchema,
    },
  },
]

/**
 * host 侧 Typert manifest。经 ctx.typert.register 注册后，网关按严格描述符
 * 解析 atFile/* 端点并直接调用 service 上的方法，不依赖 @Remote 装饰器标记
 * ——这正是纯 JS host 能工作的原因（装饰器是 TC39 语法，普通 JS 无法使用）。
 */
export const TYPERT_MANIFEST = {
  package: 'dsh-at-file',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'atFile',
        exportName: 'AtFileRuntime',
        description: 'Workspace path search and durable settings for the @ picker.',
        tags: [],
        members: [
          { kind: 'method', name: 'search', signature: 'search(agent: Agent, signal: AbortSignal): Promise<readonly FileEntry[]>' },
          { kind: 'method', name: 'getSettings', signature: 'getSettings(): AtFileSettings' },
          { kind: 'method', name: 'updateSettings', signature: 'updateSettings(update: AtFileSettingsUpdate): Promise<AtFileSettings>' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: AT_FILE_INVOCATIONS,
}
