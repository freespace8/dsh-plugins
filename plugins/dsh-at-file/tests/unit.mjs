// dsh-at-file 纯逻辑单元测试（免启动、免框架）：mention 展开、目录索引、默认值。
// 运行：node tests/unit.mjs（包根目录）
// 需要 node:fs 临时目录与 @deepseek-ai/dsh-llm（从 harness 根 node_modules 解析）。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { scanMentions, expandMentions, mentionPreStep } = await import(resolve(root, 'src/mention.js'))
const { indexWorkspace } = await import(resolve(root, 'src/files.js'))
const {
  normalizeIgnoreFiles,
  ignoreRuleKey,
  workspacePathKey,
  effectiveIgnoreFiles,
  DEFAULT_IGNORE_DIRS,
} = await import(resolve(root, 'src/defaults.js'))

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('✓ ' + name)
  } catch (error) {
    failed += 1
    console.error('✗ ' + name)
    console.error('  ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n  ') : String(error)))
  }
}
function equal(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${label || 'value'} mismatch: got ${a}, want ${b}`)
}
function truthy(actual, label) {
  if (!actual) throw new Error(`${label || 'value'} is not truthy`)
}

// ------------------------------------------------------------------
// scanMentions
// ------------------------------------------------------------------
test('scanMentions: 基础路径', () => {
  equal(scanMentions('review @docs/spec.pdf'), ['docs/spec.pdf'])
})
test('scanMentions: 去重且保持顺序', () => {
  equal(scanMentions('@a @b @a'), ['a', 'b'])
})
test('scanMentions: 目录尾斜杠剥掉', () => {
  equal(scanMentions('open @src/ please'), ['src'])
})
test('scanMentions: 无提及', () => {
  equal(scanMentions('hello world'), [])
})
test('scanMentions: 不含空白或另一个 @', () => {
  equal(scanMentions('@a@b c'), ['a', 'b'])
  // 与上游一致：user@host 会匹配 @host，但后续 resolveMention 因路径不存在而丢弃。
  equal(scanMentions('user@host'), ['host'])
})

// ------------------------------------------------------------------
// 临时工作区工具
// ------------------------------------------------------------------
function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-at-file-unit-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'spec.pdf'), 'pdf')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.ts'), 'export {}')
  writeFileSync(join(dir, 'README.md'), '# hi')
  writeFileSync(join(dir, '.DS_Store'), 'x')
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'pkg.js'), 'x')
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'bundle.js'), 'x')
  return dir
}
function userMessage(text) {
  return { source: { kind: 'user' }, content: [{ type: 'text', text }] }
}
function noopSignal() {
  return { aborted: false, throwIfAborted() {} }
}

// ------------------------------------------------------------------
// expandMentions
// ------------------------------------------------------------------
test('expandMentions: 校验并展开为仅存在性引用', async () => {
  const dir = makeWorkspace()
  try {
    const injections = await expandMentions(
      [userMessage('see @docs/spec.pdf and @README.md')],
      dir,
      noopSignal(),
    )
    equal(injections.map(m => m.content[0].text), [
      '<workspace-reference path="docs/spec.pdf" kind="file" />',
      '<workspace-reference path="README.md" kind="file" />',
    ])
    equal(injections.map(m => m.source.kind), ['at-file-mention', 'at-file-mention'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('expandMentions: 目录提及标记为 directory', async () => {
  const dir = makeWorkspace()
  try {
    const injections = await expandMentions([userMessage('open @docs')], dir, noopSignal())
    equal(injections.map(m => m.content[0].text), [
      '<workspace-reference path="docs" kind="directory" />',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('expandMentions: 未知/越界/绝对路径保持普通正文', async () => {
  const dir = makeWorkspace()
  try {
    const injections = await expandMentions(
      [userMessage('@nope.txt @../outside @/etc/passwd')],
      dir,
      noopSignal(),
    )
    equal(injections, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('expandMentions: 只扫描 user source，且无 cwd 时跳过', async () => {
  const dir = makeWorkspace()
  try {
    const injections = await expandMentions(
      [{ source: { kind: 'model' }, content: [{ type: 'text', text: '@docs/spec.pdf' }] }],
      dir,
      noopSignal(),
    )
    equal(injections, [])
    equal(await expandMentions([userMessage('@README.md')], undefined, noopSignal()), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('expandMentions: XML 属性转义', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-at-file-unit-'))
  try {
    writeFileSync(join(dir, 'a&b"c.txt'), 'x')
    const injections = await expandMentions([userMessage('@a&b"c.txt')], dir, noopSignal())
    equal(injections.map(m => m.content[0].text), [
      '<workspace-reference path="a&amp;b&quot;c.txt" kind="file" />',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------
// mentionPreStep
// ------------------------------------------------------------------
test('mentionPreStep: enter 决策追加注入，reject 原样透传', async () => {
  const dir = makeWorkspace()
  try {
    const agent = { session: { header: { cwd: dir } } }
    const decision = await mentionPreStep(
      agent,
      () => true,
      [userMessage('use @README.md')],
      noopSignal(),
      async () => ({ kind: 'enter', messages: [userMessage('original')] }),
    )
    equal(decision.kind, 'enter')
    equal(decision.messages.length, 2)
    equal(decision.messages[1].content[0].text, '<workspace-reference path="README.md" kind="file" />')

    const rejected = await mentionPreStep(
      agent,
      () => true,
      [userMessage('use @README.md')],
      noopSignal(),
      async () => ({ kind: 'reject' }),
    )
    equal(rejected.kind, 'reject')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mentionPreStep: 设置禁用时不注入', async () => {
  const dir = makeWorkspace()
  try {
    const agent = { session: { header: { cwd: dir } } }
    const decision = await mentionPreStep(
      agent,
      () => false,
      [userMessage('use @README.md')],
      noopSignal(),
      async () => ({ kind: 'enter', messages: [userMessage('original')] }),
    )
    equal(decision.messages.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------
// indexWorkspace
// ------------------------------------------------------------------
test('indexWorkspace: 收集文件与目录，跳过 ignoreDirs 与 ignoreFiles', async () => {
  const dir = makeWorkspace()
  try {
    const { files, truncated } = await indexWorkspace(dir, {
      maxFiles: 100,
      ignoreDirs: DEFAULT_IGNORE_DIRS,
      ignoreFiles: ['.DS_Store'],
    })
    const rels = files.map(f => f.relative).sort()
    equal(rels, ['README.md', 'docs', 'docs/spec.pdf', 'src', 'src/index.ts'])
    equal(truncated, false)
    const kinds = Object.fromEntries(files.map(f => [f.relative, f.kind]))
    equal(kinds['docs'], 'dir')
    equal(kinds['src/index.ts'], 'file')
    truthy(files.every(f => f.path.startsWith(dir)), 'path 是绝对路径')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('indexWorkspace: maxFiles 截断如实标记', async () => {
  const dir = makeWorkspace()
  try {
    const { files, truncated } = await indexWorkspace(dir, {
      maxFiles: 3,
      ignoreDirs: [],
      ignoreFiles: [],
    })
    truthy(files.length <= 3, '不超过 maxFiles')
    truthy(truncated, 'truncated 为 true')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('indexWorkspace: 符号链接目录不进入', async () => {
  const dir = makeWorkspace()
  const outside = mkdtempSync(join(tmpdir(), 'dsh-at-file-unit-'))
  try {
    writeFileSync(join(outside, 'secret.txt'), 'x')
    try {
      symlinkSync(outside, join(dir, 'linked'), 'dir')
    } catch {
      // 平台不允许符号链接时跳过该断言
      console.log('  ⚠ 当前平台不允许符号链接，跳过')
      return
    }
    const { files } = await indexWorkspace(dir, { maxFiles: 100, ignoreDirs: [], ignoreFiles: [] })
    truthy(!files.some(f => f.relative === 'linked/secret.txt'), '符号链接目录的内容未被索引')
    truthy(!files.some(f => f.relative === 'linked'), '符号链接本身未被索引')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------
// defaults
// ------------------------------------------------------------------
test('defaults: normalizeIgnoreFiles 去空去重', () => {
  equal(normalizeIgnoreFiles(['a', 'A', ' ', 'a']), ['a'])
  equal(normalizeIgnoreFiles([{ kind: 'exact', pattern: 'a', caseSensitive: true }, 'a']), [
    { kind: 'exact', pattern: 'a', caseSensitive: true },
    'a',
  ])
  equal(ignoreRuleKey('a'), ignoreRuleKey('A'))
})

test('defaults: workspacePathKey 忽略尾斜杠与 Windows 大小写', () => {
  equal(workspacePathKey('/a/b/'), workspacePathKey('/a/b'))
  equal(workspacePathKey('C:\\Work'), workspacePathKey('c:/work'))
})

test('defaults: effectiveIgnoreFiles 合并全局与工作区局部', () => {
  const settings = {
    ignoreFiles: ['global.txt'],
    workspaceIgnoreFiles: [{ workspace: '/w', ignoreFiles: ['local.txt'] }],
  }
  equal(effectiveIgnoreFiles(settings, '/w'), ['global.txt', 'local.txt'])
  equal(effectiveIgnoreFiles(settings, '/other'), ['global.txt'])
})

// ------------------------------------------------------------------
// client bundle 可加载性冒烟（免浏览器）：捕获 factory，用 react stub 实例化。
// ------------------------------------------------------------------
test('client bundle: __ModuleLoader__.load 注册并产出 inject/apply', async () => {
  const fs = await import('node:fs')
  const pkg = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8'))
  const clientSrc = fs.readFileSync(resolve(root, 'lib/client.js'), 'utf8')
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(handoff) { captured = handoff },
      },
    },
  }
  const factory = new Function('window', `${clientSrc}\nreturn window.__ModuleLoader__`)
  factory(sandbox.window)
  truthy(captured !== null && captured.id === pkg.name, `注册了 id=${pkg.name}`)
  const reactStub = {
    createElement: (type) => ({ type }),
    useState: (init) => [init, () => {}],
  }
  const plugin = captured.factory((spec) => {
    if (spec === 'react') return reactStub
    throw new Error(`unexpected require: ${spec}`)
  })
  truthy(Array.isArray(plugin.inject), 'inject 是数组')
  truthy(typeof plugin.apply === 'function', 'apply 是函数')
})

// ------------------------------------------------------------------
// @路径文本插入契约测试：复刻 shell 输入机的 insertText（slash/input-insert-text，
// 与已装 dsh-client-ui-conversation/lib/client.js 的 insertText 语义逐字一致）——
// onPick 返回 { text } 把选中 span 替换为完整 @相对路径 + 尾空格；chip 外观由
// PillOverlay 覆盖层按真实文本测量渲染，草稿与提交文本一致（无占位符、无 codec）。
// ------------------------------------------------------------------
function shellInsertText(text, span, draft) {
  return draft.slice(0, span.start) + text + draft.slice(span.end)
}

test('@路径插入: 两次选择得到两个真实 @path 文本（自然占宽、提交即原文）', () => {
  let draft = ''
  // 1) 输入 @plugins/dsh-at-file 并选中目录 → 替换 span 为完整路径 + 尾空格
  draft = '@plugins/dsh-at-file'
  const text1 = '@plugins/dsh-at-file '
  draft = shellInsertText(text1, { start: 0, end: draft.length }, draft)
  equal(draft, '@plugins/dsh-at-file ', '第一次选择后草稿是完整 @相对路径 + 尾空格')
  // 2) 再 @ 一次，浏览到目录内选中 lib
  draft = draft + '@plugins/dsh-at-file/'
  const tokenStart = draft.lastIndexOf('@')
  const text2 = '@plugins/dsh-at-file/lib '
  draft = shellInsertText(text2, { start: tokenStart, end: draft.length }, draft)
  equal(draft, '@plugins/dsh-at-file @plugins/dsh-at-file/lib ', '两次选择后草稿是两个完整 @path，以空格分隔')
  // 提交就是草稿原文（无占位符需要序列化）。
  const sent = draft.trim()
  equal(sent, '@plugins/dsh-at-file @plugins/dsh-at-file/lib', '提交文本与草稿一致（host pre-step 会展开为引用）')
})

test('PillOverlay 扫描正则: 只匹配 @路径 token（含斜杠点），不匹配裸 @', () => {
  const re = /@[\w./-]+/g
  const draft = '见 @plugins/dsh-at-file/lib 与 @README.md，还有 @lib 和裸 @ 与 @。'.replace(/，/g, ' ').replace(/。$/g, '')
  const tokens = [...draft.matchAll(re)].map((m) => m[0])
  equal(tokens.join('|'), '@plugins/dsh-at-file/lib|@README.md|@lib', '斜杠/点/连字符路径整体是一个 token，裸 @ 不匹配')
})

// ------------------------------------------------------------------
// 整体删除决策测试：与 lib/client.js PillOverlay 的 onKeyDown 删除逻辑
//（tokenDeleteSpan）逐字一致——caret 紧贴 token 边界时 Backspace/Delete
// 一次删掉整个 token（连一个紧邻空格），否则返回 null（走普通逐字符删除）。
// ------------------------------------------------------------------
function tokenDeleteSpan(draft, key, pos, editing = false) {
  // editing=true 表示 @ 菜单还开着（正在输入过滤词、未确认选择）：放行逐字符删除
  if (editing) return null
  const re = /@[\w./-]+/g
  let match
  while ((match = re.exec(draft)) !== null) {
    const start = match.index
    const end = match.index + match[0].length
    let from = start
    let to = end
    if (key === 'Backspace') {
      if (!(pos > start && (pos <= end || (pos === end + 1 && draft[end] === ' ' && draft[pos] !== '@')))) continue
      if (draft[end] === ' ') to += 1
    } else {
      if (!(pos < end && (pos >= start || (pos === start - 1 && draft[start - 1] === ' ')))) continue
      if (start > 0 && draft[start - 1] === ' ') from -= 1
      else if (draft[end] === ' ') to += 1
    }
    return [from, to]
  }
  return null
}

test('整体删除: Backspace 在 token 右缘删整个 @路径（连带尾空格）', () => {
  const draft = '@plugins/dsh-at-file @plugins/dsh-at-file/lib '
  const firstEnd = '@plugins/dsh-at-file'.length
  const secondStart = firstEnd + 1
  const secondEnd = secondStart + '@plugins/dsh-at-file/lib'.length
  // caret 在第二个 token 末尾（紧贴 lib 之后）→ 删第二个 token + 尾空格
  equal(tokenDeleteSpan(draft, 'Backspace', secondEnd).join(','), `${secondStart},${secondEnd + 1}`, '删第二个 token 与尾空格')
  equal(draft.slice(0, secondStart) + draft.slice(secondEnd + 1), '@plugins/dsh-at-file ', '删除后草稿只剩第一个路径')
  // caret 在尾空格后面（选完路径后的默认位置）→ 一次退格就整体删掉，不用按两次
  equal(tokenDeleteSpan(draft, 'Backspace', secondEnd + 1).join(','), `${secondStart},${secondEnd + 1}`, 'caret 在尾空格后也一次删整个')
  // caret 在第一个 token 末尾 → 删第一个 token + 后面的分隔空格
  equal(tokenDeleteSpan(draft, 'Backspace', firstEnd).join(','), `0,${secondStart}`, '删第一个 token 与分隔空格')
  // caret 在 token 内部 → 也整体删除（不再逐字符删、不触发 @ 菜单）
  equal(tokenDeleteSpan(draft, 'Backspace', secondStart + 3).join(','), `${secondStart},${secondEnd + 1}`, 'caret 在 token 中间也整体删除')
  // caret 在 token 开头（@ 之前）→ 不拦截（正常删前面的内容）
  equal(tokenDeleteSpan(draft, 'Backspace', secondStart), null, 'caret 在 token 起点之前不拦截')
})

test('整体删除: @ 菜单开着（editing）时退格/Delete 放行逐字符删减', () => {
  const draft = '@plugins/dsh-at-file @li'
  // 菜单开着 = 正在输入过滤词、未确认选择：任何位置都不拦截整体删除
  equal(tokenDeleteSpan(draft, 'Backspace', 20, true), null, '菜单开时 Backspace 在过滤词右缘放行')
  equal(tokenDeleteSpan(draft, 'Backspace', 19, true), null, '菜单开时 Backspace 在过滤词内放行')
  equal(tokenDeleteSpan(draft, 'Delete', 18, true), null, '菜单开时 Delete 在过滤词内放行')
  equal(tokenDeleteSpan(draft, 'Backspace', 7, true), null, '菜单开时 Backspace 在已确认引用内也放行')
  equal(tokenDeleteSpan(draft, 'Backspace', 7, false).join(','), '0,21', '菜单关时同一位置仍整体删除已确认引用')
})

test('整体删除: Delete 在 token 左缘删整个 @路径（连带前导空格）', () => {
  const draft = '@plugins/dsh-at-file @plugins/dsh-at-file/lib '
  const firstEnd = '@plugins/dsh-at-file'.length
  const secondStart = firstEnd + 1
  // caret 在第二个 token 的 @ 之前 → 删前导空格 + 整个 token
  equal(tokenDeleteSpan(draft, 'Delete', secondStart).join(','), `${firstEnd},${secondStart + '@plugins/dsh-at-file/lib'.length}`, '删前导空格与 token')
  // caret 在前导空格左侧 → 也一次整体删除
  equal(tokenDeleteSpan(draft, 'Delete', secondStart - 1).join(','), `${firstEnd},${secondStart + '@plugins/dsh-at-file/lib'.length}`, 'caret 在前导空格左侧也一次删整个')
  // caret 在 token 内部 → 也整体删除
  equal(tokenDeleteSpan(draft, 'Delete', secondStart + 5).join(','), `${firstEnd},${secondStart + '@plugins/dsh-at-file/lib'.length}`, 'caret 在 token 中间也整体删除')
  // 行首 token 无前导空格 → 顺带删尾空格，不留孤立空格
  equal(tokenDeleteSpan(draft, 'Delete', 0).join(','), `0,${firstEnd + 1}`, '行首 token 删自身并带尾空格')
  // caret 在 token 末尾（右缘）→ 不拦截（正常删后面的内容）
  equal(tokenDeleteSpan(draft, 'Delete', secondStart + '@plugins/dsh-at-file/lib'.length), null, 'caret 在 token 右缘之后不拦截')
})

// ------------------------------------------------------------------
// 目录导航模型测试：与 lib/client.js 的 splitQuery / byNavigator /
// navigatorRows 逐字一致（查询按最后一个 '/' 拆成「目录+关键字」，只列直接
// 子项，目录在前、文件在后、各自字母排序）。
// ------------------------------------------------------------------
function splitQuery(query) {
  const q = query.trim()
  const at = q.lastIndexOf('/')
  if (at < 0) return { dir: '', keyword: q }
  return { dir: q.slice(0, at), keyword: q.slice(at + 1) }
}
function byNavigator(a, b) {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.relative.localeCompare(b.relative, undefined, { numeric: true, sensitivity: 'base' })
}
function navigatorRows(files, query, limit) {
  const { dir, keyword } = splitQuery(query)
  const prefix = dir === '' ? '' : dir + '/'
  const lowerKeyword = keyword.toLowerCase()
  const rows = []
  for (const file of files) {
    const relative = file.relative
    if (prefix !== '' && !relative.toLowerCase().startsWith(prefix.toLowerCase())) continue
    const rest = prefix === '' ? relative : relative.slice(prefix.length)
    if (rest === '' || rest.includes('/')) continue
    if (lowerKeyword !== '' && !rest.toLowerCase().includes(lowerKeyword)) continue
    rows.push(file)
  }
  rows.sort(byNavigator)
  return rows.slice(0, limit)
}

// 模拟 host search 的平铺索引（顺序无关，navigatorRows 内部排序）。
function fixtureIndex() {
  return [
    { path: '/w/README.md', relative: 'README.md', kind: 'file' },
    { path: '/w/plugins', relative: 'plugins', kind: 'dir' },
    { path: '/w/plugins/dsh-at-file', relative: 'plugins/dsh-at-file', kind: 'dir' },
    { path: '/w/plugins/dsh-at-file/cordis.patch.yml', relative: 'plugins/dsh-at-file/cordis.patch.yml', kind: 'file' },
    { path: '/w/plugins/dsh-at-file/package.json', relative: 'plugins/dsh-at-file/package.json', kind: 'file' },
    { path: '/w/plugins/dsh-at-file/lib', relative: 'plugins/dsh-at-file/lib', kind: 'dir' },
    { path: '/w/plugins/dsh-at-file/lib/client.js', relative: 'plugins/dsh-at-file/lib/client.js', kind: 'file' },
    { path: '/w/plugins/dsh-at-file/src', relative: 'plugins/dsh-at-file/src', kind: 'dir' },
    { path: '/w/plugins/dsh-at-file/src/index.js', relative: 'plugins/dsh-at-file/src/index.js', kind: 'file' },
    { path: '/w/plugins/dsh-deepseek-balance', relative: 'plugins/dsh-deepseek-balance', kind: 'dir' },
    { path: '/w/plugins/dsh-deepseek-balance/README.md', relative: 'plugins/dsh-deepseek-balance/README.md', kind: 'file' },
    { path: '/w/plugins/dsh-free-vision', relative: 'plugins/dsh-free-vision', kind: 'dir' },
    { path: '/w/plugins/dsh-free-vision/README.md', relative: 'plugins/dsh-free-vision/README.md', kind: 'file' },
    { path: '/w/docs', relative: 'docs', kind: 'dir' },
    { path: '/w/docs/spec.pdf', relative: 'docs/spec.pdf', kind: 'file' },
  ]
}
function rels(rows) { return rows.map(r => r.relative) }

test('splitQuery: 按最后一个 / 拆目录与关键字', () => {
  equal(splitQuery('plugins/d'), { dir: 'plugins', keyword: 'd' })
  equal(splitQuery('plugins/'), { dir: 'plugins', keyword: '' })
  equal(splitQuery('plugins/dsh-at-file/lib'), { dir: 'plugins/dsh-at-file', keyword: 'lib' })
  equal(splitQuery('d'), { dir: '', keyword: 'd' })
  equal(splitQuery(''), { dir: '', keyword: '' })
})

test('navigatorRows: plugins/d 只列 plugins 直接子项中名字含 d 的，目录在前字母序', () => {
  const rows = navigatorRows(fixtureIndex(), 'plugins/d', 12)
  equal(rels(rows), [
    'plugins/dsh-at-file',
    'plugins/dsh-deepseek-balance',
    'plugins/dsh-free-vision',
  ])
  truthy(rows.every(r => r.kind === 'dir'), 'plugins 下直接子项都是目录')
})

test('navigatorRows: 深度条目不进入（只看直接子项）', () => {
  const rows = navigatorRows(fixtureIndex(), 'plugins/dsh-at-file/', 12)
  equal(rels(rows), [
    'plugins/dsh-at-file/lib',
    'plugins/dsh-at-file/src',
    'plugins/dsh-at-file/cordis.patch.yml',
    'plugins/dsh-at-file/package.json',
  ])
  equal(rows[0].kind, 'dir', 'lib 是目录')
  equal(rows[1].kind, 'dir', 'src 是目录')
  equal(rows[2].kind, 'file', 'cordis.patch.yml 是文件')
  equal(rows[3].kind, 'file', 'package.json 是文件')
  truthy(!rels(rows).includes('plugins/dsh-at-file/lib/client.js'), 'lib/client.js 是孙级，不出现')
  truthy(!rels(rows).includes('plugins/dsh-at-file'), '目录自身不出现')
})

test('navigatorRows: 空查询列出根直接子项，目录在前文件在后各自字母序', () => {
  const rows = navigatorRows(fixtureIndex(), '', 12)
  equal(rels(rows), ['docs', 'plugins', 'README.md'])
  equal(rows[0].kind, 'dir')
  equal(rows[1].kind, 'dir')
  equal(rows[2].kind, 'file')
})

test('navigatorRows: 关键字匹配子项名（不区分大小写），根级不匹配深层', () => {
  equal(rels(navigatorRows(fixtureIndex(), 'PLUGINS/D', 12)),
    rels(navigatorRows(fixtureIndex(), 'plugins/d', 12)), '大小写不敏感')
  equal(rels(navigatorRows(fixtureIndex(), 'dsh', 12)), [], '根级没有名字含 dsh 的直接子项 → 空')
  equal(rels(navigatorRows(fixtureIndex(), 'plugins/dsh-at-file/pack', 12)),
    ['plugins/dsh-at-file/package.json'], '目录内按子项名过滤')
  equal(rels(navigatorRows(fixtureIndex(), 'plugins/dsh', 12)),
    ['plugins/dsh-at-file', 'plugins/dsh-deepseek-balance', 'plugins/dsh-free-vision'], '目录内前缀 dsh 三个都命中')
})

test('navigatorRows: limit 截断', () => {
  equal(rels(navigatorRows(fixtureIndex(), 'plugins/', 2)),
    ['plugins/dsh-at-file', 'plugins/dsh-deepseek-balance'], '只取前 2')
})

// ------------------------------------------------------------------
// @ token span 测试：与 lib/client.js PillOverlay 的 atTriggerSpan 逐字一致
//（从 caret 向左找当前 @ token：先遇空白则无 token；只认词边界后的 '@'）。
// ------------------------------------------------------------------
function atTriggerSpan(draft, caret) {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i)
    if (/\s/.test(ch)) return null
    if (ch !== '@') continue
    if (i > 0 && /[\p{L}\p{N}_]/u.test(draft.charAt(i - 1))) continue
    return { start: i, end: caret }
  }
  return null
}

test('atTriggerSpan: 当前 @ token 的 span', () => {
  equal(atTriggerSpan('@plugins/d', 10), { start: 0, end: 10 }, 'caret 在末尾')
  equal(atTriggerSpan('@plugins/d', 5), { start: 0, end: 5 }, 'caret 在 token 中间')
  equal(atTriggerSpan('see @plugins/d', 14), { start: 4, end: 14 }, '行中 token')
  equal(atTriggerSpan('@plugins/d ', 11), null, 'caret 在尾空格后无 live token')
  equal(atTriggerSpan('user@host', 9), null, 'user@host 的 @ 前是词字符，不算 trigger')
  equal(atTriggerSpan('@a@b', 4), { start: 0, end: 4 }, '取离 caret 最近且有词边界的 @')
  equal(atTriggerSpan('', 0), null, '空草稿无 token')
})

// ------------------------------------------------------------------
// Enter/Tab 决策与文本替换测试：与 lib/client.js PillOverlay 的
// enterOrTabAccepted / spliceAtToken 逻辑逐字一致——Enter：目录导航进入
//（`@目录/`）、文件放行给 shell pick；Tab：无论文件还是目录都直接确定选择
//（`@路径 `，目录不进入下级）。
// ------------------------------------------------------------------
// 返回要替换进草稿的文本；null 表示不拦截（放行给 shell）。
function keyText(row, key) {
  if (row === undefined) return null
  if (key === 'Enter') {
    if (row.atFileKind !== 'dir') return null
    return `@${row.value}/`
  }
  return `@${row.value} `
}
function shouldIntercept(row, key) {
  return keyText(row, key) !== null
}
function dirRow() {
  return { name: 'dsh-at-file', value: 'plugins/dsh-at-file', atFileKind: 'dir' }
}
function fileRow() {
  return { name: 'package.json', value: 'plugins/dsh-at-file/package.json', atFileKind: 'file' }
}

test('Enter/Tab 决策: Enter 目录导航/文件放行，Tab 一律确定选择', () => {
  truthy(shouldIntercept(dirRow(), 'Enter'), '目录 + Enter 拦截（导航进入）')
  truthy(shouldIntercept(dirRow(), 'Tab'), '目录 + Tab 拦截（直接确定选择）')
  equal(shouldIntercept(fileRow(), 'Enter'), false, '文件 + Enter 放行给 shell pick')
  truthy(shouldIntercept(fileRow(), 'Tab'), '文件 + Tab 拦截（直接确定选择）')
  equal(shouldIntercept(undefined, 'Enter'), false, '无活动候选不拦截')
  equal(keyText(dirRow(), 'Enter'), '@plugins/dsh-at-file/', 'Enter 目录 → 尾 /（导航进入）')
  equal(keyText(dirRow(), 'Tab'), '@plugins/dsh-at-file ', 'Tab 目录 → 尾空格（直接确定，不进入）')
  equal(keyText(fileRow(), 'Tab'), '@plugins/dsh-at-file/package.json ', 'Tab 文件 → 尾空格（直接确定）')
  equal(keyText(fileRow(), 'Enter'), null, 'Enter 文件 → 放行')
})

test('导航替换: Enter 目录进入后菜单以目录内容重新打开', () => {
  // 1) 输入 @plugins/d，高亮目录 dsh-at-file，按 Enter → span 替换为 @plugins/dsh-at-file/
  const draft = '@plugins/d'
  const span = atTriggerSpan(draft, draft.length)
  const next = draft.slice(0, span.start) + keyText(dirRow(), 'Enter') + draft.slice(span.end)
  equal(next, '@plugins/dsh-at-file/', '草稿变成 @目录/')
  // 2) 输入机重新 detectTrigger：新的 query = 目录路径（尾 /）
  const query = next.slice(1)
  equal(query, 'plugins/dsh-at-file/', '新查询是目录路径')
  equal(rels(navigatorRows(fixtureIndex(), query, 12)),
    ['plugins/dsh-at-file/lib', 'plugins/dsh-at-file/src', 'plugins/dsh-at-file/cordis.patch.yml', 'plugins/dsh-at-file/package.json'],
    '菜单立即列出该目录的直接子项')
})

test('导航替换: Tab 确定选择后菜单关闭（尾空格，目录同样不进入）', () => {
  // Tab 目录：@plugins/d 高亮 dsh-at-file → 插入 @plugins/dsh-at-file （尾空格）
  const draft = '@plugins/d'
  const span = atTriggerSpan(draft, draft.length)
  const next = draft.slice(0, span.start) + keyText(dirRow(), 'Tab') + draft.slice(span.end)
  equal(next, '@plugins/dsh-at-file ', 'Tab 目录替换以尾空格结尾（不进入下级）')
  equal(atTriggerSpan(next, next.length), null, '尾空格后无 live token → 菜单关闭')
  // Tab 文件：同样直接确定
  const draftFile = '@plugins/dsh-at-file/pa'
  const spanFile = atTriggerSpan(draftFile, draftFile.length)
  const nextFile = draftFile.slice(0, spanFile.start) + keyText(fileRow(), 'Tab') + draftFile.slice(spanFile.end)
  equal(nextFile, '@plugins/dsh-at-file/package.json ', 'Tab 文件替换以尾空格结尾')
  equal(atTriggerSpan(nextFile, nextFile.length), null, '尾空格后无 live token → 菜单关闭')
})

// ------------------------------------------------------------------
// 汇总
// ------------------------------------------------------------------
console.log(`\n${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exit(1)
