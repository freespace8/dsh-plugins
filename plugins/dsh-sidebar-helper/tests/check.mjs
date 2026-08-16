// dsh-sidebar-helper 产物门检查（免启动）：验证包自洽 + 纯解析逻辑单测。
// 运行：node tests/check.mjs（包根目录）
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
let failures = 0
const fail = (msg) => { failures += 1; console.error('✗ ' + msg) }
const ok = (msg) => console.log('✓ ' + msg)
const assert = (cond, msg) => { if (cond) ok(msg); else fail(msg) }

// 0. 语法检查（不需要依赖解析）。
for (const f of ['src/index.js', 'lib/client.js']) {
  const r = spawnSync(process.execPath, ['--check', resolve(root, f)], { encoding: 'utf8' })
  if (r.status !== 0) fail(`${f} 语法错误: ${r.stderr}`)
  else ok(`${f} 语法通过`)
}

// 1. package.json 自洽：exports 与 files 指向的文件必须真实存在。
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
for (const [name, path] of Object.entries(pkg.exports)) {
  if (typeof path !== 'string') { fail(`exports.${name} 不是字符串路径`); continue }
  if (!existsSync(resolve(root, path))) fail(`exports.${name} -> ${path} 不存在`)
  else ok(`exports.${name} -> ${path}`)
}
for (const f of pkg.files ?? []) {
  if (!existsSync(resolve(root, f))) fail(`files 里的 ${f} 不存在`)
  else ok(`files/${f} 存在`)
}
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch 不是 ./cordis.patch.yml')
else ok('dsh.bundle.patch 指向 ./cordis.patch.yml')
if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform 不是 web（client 半体不会加载）')
else ok('dsh.client.platform = web')

// 2. patch 行：name 是包名（用于解析），id 是插件名（与 host.name 一致）。
const patch = readFileSync(resolve(root, pkg.dsh.bundle.patch), 'utf8')
const patchRow = patch.match(/- id: ([^\s]+)[\s\S]*?name: ([^\s]+)/)
let rowId = null
let rowName = null
if (!patchRow) fail('cordis.patch.yml 里找不到 insert 行')
else {
  rowId = patchRow[1]
  rowName = patchRow[2].replace(/^["']|["']$/g, '')
  if (rowName !== pkg.name) fail(`patch 行 name (${rowName}) 与包名 (${pkg.name}) 不一致`)
  else ok(`patch 行 name = ${rowName}（包名，用于解析）`)
  if (rowId !== 'sidebar-helper') fail(`patch 行 id (${rowId}) 应为 sidebar-helper（插件名）`)
  else ok(`patch 行 id = ${rowId}（插件名，与 host.name 一致）`)
}

// 3. host 半体导出形状：优先真实 import（依赖可解析时），否则按源码检查。
const hostSrc = readFileSync(resolve(root, pkg.exports['.']), 'utf8')
for (const pat of [
  /export const name = 'sidebar-helper'/,
  /export const Config =/,
  /export function apply\(/,
]) {
  if (pat.test(hostSrc)) ok(`host 源码含 ${pat}`)
  else fail(`host 源码缺少 ${pat}`)
}
let schemasteryResolvable = false
try {
  require.resolve('@deepseek-ai/schemastery', { paths: [root] })
  schemasteryResolvable = true
} catch { /* 源码树未装依赖，跳过深 import */ }
if (schemasteryResolvable) {
  const host = await import(resolve(root, pkg.exports['.']))
  if (host.name !== 'sidebar-helper') fail(`host.name (${host.name}) 应为 sidebar-helper（插件名，非包名）`)
  else ok('host.name = sidebar-helper（与 patch 行 id 一致）')
  if (typeof host.apply !== 'function') fail('host 缺少 apply(ctx, config)')
  else ok('host 导出 apply')
  if (host.Config === undefined) fail('host 缺少 Config schema')
  else ok('host 导出 Config schema（schemastery Schema）')
  const enabledDefault = host.Config().enabled
  if (enabledDefault !== true) fail(`Config.enabled 默认值应为 true，实际 ${enabledDefault}`)
  else ok('Config.enabled 默认 true')
} else {
  console.log('⚠ host 依赖未解析，跳过 host 深 import（装进 profile 后由真实组合验证）')
}

// 4. client bundle：__ModuleLoader__.load 包装 + id 与包名一致 + 零外部依赖。
const clientSrc = readFileSync(resolve(root, pkg.exports['./client']), 'utf8')
if (!clientSrc.includes('__ModuleLoader__.load')) fail('client bundle 缺少 __ModuleLoader__.load 包装')
else ok('client bundle 含 __ModuleLoader__.load')
if (!clientSrc.includes(`id: '${pkg.name}'`)) fail(`client bundle id 不是 ${pkg.name}`)
else ok(`client bundle id = ${pkg.name}（与包名一致）`)

// 4b. bundle 不 require 任何模块表之外的依赖（本插件刻意零依赖：纯 DOM）。
const MODULE_TABLE = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment', '@deepseek-ai/dsh-client-schema-form',
])
const requiredSpecs = [...clientSrc.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
const bad = requiredSpecs.filter((spec) => !MODULE_TABLE.has(spec))
if (bad.length > 0) fail(`client bundle 引用模块表外的模块: ${JSON.stringify(bad)}`)
else ok(`client bundle 依赖检查通过（require() 数量 ${requiredSpecs.length}）`)
// 注入项必须复用内置菜单的视觉 token（不是另一套硬编码色值）。
for (const token of ['--dsw-alias-label-primary', '--dsw-alias-interactive-bg-hover', '--dsw-alias-label-tertiary']) {
  if (clientSrc.includes(token)) ok(`注入项样式使用内置 token ${token}`)
  else fail(`注入项样式缺少内置 token ${token}`)
}

// 5. 纯解析逻辑单测。bundle 是经典脚本（浏览器用），Node 下经 vm 沙箱执行，
//    走到 module.exports 分支导出纯函数（ESM import 拿不到 module.exports）。
import vm from 'node:vm'
const bundleSandbox = { module: { exports: {} }, console, document: undefined }
vm.createContext(bundleSandbox)
vm.runInContext(clientSrc, bundleSandbox, { filename: 'lib/client.js' })
const bundle = bundleSandbox.module.exports
const { rowKind, projectRowTitle, resolveWorkspaceRow, copyText, INJECT_MARK } = bundle

// --- fake DOM：与真实渲染结构一致的极简对象（span 文本 / 属性 / 树关系） ---
function el(tag, { text = '', children = [], attrs = {} } = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children,
    attributes: new Map(Object.entries(attrs)),
    parentElement: null,
  }
  // textContent 与真实 DOM 一致：自身文本 + 后代文本聚合。
  Object.defineProperty(node, 'textContent', {
    get: () => text + node.children.map(c => c.textContent).join(''),
  })
  for (const child of children) {
    child.parentElement = node
  }
  node.hasAttribute = (name) => node.attributes.has(name)
  node.matches = (sel) => matchSel(node, sel)
  node.querySelector = (sel) => {
    const walk = (n) => {
      for (const c of n.children) {
        if (c.matches(sel)) return c
        const found = walk(c)
        if (found !== null) return found
      }
      return null
    }
    return walk(node)
  }
  return node
}

function matchSel(node, sel) {
  if (sel === '[role="treeitem"][aria-expanded]') {
    return node.attributes.get('role') === 'treeitem' && node.attributes.has('aria-expanded')
  }
  if (sel === '[role="treeitem"][aria-selected]') {
    return node.attributes.get('role') === 'treeitem' && node.attributes.has('aria-selected')
  }
  return false
}

const wsSnap = {
  items: [
    { workspaceId: 'w-alpha', title: 'alpha', path: '/Users/taylor/work/alpha', sessionIds: ['sA', 'sB'] },
    { workspaceId: 'w-beta', title: 'beta', path: '/Users/taylor/work/beta', sessionIds: ['sC'] },
  ],
  archivedSessionIds: [],
}

// 5.1 rowKind：按 aria 分派
{
  const project = el('div', { attrs: { role: 'treeitem', 'aria-expanded': 'true' }, children: [el('span', { text: 'alpha' })] })
  const session = el('div', { attrs: { role: 'treeitem', 'aria-selected': 'false' }, children: [el('span', { text: '会话A' })] })
  const stranger = el('div', { attrs: { role: 'treeitem' }, children: [el('span', { text: 'x' })] })
  assert(rowKind(project) === 'project', 'rowKind 识别项目行')
  assert(rowKind(session) === 'session', 'rowKind 识别会话行')
  assert(rowKind(stranger) === null, 'rowKind 对无 aria 的行返回 null')
}

// 5.2 项目行 → 工作区（含 path，供复制路径使用）
{
  const project = el('div', { attrs: { role: 'treeitem', 'aria-expanded': 'true' }, children: [el('span', { text: 'alpha' })] })
  const r = resolveWorkspaceRow(project, wsSnap)
  assert(r !== null && r.kind === 'workspace' && r.workspace.workspaceId === 'w-alpha'
    && r.workspace.path === '/Users/taylor/work/alpha', '项目行按标题解析到工作区（含 path）')
}

// 5.3 未知标题 → null（此时右键仍触发内置菜单，只是不注入复制路径）
{
  const unknown = el('div', { attrs: { role: 'treeitem', 'aria-expanded': 'true' }, children: [el('span', { text: 'nope' })] })
  assert(resolveWorkspaceRow(unknown, wsSnap) === null, '未知标题的项目行解析为 null')
}

// 5.4 projectRowTitle 取项目行标题（忽略图标/按钮 aria-label）
{
  const project = el('div', { attrs: { role: 'treeitem', 'aria-expanded': 'true' }, children: [el('span', { text: 'alpha' })] })
  assert(projectRowTitle(project) === 'alpha', 'projectRowTitle 取项目行标题')
}

// 5.5 同标题工作区（不同目录同名 basename）按 DOM 顺序消歧
{
  const wsSnapDup = { items: [
    { workspaceId: 'w1', title: 'project', path: '/a/project', sessionIds: [] },
    { workspaceId: 'w2', title: 'project', path: '/b/project', sessionIds: [] },
  ], archivedSessionIds: [] }
  const p1 = el('div', { attrs: { role: 'treeitem', 'aria-expanded': 'true' }, children: [el('span', { text: 'project' })] })
  const p2 = el('div', { attrs: { role: 'treeitem', 'aria-expanded': 'true' }, children: [el('span', { text: 'project' })] })
  bundleSandbox.document = { querySelectorAll: (sel) => [p1, p2].filter(r => r.matches(sel)) }
  assert(resolveWorkspaceRow(p1, wsSnapDup)?.workspace.workspaceId === 'w1', '同标题工作区第 1 行 → w1')
  assert(resolveWorkspaceRow(p2, wsSnapDup)?.workspace.workspaceId === 'w2', '同标题工作区第 2 行 → w2')
}

// 5.6 copyText 在无 navigator.clipboard 时走 execCommand 兜底（不抛异常）
{
  const calls = []
  bundleSandbox.navigator = { clipboard: { writeText: async () => { throw new Error('denied') } } }
  bundleSandbox.document = {
    createElement: () => ({ value: '', style: {}, select: () => { calls.push('select') }, remove: () => { calls.push('remove') } }),
    execCommand: () => { calls.push('exec'); return true },
    body: { appendChild: () => { calls.push('append') } },
  }
  const p = copyText('/a/b')
  assert(typeof p.then === 'function', 'copyText 返回 Promise')
  p.then((okv) => {
    assert(okv === true, 'execCommand 兜底成功返回 true')
    assert(calls.includes('select') && calls.includes('exec') && calls.includes('remove'), 'execCommand 兜底调用链完整')
  })
}

// 5.7 注入标记与样式 token 常量存在
{
  assert(typeof INJECT_MARK === 'string' && INJECT_MARK.startsWith('data-'), 'INJECT_MARK 是 data-* 属性')
}

if (failures > 0) {
  console.error(`\n${failures} 项检查失败`)
  process.exit(1)
}
console.log('\n全部检查通过')
