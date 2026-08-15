/**
 * dsh-at-file 默认值：选择器索引默认跳过的目录/文件名，以及过滤规则归一化。
 * 所有可调值都能从 profile 的 cordis.patch.yml 覆盖。
 */

/** 默认跳过的目录名（版本控制、IDE 元数据、依赖树、缓存、构建产物）。 */
export const DEFAULT_IGNORE_DIRS = [
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vs',
  '.vscode',
  '.fleet',
  '.history',
  '.metadata',
  '.settings',
  'node_modules',
  'bower_components',
  'vendor',
  'Pods',
  '.gradle',
  '.kotlin',
  '.cxx',
  '.externalNativeBuild',
  '.dart_tool',
  '.swiftpm',
  '.build',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.nx',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.angular',
  'build',
  'bin',
  'dist',
  'out',
  'target',
  'obj',
  'coverage',
  'DerivedData',
  'xcuserdata',
  'CMakeFiles',
  'cmake-build-debug',
  'cmake-build-release',
  'cmake-build-relwithdebinfo',
  'cmake-build-minsizerel',
  '_deps',
  '.godot',
  'Library',
  'Temp',
  'Logs',
  'Binaries',
  'Intermediate',
  'Saved',
  'DerivedDataCache',
]

/** 默认跳过的文件名（OS 元数据）。 */
export const DEFAULT_IGNORE_FILES = [
  'desktop.ini',
  'Thumbs.db',
  '.DS_Store',
]

/** 把一条 legacy 字符串或结构化规则转成规范规则；空规则返回 undefined。 */
export function normalizeIgnoreRule(value) {
  if (typeof value === 'string') {
    const pattern = value.trim()
    return pattern === '' ? undefined : { kind: 'exact', pattern, caseSensitive: false }
  }
  const pattern = value.pattern.trim()
  if (pattern === '') return undefined
  const rule = { kind: value.kind, pattern, caseSensitive: value.caseSensitive }
  if (rule.kind === 'regex') {
    try {
      new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i')
    } catch (error) {
      throw new Error(`Invalid regular expression "${rule.pattern}": ${String(error)}`)
    }
  }
  return rule
}

/** 一条规则（含匹配语义）的稳定身份。 */
export function ignoreRuleKey(value) {
  const rule = normalizeIgnoreRule(value)
  if (rule === undefined) return ''
  const pattern = rule.kind === 'exact' && !rule.caseSensitive ? rule.pattern.toLowerCase() : rule.pattern
  return JSON.stringify([rule.kind, pattern, rule.caseSensitive])
}

/** 修剪、去空、按匹配语义去重。 */
export function normalizeIgnoreFiles(values) {
  const seen = new Set()
  const normalized = []
  for (const value of values) {
    const rule = normalizeIgnoreRule(value)
    if (rule === undefined) continue
    const key = ignoreRuleKey(rule)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(typeof value === 'string' && rule.kind === 'exact' && !rule.caseSensitive
      ? rule.pattern
      : rule)
  }
  return normalized
}

/** 一次性把规则列表编译成规范化数组（供目录遍历使用）。 */
export function compileIgnoreRules(values) {
  return normalizeIgnoreFiles(values).map(value => normalizeIgnoreRule(value))
}

/** 一个规范工作区路径的稳定比较键（忽略尾斜杠、大小写仅用于 Windows 盘符/UNC）。 */
export function workspacePathKey(value) {
  const slashed = value.replace(/\\/gu, '/')
  const withoutTrailing = slashed === '/' || /^[a-z]:\/$/iu.test(slashed)
    ? slashed
    : slashed.replace(/\/+$/u, '')
  return /^[a-z]:\//iu.test(withoutTrailing) || withoutTrailing.startsWith('//')
    ? withoutTrailing.toLowerCase()
    : withoutTrailing
}

/** 合并重复工作区行并归一化每个文件列表。 */
export function normalizeWorkspaceIgnoreFiles(entries) {
  const order = []
  const byWorkspace = new Map()
  for (const entry of entries) {
    const key = workspacePathKey(entry.workspace)
    if (key === '') continue
    const current = byWorkspace.get(key)
    if (current === undefined) order.push(key)
    byWorkspace.set(key, {
      workspace: current ? current.workspace : entry.workspace,
      ignoreFiles: normalizeIgnoreFiles([
        ...(current ? current.ignoreFiles : []),
        ...entry.ignoreFiles,
      ]),
    })
  }
  return order.map(key => byWorkspace.get(key))
}

/** 某工作区的局部文件过滤规则。 */
export function workspaceIgnoreFilesFor(entries, workspace) {
  const key = workspacePathKey(workspace)
  const entry = normalizeWorkspaceIgnoreFiles(entries)
    .find(candidate => workspacePathKey(candidate.workspace) === key)
  return entry ? entry.ignoreFiles : []
}

/** 生效过滤规则 = 全局 + 当前工作区局部。 */
export function effectiveIgnoreFiles(settings, workspace) {
  return normalizeIgnoreFiles([
    ...settings.ignoreFiles,
    ...workspaceIgnoreFilesFor(settings.workspaceIgnoreFiles || [], workspace),
  ])
}

/** 覆盖所有过滤规则设置的稳定缓存键。 */
export function ignoreFilesSettingsKey(settings) {
  const global = normalizeIgnoreFiles(settings.ignoreFiles).map(ignoreRuleKey).sort()
  const workspaces = normalizeWorkspaceIgnoreFiles(settings.workspaceIgnoreFiles || [])
    .map(entry => ({
      workspace: workspacePathKey(entry.workspace),
      ignoreFiles: entry.ignoreFiles.map(ignoreRuleKey).sort(),
    }))
    .sort((left, right) => left.workspace.localeCompare(right.workspace))
  return JSON.stringify({ global, workspaces })
}
