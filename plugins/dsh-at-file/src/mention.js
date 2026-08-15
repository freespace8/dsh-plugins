/**
 * host 侧 @ 路径引用标记：识别即将发出的用户消息里的 `@path` token，校验每个
 * 所选路径确实存在于工作区，然后只注入它的相对路径和种类。文件字节和目录
 * 后代在这里一律不读——是否、如何检查引用由 agent 用当前会话的工具决定。
 * 只扫描 source.kind === 'user' 的文本，外部文本无法伪造该手势。
 */
import { isAbsolute, relative as pathRelative, resolve, sep } from 'node:path'
import { stat } from 'node:fs/promises'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** 该边界扫描的用户消息 source 种类（外部文本无法伪造）。 */
const USER_SOURCE_KIND = 'user'

/** 提及 token 的字面形态：`@` 后跟一个不含空白或 `@` 的路径。 */
const MENTION_PATTERN = /@([^\s@]+)/g

/**
 * 扫描一段文本里的 `@path` token，按首次出现顺序去重。目录芯片形态的
 * 尾斜杠（`@dir/`）被剥掉。
 * @param text - 消息文本块。
 * @returns 去重后的工作区相对 token。
 */
export function scanMentions(text) {
  const seen = new Set()
  const out = []
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const raw = match[1]
    const relative = raw.endsWith('/') ? raw.slice(0, -1) : raw
    if (relative === '' || seen.has(relative)) continue
    seen.add(relative)
    out.push(relative)
  }
  return out
}

/**
 * 把一个 token 解析为绝对路径及其种类，限制在 cwd 之内。
 * @param token - 工作区相对 token。
 * @param cwd - 会话工作区目录。
 * @param signal - 调用方生命周期。
 * @returns 解析结果；不在工作区内时返回 undefined。
 */
async function resolveMention(token, cwd, signal) {
  if (isAbsolute(token)) return undefined
  const absolute = resolve(cwd, token)
  const confined = pathRelative(cwd, absolute)
  if (confined === '..' || confined.startsWith(`..${sep}`) || isAbsolute(confined)) {
    return undefined
  }
  signal.throwIfAborted()
  const info = await stat(absolute).catch(() => undefined)
  signal.throwIfAborted()
  if (info === undefined) return undefined
  const relative = confined.split(sep).join('/') || '.'
  return { relative, kind: info.isDirectory() ? 'dir' : 'file' }
}

/** 转义一个 XML 属性值，不改动被引用的路径。 */
function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** 一条给模型的仅存在性引用。 */
function referenceForm(mention) {
  const kind = mention.kind === 'dir' ? 'directory' : 'file'
  return `<workspace-reference path="${escapeAttribute(mention.relative)}" kind="${kind}" />`
}

/**
 * 把每个 `@path` 提及展开为经过校验的仅存在性引用，按首次出现顺序。
 * 未知路径保持为普通正文。
 * @param messages - 组装好的步骤消息。
 * @param cwd - 会话工作区目录。
 * @param signal - 调用方生命周期。
 * @returns 注入的用户消息（无匹配或被禁用时为空数组）。
 */
export async function expandMentions(messages, cwd, signal) {
  if (cwd === undefined || !isAbsolute(cwd)) return []
  const tokens = []
  for (const message of messages) {
    if (message.source.kind !== USER_SOURCE_KIND) continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      tokens.push(...scanMentions(block.text))
    }
  }
  const injections = []
  for (const token of tokens) {
    signal.throwIfAborted()
    const mention = await resolveMention(token, cwd, signal)
    if (mention === undefined) continue
    injections.push(createUserMessage({
      content: [{ type: 'text', text: referenceForm(mention) }],
      source: { kind: 'at-file-mention', relative: mention.relative },
    }))
  }
  return injections
}

/**
 * agent/pre-step 监听器主体：在已认领的用户消息里展开提及，并把注入消息
 * 追加到下游 decision。抽取成独立函数以便在真实 agent 装配之外做单测。
 * @param agent - 被寻址的 agent（其 session header 拥有 cwd）。
 * @param isEnabled - 实时设置读取。
 * @param messages - 已认领的消息（用户自己的话）。
 * @param signal - 调用方生命周期。
 * @param next - 下游 waterfall。
 * @returns 追加注入后的 decision，或原样下游 decision。
 */
export async function mentionPreStep(agent, isEnabled, messages, signal, next) {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  if (!isEnabled()) return decision
  const cwd = agent.session.header.cwd
  const injections = await expandMentions(messages, cwd, signal)
  if (injections.length === 0) return decision
  return { kind: 'enter', messages: [...decision.messages, ...injections] }
}
