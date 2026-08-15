// dsh-at-file — client 半体（免构建 bundle）。
// 浏览器侧通过 __ModuleLoader__.load 注册；id 必须等于包名（patch 行的 name）。
// 本文件被 host 扫描后经 /plugins/@freespace8/dsh-at-file/client.js 提供给浏览器。
//
// 约束：client bundle 的 require 只能命中平台 seed 模块（react 等），不能
// require zod / @deepseek-ai/* —— 因此本文件自带：
//   - 最小 zod 兼容 codec（只有 .parse()，网关/ClientRemote 仅需它）；
//   - 选择器搜索、图标、样式、locale、设置快照 store 全部内联。
// host 与 client 的 Typert 描述符保持一致（见 src/contract.js 同注释）。
window.__ModuleLoader__.load({
  id: '@freespace8/dsh-at-file',
  factory: (require) => {
    const React = require('react')

    // ------------------------------------------------------------------
    // 常量
    // ------------------------------------------------------------------
    const NS = 'at-file'
    // source 名同时作为 @ 菜单的分组标题（t 查不到翻译时显示原样），
    // 用贴近功能的中文名，而不是技术代号 at-file。
    const SOURCE_NAME = '文件/文件夹'
    const STYLE_ID = 'dsh-at-file-style'
    const MAX_CANDIDATES = 12
    const INDEX_TTL_MS = 30000
    const DEFAULT_IGNORE_FILES = ['desktop.ini', 'Thumbs.db', '.DS_Store']

    // ------------------------------------------------------------------
    // 最小 zod 兼容 codec（仅 .parse；供 ClientRemote 与注册表校验）
    // ------------------------------------------------------------------
    const sessionIdSchema = {
      parse(v) {
        if (typeof v !== 'string' || v.length === 0) throw new Error('sessionId must be a non-empty string')
        return v
      },
    }
    const fileEntrySchema = {
      parse(v) {
        if (v === null || typeof v !== 'object') throw new Error('FileEntry must be an object')
        if (typeof v.path !== 'string' || typeof v.relative !== 'string') throw new Error('FileEntry path/relative must be strings')
        if (v.kind !== 'file' && v.kind !== 'dir') throw new Error('FileEntry kind must be file|dir')
        return v
      },
    }
    const fileEntryArraySchema = {
      parse(v) {
        if (!Array.isArray(v)) throw new Error('expected FileEntry[]')
        return v.map((e) => fileEntrySchema.parse(e))
      },
    }
    const ignoreRuleInputSchema = {
      parse(v) {
        if (typeof v === 'string') return v
        if (v !== null && typeof v === 'object'
          && (v.kind === 'exact' || v.kind === 'regex')
          && typeof v.pattern === 'string'
          && typeof v.caseSensitive === 'boolean') return v
        throw new Error('invalid file ignore rule')
      },
    }
    const workspaceIgnoreFilesSchema = {
      parse(v) {
        if (v === null || typeof v !== 'object' || typeof v.workspace !== 'string' || !Array.isArray(v.ignoreFiles)) {
          throw new Error('invalid workspace ignore files')
        }
        return v
      },
    }
    const atFileSettingsSchema = {
      parse(v) {
        if (v === null || typeof v !== 'object' || typeof v.enabled !== 'boolean') throw new Error('invalid at-file settings')
        return v
      },
    }
    const atFileSettingsUpdateSchema = {
      parse(v) {
        if (v === null || typeof v !== 'object' || typeof v.field !== 'string') throw new Error('invalid settings update')
        if (v.field === 'enabled' && typeof v.value === 'boolean') return v
        if (v.field === 'ignoreFiles' && Array.isArray(v.value)) return v
        if (v.field === 'workspaceIgnoreFiles' && Array.isArray(v.value)) return v
        throw new Error('invalid settings update for field ' + String(v.field))
      },
    }

    const AT_FILE_INVOCATIONS = [
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
            codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: sessionIdSchema },
          },
        ],
        cancellation: { parameter: 'signal' },
        result: { mode: 'strict', typeSymbol: 'dsh-at-file#FileEntry[]', schema: fileEntryArraySchema },
      },
      {
        id: 'dsh-at-file#atFile/getSettings',
        service: 'atFile',
        namespace: 'atFile',
        method: 'getSettings',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'strict', typeSymbol: 'dsh-at-file#AtFileSettings', schema: atFileSettingsSchema },
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
            codec: { mode: 'strict', typeSymbol: 'dsh-at-file#AtFileSettingsUpdate', schema: atFileSettingsUpdateSchema },
          },
        ],
        result: { mode: 'strict', typeSymbol: 'dsh-at-file#AtFileSettings', schema: atFileSettingsSchema },
      },
    ]

    const AT_FILE_REMOTE = { package: 'dsh-at-file', descriptors: AT_FILE_INVOCATIONS }

    // ------------------------------------------------------------------
    // 默认值
    // ------------------------------------------------------------------
    const DEFAULT_IGNORE_DIRS = [
      '.git', '.hg', '.svn', '.idea', '.vs', '.vscode', '.fleet', '.history', '.metadata', '.settings',
      'node_modules', 'bower_components', 'vendor', 'Pods', '.gradle', '.kotlin', '.cxx',
      '.externalNativeBuild', '.dart_tool', '.swiftpm', '.build', '.cache', '.parcel-cache', '.turbo',
      '.nx', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv',
      '.next', '.nuxt', '.output', '.svelte-kit', '.angular', 'build', 'bin', 'dist', 'out', 'target',
      'obj', 'coverage', 'DerivedData', 'xcuserdata', 'CMakeFiles', 'cmake-build-debug',
      'cmake-build-release', 'cmake-build-relwithdebinfo', 'cmake-build-minsizerel', '_deps',
      '.godot', 'Library', 'Temp', 'Logs', 'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache',
    ]

    function defaultSettings() {
      return { enabled: true, ignoreFiles: [...DEFAULT_IGNORE_FILES], workspaceIgnoreFiles: [] }
    }

    // ------------------------------------------------------------------
    // 选择器模型与搜索排序（纯函数）
    // ------------------------------------------------------------------
    function dirnameOf(relative) {
      const at = relative.lastIndexOf('/')
      return at < 0 ? '' : relative.slice(0, at)
    }
    function basenameOf(relative) {
      const at = relative.lastIndexOf('/')
      return at < 0 ? relative : relative.slice(at + 1)
    }
    /**
     * 目录导航模型：把查询按最后一个 `/` 拆成「所在目录 + 过滤关键字」。
     * `plugins/d` → 目录 plugins、关键字 d（plugins 下匹配 d 的内容）；
     * `plugins/` → 目录 plugins、空关键字（plugins 下全部内容）。
     * @param query - 触发 token 里 trigger 之后、caret 之前的文本。
     * @returns { dir, keyword }。
     */
    function splitQuery(query) {
      const q = query.trim()
      const at = q.lastIndexOf('/')
      if (at < 0) return { dir: '', keyword: q }
      return { dir: q.slice(0, at), keyword: q.slice(at + 1) }
    }

    /** 目录在前、文件在后，各自按名称字母排序（不区分大小写、数字自然序）。 */
    function byNavigator(a, b) {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.relative.localeCompare(b.relative, undefined, { numeric: true, sensitivity: 'base' })
    }

    /**
     * 目录导航候选：只看 dir 的**直接子项**（目录与文件），按关键字过滤子项名称，
     * 目录在前、文件在后、各自字母排序。`plugins/d` 因此只返回 plugins 下的直接
     * 子项中名字含 d 的条目，不再做全工作区的模糊段匹配。
     * @param files - 工作区平铺索引（host search 结果，含目录与文件）。
     * @param query - 当前触发查询。
     * @param limit - 候选上限。
     * @returns 有界、已排序的直接子项。
     */
    function navigatorRows(files, query, limit) {
      const { dir, keyword } = splitQuery(query)
      const prefix = dir === '' ? '' : dir + '/'
      const lowerKeyword = keyword.toLowerCase()
      const rows = []
      for (const file of files) {
        const relative = file.relative
        // 目录前缀按不区分大小写匹配（菜单显示与插入都用索引里的真实大小写）。
        if (prefix !== '' && !relative.toLowerCase().startsWith(prefix.toLowerCase())) continue
        const rest = prefix === '' ? relative : relative.slice(prefix.length)
        if (rest === '' || rest.includes('/')) continue // 只看直接子项
        if (lowerKeyword !== '' && !rest.toLowerCase().includes(lowerKeyword)) continue
        rows.push(file)
      }
      rows.sort(byNavigator)
      return rows.slice(0, limit)
    }

    // ------------------------------------------------------------------
    // 图标
    // ------------------------------------------------------------------
    const CODE_EXTENSIONS = new Set([
      'c', 'cc', 'cpp', 'cs', 'css', 'dart', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'kt', 'kts',
      'lua', 'mjs', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'svelte', 'swift', 'ts', 'tsx', 'vue',
    ])
    const TEXT_EXTENSIONS = new Set(['adoc', 'log', 'md', 'mdx', 'rst', 'text', 'txt'])
    const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
    const DATA_EXTENSIONS = new Set(['conf', 'config', 'csv', 'ini', 'json', 'jsonl', 'toml', 'tsv', 'xml', 'yaml', 'yml'])
    const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'jar', 'rar', 'tar', 'tgz', 'war', 'xz', 'zip'])
    const TEXT_NAMES = new Set(['authors', 'changelog', 'copying', 'license', 'readme'])
    const CODE_NAMES = new Set(['dockerfile', 'gemfile', 'makefile', 'rakefile'])

    function fileIconKind(entry) {
      if (entry.kind === 'dir') return 'folder'
      const basename = entry.relative.slice(entry.relative.lastIndexOf('/') + 1).toLowerCase()
      const dot = basename.lastIndexOf('.')
      const extension = dot > 0 ? basename.slice(dot + 1) : ''
      if (extension === 'pdf') return 'pdf'
      if (IMAGE_EXTENSIONS.has(extension)) return 'image'
      if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive'
      if (CODE_EXTENSIONS.has(extension) || CODE_NAMES.has(basename)) return 'code'
      if (DATA_EXTENSIONS.has(extension) || basename === '.env' || basename.startsWith('.env.')) return 'data'
      if (TEXT_EXTENSIONS.has(extension) || TEXT_NAMES.has(basename)) return 'text'
      return 'file'
    }

    const ICON_PATHS = {
      folder: [{ d: 'M1.75 4.25A1.25 1.25 0 0 1 3 3h3l1.25 1.5H13A1.25 1.25 0 0 1 14.25 5.75v6A1.25 1.25 0 0 1 13 13H3a1.25 1.25 0 0 1-1.25-1.25v-7.5Z', sw: 1.3 }],
      code: [{ d: 'm6.25 4.25-3 3.75 3 3.75M9.75 4.25l3 3.75-3 3.75', sw: 1.35 }],
      text: [
        { d: 'M3 1.75h6l4 4v8.5H3V1.75Z', sw: 1.2 },
        { d: 'M9 1.75v4h4M5.25 8.25h5.5M5.25 10.75h4', sw: 1.1 },
      ],
      pdf: [
        { d: 'M3 1.75h6l4 4v8.5H3V1.75Z', sw: 1.2 },
        { d: 'M9 1.75v4h4M5 10.75c1.25-2.5 2.25-3.75 3-3.75.9 0 .85 3 2.75 3', sw: 1.05 },
      ],
      image: [
        { d: 'M2 2.5h12v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11Z', sw: 1.2 },
        { d: 'M5.25 5.75m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', fill: true },
        { d: 'm3.5 12 3.25-3.5 2 2 1.5-1.5 2.25 3', sw: 1.1 },
      ],
      data: [
        { d: 'M2 6.5h12M2 6.5v3a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 14 9.5v-3', sw: 1.2 },
        { d: 'M4 5V3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', sw: 1.2 },
      ],
      archive: [
        { d: 'M2 6.5h12M2 6.5v7A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-7M5.5 6.5V5A2.5 2.5 0 0 1 8 2.5a2.5 2.5 0 0 1 2.5 2.5v1.5', sw: 1.2 },
        { d: 'M8 9v3M6.5 10.5h3', sw: 1.2 },
      ],
      file: [
        { d: 'M3 1.75h6l4 4v8.5H3V1.75Z', sw: 1.2 },
        { d: 'M9 1.75v4h4', sw: 1.1 },
      ],
    }
    const ICON_COLORS = {
      folder: '#e8a23a', code: '#4d9de0', text: '#8c98a5', pdf: '#e15b64',
      image: '#55a875', data: '#9a78d1', archive: '#b07bd4', file: '#a8b3bf',
    }

    function fileIcon(entry) {
      const kind = fileIconKind(entry)
      const paths = ICON_PATHS[kind] || ICON_PATHS.file
      const children = paths.map((p, i) => React.createElement('path', {
        key: i,
        d: p.d,
        fill: p.fill ? 'currentColor' : 'none',
        stroke: p.fill ? 'none' : 'currentColor',
        strokeWidth: p.sw,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
      return React.createElement('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        style: { color: ICON_COLORS[kind] || ICON_COLORS.file },
      }, children)
    }

    // ------------------------------------------------------------------
    // 样式
    // ------------------------------------------------------------------
    const cssText = [
      // 输入框内 @路径 pill 由 PillOverlay 覆盖层渲染（样式内联，见 PillOverlay），
      // 不再依赖 shell 的 U+FFFC chip 机制（固定格无法容纳可变宽标签）。
      // @ 选择菜单：单行布局，但弹窗宽度与输入框一致（shell 默认最宽 537px 会
      // 截断长文件名），文件名完整显示不截断、优先占位，目录用剩余空间。
      '[role="listbox"] { max-width: none !important; width: 100%; }',
      '[role="listbox"] [role="option"] > span:nth-child(2) { flex: 0 1 auto !important; max-width: 100% !important; white-space: nowrap; overflow: visible !important; text-overflow: clip; }',
      '[role="listbox"] [role="option"] > span:nth-child(3) { flex: 1 1 auto !important; min-width: 0 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.dsh_atFile_section { display: flex; flex-direction: column; gap: 12px; min-width: 0; }',
      '.dsh_atFile_title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 18px; line-height: 26px; font-weight: 600; }',
      '.dsh_atFile_subtitle { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }',
      '.dsh_atFile_card { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; }',
      '.dsh_atFile_checkbox { flex: none; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }',
      '.dsh_atFile_cardText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
      '.dsh_atFile_cardTitle { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }',
      '.dsh_atFile_cardDesc { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }',
      '.dsh_atFile_filter { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding-top: 4px; }',
      '.dsh_atFile_filterHeading { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 12px; min-width: 0; }',
      '.dsh_atFile_filterHeadingText { display: flex; flex: 1 1 280px; flex-direction: column; gap: 2px; min-width: 0; }',
      '.dsh_atFile_filterTitle { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 600; }',
      '.dsh_atFile_filterDesc { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }',
      '.dsh_atFile_secondaryButton { flex: none; min-height: 30px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 15px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }',
      '.dsh_atFile_secondaryButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dsh_atFile_secondaryButton:disabled, .dsh_atFile_filterRemove:disabled, .dsh_atFile_addButton:disabled { opacity: 0.45; cursor: default; }',
      '.dsh_atFile_filterList { min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }',
      '.dsh_atFile_filterRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; min-height: 40px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.dsh_atFile_filterRow:last-child { border-bottom: 0; }',
      '.dsh_atFile_ruleMain { display: flex; align-items: center; flex-wrap: wrap; flex: 1 1 auto; gap: 8px; min-width: 0; }',
      '.dsh_atFile_ruleBadge { flex: none; padding: 2px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }',
      '.dsh_atFile_filterName { min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }',
      '.dsh_atFile_filterRemove { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border: 0; border-radius: 14px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }',
      '.dsh_atFile_filterRemove:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }',
      '.dsh_atFile_filterRemove svg, .dsh_atFile_addButton svg { width: 15px; height: 15px; }',
      '.dsh_atFile_filterEmpty { padding: 16px 12px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; text-align: center; }',
      '.dsh_atFile_filterAddRow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }',
      '.dsh_atFile_ruleMode { display: inline-flex; align-self: flex-start; gap: 2px; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }',
      '.dsh_atFile_ruleModeButton { min-width: 72px; height: 28px; padding: 0 10px; border: 0; border-radius: 5px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }',
      '.dsh_atFile_ruleModeButton[aria-pressed="true"] { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); font-weight: 600; }',
      '.dsh_atFile_caseToggle { display: inline-flex; align-items: center; align-self: flex-start; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; cursor: pointer; }',
      '.dsh_atFile_caseToggle input { width: 15px; height: 15px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }',
      '.dsh_atFile_filterAddRow .dsh_atFile_filterInput { flex: 1 1 240px; width: auto; }',
      '.dsh_atFile_filterInput[aria-invalid="true"] { border-color: var(--dsw-alias-state-error-primary); }',
      '.dsh_atFile_filterInput { box-sizing: border-box; width: 100%; min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }',
      '.dsh_atFile_filterInput:focus { border-color: var(--dsw-alias-brand-primary); }',
      '.dsh_atFile_addButton { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; height: 36px; padding: 0 14px; border: 0; border-radius: 18px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }',
      '.dsh_atFile_filterError { color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; }',
      '@media (max-width: 560px) { .dsh_atFile_addButton { flex: 1 1 auto; } }',
    ].join('\n')

    function adoptStyles() {
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = cssText
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------------
    // locale
    // ------------------------------------------------------------------
    const zh = {
      'nav': '文件提及',
      'settings.title': '工作区文件提及',
      'settings.subtitle': '在输入框输入 @ 搜索并引用工作区路径；插件只传递路径，不读取文件内容。',
      'settings.enabled': '启用 @ 文件提及',
      'settings.enabledDesc': '关闭后隐藏 @ 路径选择器与引用条，并停止向模型标记所选路径。',
      'settings.ignoreFiles': '文件过滤',
      'settings.ignoreFilesDesc': '规则只匹配文件名，不匹配目录路径。可以用完整名称或正则表达式，并单独设置大小写。',
      'settings.restoreDefaults': '恢复默认',
      'settings.emptyGlobal': '当前没有全局过滤规则。',
      'settings.namePlaceholder': '例如 desktop.ini',
      'settings.regexPlaceholder': '例如 \\.map$ 或 ^test-',
      'settings.invalidName': '文件名不能包含路径分隔符。',
      'settings.invalidRegex': '正则表达式无效。',
      'settings.duplicateName': '这个文件名已经在当前列表中。',
      'settings.add': '添加',
      'settings.saving': '正在保存',
      'settings.remove': '移除 {name}',
      'settings.kind.exact': 'Exact',
      'settings.kind.regex': 'Regex',
      'settings.caseSensitive': '区分大小写',
      'settings.caseInsensitive': '忽略大小写',
      'settings.caseSensitiveOption': '区分大小写',
    }
    const en = {
      'nav': 'File mentions',
      'settings.title': 'Workspace file mentions',
      'settings.subtitle': 'Type @ to search and reference a workspace path; the plugin passes the path without reading file content.',
      'settings.enabled': 'Enable @ file mentions',
      'settings.enabledDesc': 'Turning this off hides the @ path picker and reference dock, and stops marking selected paths for the model.',
      'settings.ignoreFiles': 'File filters',
      'settings.ignoreFilesDesc': 'Rules match basenames only, never directory paths. Use exact names or regular expressions with independent case settings.',
      'settings.restoreDefaults': 'Restore defaults',
      'settings.emptyGlobal': 'There are no global file filters.',
      'settings.namePlaceholder': 'For example, desktop.ini',
      'settings.regexPlaceholder': 'For example, \\.map$ or ^test-',
      'settings.invalidName': 'A file name cannot contain path separators.',
      'settings.invalidRegex': 'The regular expression is invalid.',
      'settings.duplicateName': 'This file name is already in the current list.',
      'settings.add': 'Add',
      'settings.saving': 'Saving',
      'settings.remove': 'Remove {name}',
      'settings.kind.exact': 'Exact',
      'settings.kind.regex': 'Regex',
      'settings.caseSensitive': 'Case-sensitive',
      'settings.caseInsensitive': 'Case-insensitive',
      'settings.caseSensitiveOption': 'Case-sensitive',
    }
    function fmt(template, params) {
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (whole, key) => (params[key] === undefined ? whole : params[key]))
    }

    // ------------------------------------------------------------------
    // 迷你快照 store（createSnapshotStore 的本地等价物）
    // ------------------------------------------------------------------
    function createSnapshotStore(init) {
      let state = { value: init.value }
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        set: (next) => {
          state = { value: next.value }
          for (const listener of [...listeners]) {
            try { listener() } catch (error) { console.error('[dsh-at-file] snapshot listener failed:', error) }
          }
        },
      }
    }

    // ------------------------------------------------------------------
    // @ 触发源
    // ------------------------------------------------------------------
    function candidateRows(files) {
      // 主标题 = 文件名（basename），副标题 = 目录路径：菜单用上下两行渲染，
      // 长路径不再拼进主标题、也不再被 shell 的 40% 限宽截断（同名文件靠
      // 副标题目录区分；选择按 value=完整相对路径，与显示无关）。
      return files.map((file) => {
        const basename = basenameOf(file.relative)
        const directory = dirnameOf(file.relative)
        const row = {
          name: basename,
          value: file.relative,
          atFileKind: file.kind,
          icon: fileIcon(file),
        }
        if (directory !== '') row.description = directory
        return row
      })
    }

    /**
     * 构建 @ 触发源：每个插件 fiber 一个；按会话的索引缓存在闭包里随 fiber 死亡。
     * @param deps - { search(sessionId, signal), pickerState, now? }
     * pickerState 是「当前查询与其候选」的共享快照：candidates 每次 settle 后写入，
     * PillOverlay 的 Enter/Tab 导航决策按 DOM 活动项反查候选的 kind/value 时读取。
     */
    function createAtFileSource(deps) {
      const now = deps.now || (() => Date.now())
      const fetches = new Map()
      // 最近活跃的会话（来自 warm/candidates）：pill 覆盖层用它判断路径是否在索引内。
      let activeSessionId = undefined

      const fetchIndex = (sessionId, signal) => {
        activeSessionId = sessionId
        const existing = fetches.get(sessionId)
        const fresh = existing !== undefined && now() - existing.at < INDEX_TTL_MS
        if (fresh) {
          if (existing.settled !== undefined) return Promise.resolve(existing.settled)
          return existing.promise
        }
        if (existing !== undefined) {
          fetches.delete(sessionId)
          existing.abort.abort()
        }
        const abort = new AbortController()
        const promise = deps.search(sessionId, abort.signal)
        const entry = { promise, abort, at: now() }
        fetches.set(sessionId, entry)
        promise.then(
          (files) => {
            entry.settled = files
          },
          () => {
            if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
          },
        )
        if (signal !== undefined) {
          return promise.then((files) => (signal.aborted ? [] : files))
        }
        return promise
      }

      const findEntry = (sessionId, relative) => {
        const settled = fetches.get(sessionId) ? fetches.get(sessionId).settled : undefined
        return settled === undefined ? undefined : settled.find((file) => file.relative === relative)
      }

      // 覆盖层滤镜：只有索引里真实存在的相对路径才渲染 pill（避免随手打的
      // @word 被误包装成文件引用）。
      const isKnownPath = (relative) => {
        if (activeSessionId === undefined) return false
        const settled = fetches.get(activeSessionId) ? fetches.get(activeSessionId).settled : undefined
        return settled !== undefined && settled.some((file) => file.relative === relative)
      }

      const invalidateAll = () => {
        for (const [key, entry] of [...fetches]) {
          fetches.delete(key)
          entry.abort.abort()
        }
        activeSessionId = undefined
      }

      const source = {
        trigger: '@',
        name: SOURCE_NAME,
        async candidates(session, req) {
          const files = await fetchIndex(session.sessionId, req.signal)
          if (req.signal.aborted) return []
          const rows = candidateRows(navigatorRows(files, req.query, MAX_CANDIDATES))
          // 记录本次查询与其候选：菜单 DOM 只渲染 name/description，不带候选的
          // value/kind，Enter/Tab 导航决策靠这份快照反查。
          deps.pickerState.query = req.query
          deps.pickerState.rows = rows
          return rows
        },
        warm(session) {
          fetchIndex(session.sessionId).catch(() => {})
        },
        onPick(pick) {
          const file = pick.candidate.value === undefined
            ? undefined
            : findEntry(pick.session.sessionId, pick.candidate.value)
          if (file === undefined) return undefined
          // 真实文本插入：草稿里是完整 @相对路径 + 尾空格（提交即原文发送，
          // host 校验存在性并注入 <workspace-reference>）。chip 外观由
          // PillOverlay 覆盖层按 mirror 测出的 token 位置渲染——自然占宽、
          // 可变宽、不截断、不重叠、无空隙、高度与正文一致。
          return { text: `@${file.relative} ` }
        },
      }

      return { source, invalidateAll, isKnownPath }
    }

    // ------------------------------------------------------------------
    // 输入框内 @路径 pill 覆盖层
    // ------------------------------------------------------------------
    // shell 的 chip 机制是固定 U+FFFC 单元格（~4em），标签无法容纳可变宽
    // 内容：长名要么被裁切、要么溢出重叠、要么留下空隙。因此改用「真实文本 +
    // 测量覆盖」：onPick 插入完整 @相对路径（自然占宽），本组件读取 shell 的
    // mirror（.uV2eYG_mirror，与输入同布局），用 Range 测出每个 @路径 token
    // 的像素矩形，在 overlay anchor 上渲染贴合 token 的 pill。
    //
    // 效果：pill 宽度 = token 真实宽度（可变），高度 = 行高（与正文一致），
    // 不截断、不重叠、无空隙、无空背景。pill 是纯装饰层（pointer-events:none），
    // 文字选中/退格删除都作用于底下的真实文本。
    function PillOverlay(props) {
      const { isKnownPath, pickerState } = props
      const rootRef = React.useRef(null)
      const [version, setVersion] = React.useState(0)

      React.useEffect(() => {
        let mirror = null
        let scroller = null
        let obs = null
        const refresh = () => setVersion((v) => v + 1)
        const locate = () => {
          const root = rootRef.current
          const card = root === null ? null : root.closest('.uV2eYG_card')
          mirror = card === null ? null : card.querySelector('.uV2eYG_mirror')
          scroller = mirror === null ? null : mirror.closest('.uV2eYG_scroll')
        }
        locate()
        if (mirror !== null) {
          try {
            obs = new MutationObserver(refresh)
            obs.observe(mirror, { childList: true, characterData: true, subtree: true })
          } catch (error) {
            obs = null
          }
        }
        if (scroller !== null) scroller.addEventListener('scroll', refresh, { passive: true })
        window.addEventListener('resize', refresh)
        // 兜底周期：覆盖索引 settle、布局变化等 MutationObserver 漏掉的情况。
        const timer = window.setInterval(refresh, 1200)

        // ---- @ 菜单 Enter/Tab 目录导航（document capture，先于 shell 输入机）----
        // 菜单只渲染 name/description，不带候选的 value/kind：按 DOM 活动项
        // （aria-selected）的显示文本反查当前候选行。同一目录内 basename 唯一，
        // 所以 name + 目录路径即可唯一定位直接子项候选。
        const activeOptionOf = (listbox) =>
          listbox.querySelector('[role="option"][aria-selected="true"]')

        const matchRow = (option, rows) => {
          const spans = [...option.querySelectorAll(':scope > span')]
            .map((span) => (span.textContent || '').trim())
          const name = spans.length >= 2 ? spans[1] : ''
          const directory = spans.length >= 3 ? spans[2] : ''
          return rows.find((row) =>
            basenameOf(row.value) === name && dirnameOf(row.value) === directory)
        }

        // 与 shell detectTrigger 对 '@' 的扫描一致：从 caret 向左，先遇空白则无
        // token；只认词边界后的 '@'（user@host 里 @ 前面是词字符，不算 trigger）。
        const atTriggerSpan = (draft, caret) => {
          for (let i = caret - 1; i >= 0; i--) {
            const ch = draft.charAt(i)
            if (/\s/.test(ch)) return null
            if (ch !== '@') continue
            if (i > 0 && /[\p{L}\p{N}_]/u.test(draft.charAt(i - 1))) continue
            return { start: i, end: caret }
          }
          return null
        }

        // 用新文本替换当前 @ token 的 span，走原生 setter + input 事件触发输入机
        //（与整体删除同一机制）：输入机在 caret 处重新 detectTrigger——目录
        //（尾 `/`）让 @ 菜单就地刷新为下级内容，文件（尾空格）关闭菜单。
        const spliceAtToken = (text) => {
          const root = rootRef.current
          const card = root === null ? null : root.closest('.uV2eYG_card')
          if (card === null) return false
          const ta = card.querySelector('textarea')
          if (ta === null || document.activeElement !== ta) return false
          const draft = ta.value || ''
          const caret = ta.selectionStart
          const span = atTriggerSpan(draft, caret)
          if (span === null) return false
          const next = draft.slice(0, span.start) + text + draft.slice(span.end)
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          setter.call(ta, next)
          const at = span.start + text.length
          ta.setSelectionRange(at, at)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        }

        // Enter/Tab 统一决策：返回 true 表示已处理（preventDefault + stopPropagation）。
        // Enter：目录 → 导航进入其内容（`@目录/`），文件 → 放行给 shell 的正常
        // pick 流程（onPick 插入引用）。Tab：无论文件还是目录都直接确定选择
        //（插入 `@路径 `，目录不进入下级）。
        const enterOrTabAccepted = (e) => {
          const rows = pickerState.rows
          if (rows.length === 0) return false
          const listbox = document.querySelector('[role="listbox"]')
          if (listbox === null) return false
          const option = activeOptionOf(listbox)
          if (option === null) return false
          const row = matchRow(option, rows)
          if (row === undefined) return false
          if (e.key === 'Enter') {
            if (row.atFileKind !== 'dir') return false
            if (!spliceAtToken(`@${row.value}/`)) return false
            e.preventDefault()
            e.stopPropagation()
            return true
          }
          if (!spliceAtToken(`@${row.value} `)) return false
          e.preventDefault()
          e.stopPropagation()
          return true
        }

        // 整体删除：caret 紧贴 @路径 token 时按 Backspace/Delete 一次删掉整个
        // token（连同一个紧邻的分隔空格）。挂 document capture 阶段，先于
        // React 合成事件与 shell 输入机，保证不会被当逐字符删除处理。
        const onKeyDown = (e) => {
          // @ 菜单开着时 Enter/Tab 的目录导航/接受选择优先于删除与 shell 流程。
          if ((e.key === 'Enter' || e.key === 'Tab')
            && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
            && enterOrTabAccepted(e)) {
            return
          }
          if (e.key !== 'Backspace' && e.key !== 'Delete') return
          if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
          const root = rootRef.current
          const card = root === null ? null : root.closest('.uV2eYG_card')
          if (card === null) return
          const ta = card.querySelector('textarea')
          if (ta === null || document.activeElement !== ta) return
          if (ta.selectionStart !== ta.selectionEnd) return
          // @ 菜单还开着（正在输入过滤词、尚未回车确认选择）：放行，让
          // 用户逐字符删减过滤词；确认选择、菜单关闭后才对引用整体删除。
          if (document.querySelector('[role="listbox"]') !== null) return
          const pos = ta.selectionStart
          const draft = ta.value || ''
          const re = /@[\w./-]+/g
          let match
          while ((match = re.exec(draft)) !== null) {
            const start = match.index
            const end = match.index + match[0].length
            let from = start
            let to = end
            if (e.key === 'Backspace') {
              // caret 在路径内、右缘、或紧跟其后的分隔空格右侧，都一次整体删除
              //（选完路径后 caret 正停在尾空格后面，必须一次退格就删掉）。
              // 但 caret 恰好落在下一个 @路径 起点时（两路径之间）不拦截，让
              // 空格照常逐字符删。拦截后 shell 不再逐字符删、不弹 @ 菜单。
              if (!(pos > start && (pos <= end || (pos === end + 1 && draft[end] === ' ' && draft[pos] !== '@')))) continue
              if (draft[end] === ' ') to += 1
            } else {
              if (!(pos < end && (pos >= start || (pos === start - 1 && draft[start - 1] === ' ')))) continue
              if (start > 0 && draft[start - 1] === ' ') from -= 1
              else if (draft[end] === ' ') to += 1
            }
            e.preventDefault()
            e.stopPropagation()
            const next = draft.slice(0, from) + draft.slice(to)
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
            setter.call(ta, next)
            ta.setSelectionRange(from, from)
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            return
          }
        }
        document.addEventListener('keydown', onKeyDown, { capture: true })

        // 挂载后（rootRef 已就位）先测一次，保证首帧就有 pill。
        refresh()
        return () => {
          if (obs !== null) obs.disconnect()
          if (scroller !== null) scroller.removeEventListener('scroll', refresh)
          window.removeEventListener('resize', refresh)
          window.clearInterval(timer)
          document.removeEventListener('keydown', onKeyDown, { capture: true })
        }
      }, [])

      const pills = React.useMemo(() => {
        const root = rootRef.current
        if (root === null) return []
        const card = root.closest('.uV2eYG_card')
        const anchor = root.closest('.uV2eYG_overlayAnchor')
        if (card === null || anchor === null) return []
        const mirror = card.querySelector('.uV2eYG_mirror')
        if (mirror === null) return []
        const textNode = [...mirror.childNodes].find((node) => node.nodeType === 3)
        if (textNode === undefined) return []
        const draft = textNode.textContent || ''
        const anchorRect = anchor.getBoundingClientRect()
        const raw = []
        const re = /@[\w./-]+/g
        let match
        while ((match = re.exec(draft)) !== null) {
          const token = match[0]
          const relative = token.slice(1)
          if (isKnownPath !== undefined && !isKnownPath(relative)) continue
          const range = document.createRange()
          try {
            range.setStart(textNode, match.index)
            range.setEnd(textNode, match.index + token.length)
          } catch (error) {
            continue
          }
          const rects = range.getClientRects()
          if (rects.length === 0) continue
          raw.push({ token, start: match.index, end: match.index + token.length, rect: rects[0] })
        }
        // 背景边距：左右默认各 5px、至少 2px；上下按行盒高度给 2~3px，pill
        // 不超出所在行的行盒（不碰相邻行文字）。紧邻另一 token 或紧贴非空白
        // 字符时左右收缩，保证背景不盖住相邻内容（不重叠）、不侵入正文。
        const PAD = 5
        const MIN_PAD = 2 // 文字到背景边缘的最小边距
        const MIN_GAP = 2 // 相邻 pill 背景之间优先保留的可见缝隙
        const lineH = parseFloat(window.getComputedStyle(mirror).lineHeight) || 24
        const out = raw.map((item, i) => {
          const charBefore = item.start === 0 ? ' ' : draft[item.start - 1]
          const charAfter = item.end >= draft.length ? ' ' : draft[item.end]
          const gapLeft = i === 0 ? Infinity : item.rect.left - raw[i - 1].rect.right
          const gapRight = i === raw.length - 1 ? Infinity : raw[i + 1].rect.left - item.rect.right
          const padFor = (gap, glued) => {
            if (glued) return 0
            if (gap === Infinity) return PAD
            return Math.min(PAD, Math.max(MIN_PAD, (gap - MIN_GAP) / 2))
          }
          const padLeft = padFor(gapLeft, !/\s/.test(charBefore))
          const padRight = padFor(gapRight, !/\s/.test(charAfter))
          const vPad = Math.max(1, Math.min(3, (lineH - item.rect.height) / 2 - 1))
          return {
            key: `${item.start}-${item.token}`,
            text: item.token,
            left: item.rect.left - padLeft - anchorRect.left,
            top: item.rect.top - vPad - anchorRect.top,
            width: item.rect.width + padLeft + padRight,
            height: item.rect.height + vPad * 2,
          }
        })
        return out
      }, [version, isKnownPath])

      // wrapper 始终渲染（零尺寸、纯定位容器），保证 rootRef 常驻；
      // 有 pill 时其内再放绝对定位的 pill。anchor 本身是 0 高，视觉无感。
      return React.createElement(
        'div',
        { ref: rootRef, style: { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 } },
        pills.map((pill) =>
          React.createElement('div', {
            key: `atfile-pill-${pill.key}`,
            style: {
              position: 'absolute',
              left: pill.left,
              top: pill.top,
              width: pill.width,
              height: pill.height,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(97, 135, 216, 0.22)',
              borderRadius: 6,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              color: 'var(--dsw-alias-label-primary)',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
            },
            children: pill.text,
          }),
        ),
      )
    }

    // ------------------------------------------------------------------
    // 设置 section
    // ------------------------------------------------------------------
    function AtFileSection(props) {
      const { t, useScope, setEnabled, setIgnoreFiles } = props
      const value = useScope((snapshot) => snapshot.value)
      const [draftMode, setDraftMode] = React.useState('exact')
      const [draftPattern, setDraftPattern] = React.useState('')
      const [draftCase, setDraftCase] = React.useState(false)
      const [error, setError] = React.useState('')
      const [saving, setSaving] = React.useState(false)

      if (value === undefined || value === null) return null
      const rules = Array.isArray(value.ignoreFiles) ? value.ignoreFiles : []

      const addRule = async () => {
        const trimmed = draftPattern.trim()
        if (trimmed === '') return
        if (draftMode === 'exact' && /[\\/]/.test(trimmed)) { setError(t('settings.invalidName')); return }
        if (draftMode === 'regex') {
          try { new RegExp(trimmed, draftCase ? '' : 'i') } catch (e) { setError(t('settings.invalidRegex')); return }
        }
        const existing = rules.some((rule) => (typeof rule === 'string' ? rule : rule.pattern) === trimmed)
        if (existing) { setError(t('settings.duplicateName')); return }
        setError('')
        const next = [...rules]
        if (draftMode === 'exact' && !draftCase) next.push(trimmed)
        else next.push({ kind: draftMode, pattern: trimmed, caseSensitive: draftCase })
        setSaving(true)
        try {
          await setIgnoreFiles(next)
          setDraftPattern('')
        } finally {
          setSaving(false)
        }
      }

      const removeRule = async (index) => {
        const next = rules.filter((rule, i) => i !== index)
        setSaving(true)
        try { await setIgnoreFiles(next) } finally { setSaving(false) }
      }

      const restoreDefaults = async () => {
        setSaving(true)
        try { await setIgnoreFiles([...DEFAULT_IGNORE_FILES]) } finally { setSaving(false) }
      }

      return React.createElement('div', { className: 'dsh_atFile_section' },
        React.createElement('h2', { className: 'dsh_atFile_title' }, t('settings.title')),
        React.createElement('p', { className: 'dsh_atFile_subtitle' }, t('settings.subtitle')),
        React.createElement('label', { className: 'dsh_atFile_card' },
          React.createElement('input', {
            type: 'checkbox',
            className: 'dsh_atFile_checkbox',
            checked: value.enabled !== false,
            onChange: (e) => { void setEnabled(e.target.checked) },
          }),
          React.createElement('span', { className: 'dsh_atFile_cardText' },
            React.createElement('span', { className: 'dsh_atFile_cardTitle' }, t('settings.enabled')),
            React.createElement('span', { className: 'dsh_atFile_cardDesc' }, t('settings.enabledDesc')),
          ),
        ),
        React.createElement('div', { className: 'dsh_atFile_filter' },
          React.createElement('div', { className: 'dsh_atFile_filterHeading' },
            React.createElement('div', { className: 'dsh_atFile_filterHeadingText' },
              React.createElement('span', { className: 'dsh_atFile_filterTitle' }, t('settings.ignoreFiles')),
              React.createElement('span', { className: 'dsh_atFile_filterDesc' }, t('settings.ignoreFilesDesc')),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'dsh_atFile_secondaryButton',
              onClick: () => { void restoreDefaults() },
              disabled: saving,
            }, t('settings.restoreDefaults')),
          ),
          React.createElement('div', { className: 'dsh_atFile_filterList' },
            rules.length === 0
              ? React.createElement('div', { className: 'dsh_atFile_filterEmpty' }, t('settings.emptyGlobal'))
              : rules.map((rule, i) => {
                const pattern = typeof rule === 'string' ? rule : rule.pattern
                const kind = typeof rule === 'string' ? 'exact' : rule.kind
                const cs = typeof rule === 'string' ? false : rule.caseSensitive
                return React.createElement('div', { key: `${kind}:${pattern}:${cs ? 1 : 0}:${i}`, className: 'dsh_atFile_filterRow' },
                  React.createElement('div', { className: 'dsh_atFile_ruleMain' },
                    React.createElement('span', { className: 'dsh_atFile_ruleBadge' }, kind === 'regex' ? t('settings.kind.regex') : t('settings.kind.exact')),
                    React.createElement('span', { className: 'dsh_atFile_filterName' }, pattern),
                    React.createElement('span', { className: 'dsh_atFile_ruleBadge' }, cs ? t('settings.caseSensitive') : t('settings.caseInsensitive')),
                  ),
                  React.createElement('button', {
                    type: 'button',
                    className: 'dsh_atFile_filterRemove',
                    'aria-label': t('settings.remove', { name: pattern }),
                    onClick: () => { void removeRule(i) },
                    disabled: saving,
                  },
                    React.createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
                      React.createElement('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })),
                  ),
                )
              }),
          ),
          React.createElement('div', { className: 'dsh_atFile_filterAddRow' },
            React.createElement('div', { className: 'dsh_atFile_ruleMode' },
              React.createElement('button', {
                type: 'button',
                className: 'dsh_atFile_ruleModeButton',
                'aria-pressed': draftMode === 'exact',
                onClick: () => { setDraftMode('exact'); setError('') },
              }, t('settings.kind.exact')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh_atFile_ruleModeButton',
                'aria-pressed': draftMode === 'regex',
                onClick: () => { setDraftMode('regex'); setError('') },
              }, t('settings.kind.regex')),
            ),
            React.createElement('input', {
              className: 'dsh_atFile_filterInput',
              placeholder: draftMode === 'exact' ? t('settings.namePlaceholder') : t('settings.regexPlaceholder'),
              value: draftPattern,
              onChange: (e) => { setDraftPattern(e.target.value); if (error !== '') setError('') },
              onKeyDown: (e) => { if (e.key === 'Enter') void addRule() },
            }),
            React.createElement('label', { className: 'dsh_atFile_caseToggle' },
              React.createElement('input', {
                type: 'checkbox',
                checked: draftCase,
                onChange: (e) => { setDraftCase(e.target.checked) },
              }),
              t('settings.caseSensitiveOption'),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'dsh_atFile_addButton',
              onClick: () => { void addRule() },
              disabled: saving || draftPattern.trim() === '',
            }, saving ? t('settings.saving') : t('settings.add')),
          ),
          error !== '' ? React.createElement('div', { className: 'dsh_atFile_filterError' }, error) : null,
        ),
      )
    }

    // ------------------------------------------------------------------
    // 装配
    // ------------------------------------------------------------------
    function resolveNamespace(ctx) {
      // 首选公开 API：ctx.get('remote.atFile') 直接返回挂载的命名空间服务
      //（RemoteNamespaceService 以 remote.<ns> 为 key 注册，无 inject 要求）。
      const direct = ctx.get('remote.atFile')
      if (direct !== undefined) return direct
      // 其次走 remote 服务的 traceable 属性读取（associate 查找）。
      if (ctx.remote !== undefined && ctx.remote !== null) return ctx.remote.atFile
      // 兜底：ReflectService.get 免 inject 读 store（有守卫，缺失时跳过）。
      if (ctx.reflect !== undefined && ctx.reflect !== null && typeof ctx.reflect.get === 'function') {
        const found = ctx.reflect.get('remote.atFile')
        if (found !== undefined) return found
      }
      return undefined
    }

    return {
      inject: ['inputTriggers', 'sessions', 'remote', 'slots', 'locale'],
      apply(ctx) {
        adoptStyles()
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-at-file: dictionaries')

        const scope = createSnapshotStore({ value: defaultSettings() })
        let atFile
        let settingsGeneration = 0
        let settingsTail = Promise.resolve()

        const reportSettingsError = (operation, error) => {
          if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
            console.error(`[dsh-at-file] settings ${operation} failed: ${String(error.code)}: ${String(error.message)}`)
            return
          }
          console.error(`[dsh-at-file] settings ${operation} failed:`, error)
        }

        const loadSettings = async () => {
          const remote = atFile
          if (remote === undefined) return
          const generation = ++settingsGeneration
          try {
            const result = await remote.getSettings()
            if (atFile !== remote || generation !== settingsGeneration) return
            if (!result.ok) {
              reportSettingsError('read', result.error)
              return
            }
            scope.set({ value: result.value })
          } catch (error) {
            if (atFile === remote && generation === settingsGeneration) reportSettingsError('read', error)
          }
        }

        const updateSettings = (update) => {
          const operation = settingsTail.then(async () => {
            const remote = atFile
            if (remote === undefined) {
              reportSettingsError('update', new Error('the atFile Remote is not mounted'))
              return
            }
            const generation = ++settingsGeneration
            try {
              const result = await remote.updateSettings(update)
              if (atFile !== remote || generation !== settingsGeneration) return
              if (!result.ok) {
                reportSettingsError('update', result.error)
                return
              }
              scope.set({ value: result.value })
            } catch (error) {
              if (atFile === remote && generation === settingsGeneration) reportSettingsError('update', error)
            }
          })
          settingsTail = operation.catch(() => {})
          return operation
        }

        // 挂载 atFile Remote 命名空间并读取设置。
        ctx.effect(async () => {
          const dispose = await ctx.remote.$mount(AT_FILE_REMOTE)
          atFile = resolveNamespace(ctx)
          if (atFile === undefined) {
            throw new Error('dsh-at-file: the atFile Remote namespace did not mount')
          }
          await loadSettings()
          return () => {
            settingsGeneration += 1
            atFile = undefined
            void dispose()
          }
        }, 'dsh-at-file: remote')

        const inputTriggers = ctx.get('inputTriggers')
        const sessions = ctx.get('sessions')
        const t = ctx.locale.bind(NS)
        if (inputTriggers === undefined || sessions === undefined) return

        const search = async (sessionId, signal) => {
          if (atFile === undefined) throw new Error('dsh-at-file: the atFile Remote is not mounted')
          const result = await atFile.search(sessionId, signal)
          if (!result.ok) throw new Error(`search failed: ${result.error.code}: ${result.error.message}`)
          return result.value
        }

        // @ 菜单当前查询与其候选的共享快照：candidates() 每次 settle 后写入，
        // PillOverlay 的 Enter/Tab 导航决策按 DOM 活动项反查 kind/value 时读取。
        const pickerState = { query: '', rows: [] }
        const { source, invalidateAll, isKnownPath } = createAtFileSource({ search, pickerState })
        // 重连可能重建了 host：缓存索引随它一起失效。
        ctx.on('connection/reset', () => {
          invalidateAll()
          void loadSettings()
        })

        // 设置开关实时门控触发源。
        let sourceRegistered = false
        let sourceDispose = () => {}
        const syncSource = () => {
          const enabled = scope.getSnapshot().value.enabled !== false
          if (enabled && !sourceRegistered) {
            sourceDispose = inputTriggers.registerSource(source)
            sourceRegistered = true
          } else if (!enabled && sourceRegistered) {
            sourceDispose()
            sourceDispose = () => {}
            sourceRegistered = false
          }
        }
        ctx.effect(() => {
          syncSource()
          const off = scope.subscribe(syncSource)
          return () => {
            off()
            sourceDispose()
          }
        }, 'dsh-at-file: source (settings-gated)')

        // 输入框内 @路径 pill 覆盖层（conversation.input.overlay 的附加条目；
        // 与 MenuView 并存，菜单打开时在上层）。
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'at-file-pills',
          order: 60,
          label: () => 'AtFilePills',
          inject: () => ({ isKnownPath, pickerState }),
        }, PillOverlay))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'at-file',
          order: 55,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({
            hooks: { scope },
            setEnabled: async (enabled) => { await updateSettings({ field: 'enabled', value: enabled }) },
            setIgnoreFiles: async (ignoreFiles) => {
              await updateSettings({ field: 'ignoreFiles', value: [...ignoreFiles] })
            },
          }),
        }, AtFileSection))
      },
    }
  },
})
