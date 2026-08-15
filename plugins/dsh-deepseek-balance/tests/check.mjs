// dsh-deepseek-balance 产物门检查（免启动）：验证包自洽，可在 CI/本地跑。
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
  if (rowId !== 'deepseek-balance') fail(`patch 行 id (${rowId}) 应为 deepseek-balance（插件名）`)
  else ok(`patch 行 id = ${rowId}（插件名，与 host.name 一致）`)
  try {
    require.resolve(rowName + '/package.json', { paths: [root] })
    ok('patch 行 name 可解析')
  } catch {
    const asDir = resolve(root, rowName)
    if (rowName === pkg.name) ok(`patch 行 name = 本包（${rowName}）`)
    else if (existsSync(asDir)) ok('patch 行 name 指向包目录')
    else fail('patch 行 name 无法解析')
  }
}

// 3. host 半体导出形状：优先真实 import（依赖可解析时），否则按源码检查。
const hostSrc = readFileSync(resolve(root, pkg.exports['.']), 'utf8')
for (const pat of [
  /export const name = 'deepseek-balance'/,
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
  if (host.name !== 'deepseek-balance') fail(`host.name (${host.name}) 应为 deepseek-balance（插件名，非包名）`)
  else ok('host.name = deepseek-balance（与 patch 行 id 一致）')
  if (typeof host.apply !== 'function') fail('host 缺少 apply(ctx, config)')
  else ok('host 导出 apply')
  if (host.Config === undefined) fail('host 缺少 Config schema')
  else ok('host 导出 Config schema（schemastery Schema）')
} else {
  console.log('⚠ @deepseek-ai/schemastery 未解析，跳过 host 深 import（装进 profile 后由真实组合验证）')
}

// 4. client bundle：__ModuleLoader__.load 包装 + id 与包名一致。
const clientSrc = readFileSync(resolve(root, pkg.exports['./client']), 'utf8')
if (!clientSrc.includes('__ModuleLoader__.load')) fail('client bundle 缺少 __ModuleLoader__.load 包装')
else ok('client bundle 含 __ModuleLoader__.load')
if (!clientSrc.includes(`id: '${pkg.name}'`)) fail(`client bundle id 不是 ${pkg.name}`)
else ok(`client bundle id = ${pkg.name}（与包名一致）`)

if (failures > 0) {
  console.error(`\n${failures} 项检查失败`)
  process.exit(1)
}
console.log('\n全部检查通过')
