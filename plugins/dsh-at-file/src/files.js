/**
 * 工作区路径索引：基于 node:fs 的流式目录遍历。内存保持 O(单层)，不跟随
 * 符号链接，按 basename 跳过配置的 ignore 目录，并在达到条目上限时如实标记
 * truncated。
 */
import { opendir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { compileIgnoreRules } from './defaults.js'

/** 等待一个 promise，信号中止时以信号原因为由拒绝。 */
function raceAbort(operation, signal) {
  if (signal === undefined) return operation
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      operation.catch(() => {})
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason) => {
        signal.removeEventListener('abort', onAbort)
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      },
    )
  })
}

/** 关闭一个已被调用方放弃的目录句柄，不等待排队的读。 */
function closeOrSwallow(handle, signal) {
  const closing = handle.close()
  if (signal && signal.aborted) {
    closing.catch(() => {})
    return Promise.resolve()
  }
  return closing
}

/**
 * 收集 root 下所有常规文件（有界、按名称排序；目录也作为条目进索引）。
 * @param root - 工作区根目录。
 * @param options - maxFiles 上限 + ignoreDirs + ignoreFiles 规则。
 * @param signal - 调用方生命周期；每个 fs await 都与之竞争。
 * @returns 排序后的条目列表 + 截断标志。
 */
export async function indexWorkspace(root, options, signal) {
  const ignoreDirs = new Set(options.ignoreDirs)
  const ignoreRules = compileIgnoreRules(options.ignoreFiles)
  const compiledRegex = new Map(ignoreRules
    .filter(rule => rule.kind === 'regex')
    .map(rule => [rule, new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i')]))
  const files = []
  const queue = [root]
  let truncated = false
  while (queue.length > 0) {
    if (signal) signal.throwIfAborted()
    const dir = queue.shift()
    let handle
    try {
      handle = await raceAbort(opendir(dir), signal)
    } catch (error) {
      if (signal) signal.throwIfAborted()
      throw new Error(`at-file: cannot list "${dir}": ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      for (;;) {
        const dirent = await raceAbort(handle.read(), signal)
        if (dirent === null) break
        if (files.length >= options.maxFiles) {
          truncated = true
          break
        }
        // 符号链接一律跳过（循环不可能困住遍历）。
        if (dirent.isSymbolicLink()) continue
        const child = join(dir, dirent.name)
        if (dirent.isDirectory()) {
          if (ignoreDirs.has(dirent.name)) continue
          files.push({ path: child, relative: displayRelative(root, child), kind: 'dir' })
          queue.push(child)
          continue
        }
        if (dirent.isFile() && !ignoreRules.some(rule => {
          if (rule.kind === 'exact') {
            return rule.caseSensitive
              ? dirent.name === rule.pattern
              : dirent.name.toLowerCase() === rule.pattern.toLowerCase()
          }
          return compiledRegex.get(rule).test(dirent.name)
        })) {
          files.push({ path: child, relative: displayRelative(root, child), kind: 'file' })
        }
      }
    } finally {
      await closeOrSwallow(handle, signal)
    }
    if (truncated) break
  }
  files.sort((a, b) => (a.relative < b.relative ? -1 : 1))
  return { files, truncated }
}

/** child 相对 root 的正斜杠显示路径（跨平台稳定）。 */
function displayRelative(root, child) {
  return relative(root, child).split(sep).join('/')
}
