// dsh-sidebar-helper — client 半体（免构建 bundle）。
// 浏览器侧通过 __ModuleLoader__.load 注册；id 必须等于包名（patch 行的 name）。
// 本文件被 host 扫描后经 /plugins/@freespace8/dsh-sidebar-helper/client.js 提供给浏览器。
//
// 功能：左侧工作区浏览器行的右键菜单——但不是自绘菜单，而是**复用内置「⋯」
// 菜单**：
//   - 会话（对话）行右键：直接触发该行自带的三点菜单（重命名 / 分叉 / 归档），
//     与左键点三个点弹出的菜单一模一样，本插件只做触发，不维护菜单内容；
//   - 工作区（项目）行：**只要它的三点菜单打开**（左键点「⋯」、右键点行、
//     键盘激活都一样），就在菜单里注入一个「复制路径」项（紧邻重命名），
//     把工作区目录路径写进剪贴板。
//
// 为什么可以「只触发」：内置行菜单的锚点是行内的省略号按钮
// （[role=treeitem] 里的第一个 <button>，会话行只有一个，工作区行是第一个）。
// 程序化 button.click() 会走 React 的 onClick（setMenuOpen(!v)），弹出的就是
// 同一份菜单——位置、内容、键盘行为全部与手点一致。
//
// 复制路径项为何要「注入」：内置菜单的 items 是硬编码的，第三方改不了 props，
// 所以用一个全局 MutationObserver 监听 document.body 里新出现的
// [role=menu] 节点（= 某行菜单刚打开），再按「锚点位置」识别它属于哪个工作区
// 行，往其 viewport 里插一个原生 <button role=menuitem>，用 MutationObserver
// 把它钉在首位（React 重渲染会挪动/移除未知 DOM 节点，观察器在每个变更后把
// 它重新插回第一项），点击后复制路径、短暂显示「已复制」、再派发 Escape 让
// 内置菜单自行关闭。
//
// 约束：本文件不 require 任何模块（不依赖 React / primitives），全部用原生
// DOM。纯解析函数（resolveWorkspaceRow 等）放模块顶层，Node 下经
// module.exports 导出供产物门单测（浏览器下走 __ModuleLoader__.load）。
//
// 行身份解析：浏览器行没有稳定 data-* 属性、class 是哈希过的，所以不依赖
// class，只用稳定语义信号：
//   - 项目行 = [role=treeitem][aria-expanded]，其文本即工作区标题；
//   - 会话行 = [role=treeitem][aria-selected]。
// 再用 ctx.workspaces 快照按标题反查工作区（同标题按 DOM 顺序消歧）。

// ------------------------------------------------------------------
// 常量（模块顶层，浏览器 / Node 两用）
// ------------------------------------------------------------------
const NS = 'sidebar-helper'
const SETTINGS_ROUTE = '/plugins/dsh-sidebar-helper/settings'
// 复制成功后的菜单停留时间（毫秒），随后派发 Escape 收起内置菜单。
const COPIED_KEEP_MS = 900
// 注入项标记（选择器也用于钉位样式与单测定位）。
const INJECT_MARK = 'data-sidebar-helper-copy'
// 注入项 hover 样式表（注入的按钮是原生节点，靠这条规则复刻内置 item hover）。
const STYLE_ID = 'dsh-sidebar-helper-style'

// 内置菜单项的视觉规格（Menu.module.css .item / .itemIcon / .itemLabel），
// 注入项按同一套 token 复刻，肉眼与原生项一致。
const ITEM_CSS = [
  'display:flex', 'align-items:center', 'gap:8px', 'width:100%',
  'min-height:40px', 'padding:8px 10px', 'border:none', 'border-radius:10px',
  'background:transparent', 'cursor:pointer', 'font-size:14px', 'line-height:22px',
  'color:var(--dsw-alias-label-primary)', 'text-align:left',
].join(';')
const ICON_CSS = [
  'display:inline-flex', 'flex:none', 'width:16px', 'height:16px',
  'align-items:center', 'justify-content:center',
  'color:var(--dsw-alias-label-tertiary)',
].join(';')
const LABEL_CSS = [
  'flex:1', 'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis',
  'white-space:nowrap',
].join(';')

// IconCopyOutline16 的 SVG（fill=currentColor），注入项与内置菜单图标同源。
const COPY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z" fill="currentColor"/></svg>'

// ------------------------------------------------------------------
// locale
// ------------------------------------------------------------------
const zh = {
  'menu.copyPath': '复制路径',
  'menu.copied': '已复制',
}
const en = {
  'menu.copyPath': 'Copy Path',
  'menu.copied': 'Copied',
}
function fmt(template, params) {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, key) => (params[key] === undefined ? whole : params[key]))
}

// ------------------------------------------------------------------
// 行身份解析（纯函数：入参为 DOM 元素与快照，可单测）
// ------------------------------------------------------------------

/** 行种类：项目行 = [role=treeitem][aria-expanded]；会话行 = [role=treeitem][aria-selected]。 */
function rowKind(rowEl) {
  if (rowEl.hasAttribute('aria-expanded')) return 'project'
  if (rowEl.hasAttribute('aria-selected')) return 'session'
  return null
}

/** 项目行：文本即工作区标题（图标是 SVG、按钮只有 aria-label，无文本节点）。 */
function projectRowTitle(rowEl) {
  return (rowEl.textContent || '').trim()
}

/**
 * 项目行 → 工作区。标题按 host 规则唯一；同名工作区（不同目录同名 basename）
 * 按 DOM 顺序消歧。解析失败返回 null（此时右键仍触发内置菜单，只是不注入
 * 复制路径）。
 */
function resolveWorkspaceRow(rowEl, workspacesSnap) {
  const label = projectRowTitle(rowEl)
  if (label === '') return null
  const matches = workspacesSnap.items.filter(w => w.title === label)
  if (matches.length === 0) return null
  if (matches.length === 1) return { kind: 'workspace', workspace: matches[0] }
  const sameTitled = [...document.querySelectorAll('[role="treeitem"][aria-expanded]')]
    .filter(r => projectRowTitle(r) === label)
  const index = sameTitled.indexOf(rowEl)
  const pick = matches[index >= 0 ? index : 0]
  return pick === undefined ? null : { kind: 'workspace', workspace: pick }
}

/** 剪贴板写入：navigator.clipboard 优先，失败退回 execCommand（非 https/权限拒绝时）。 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.style.pointerEvents = 'none'
      document.body.appendChild(ta)
      ta.select()
      let ok = false
      try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

// ------------------------------------------------------------------
// 装配
// ------------------------------------------------------------------
const factory = () => {
  /** 注入项样式表（幂等：HMR 重载后不重复）。 */
  function adoptStyles() {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `[${INJECT_MARK}]{position:relative}` +
      `[${INJECT_MARK}] button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`
    document.head.appendChild(style)
  }

  return {
    inject: ['workspaces', 'locale'],
    apply(ctx) {
      adoptStyles()

      // 设置路由：host Config.enabled 经此下发（client 无配置通道）。
      // 取不到（headless / 路由未挂）时默认开启，避免误伤。
      let enabled = true
      const syncEnabled = async () => {
        try {
          const res = await fetch(SETTINGS_ROUTE, { cache: 'no-store' })
          if (!res.ok) return
          const data = await res.json()
          if (data !== null && typeof data === 'object' && typeof data.enabled === 'boolean') {
            enabled = data.enabled
          }
        } catch {
          // 保持默认开启
        }
      }
      ctx.effect(() => { void syncEnabled() }, 'sidebar-helper: settings')

      // 字典 + 绑定翻译。
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-helper: dictionaries')
      const t = ctx.locale.bind(NS)

      // ------------------------------------------------------------------
      // 注入「复制路径」到工作区行内置菜单（菜单打开后生效）
      // ------------------------------------------------------------------
      // 一次只跟踪一个注入；active 非空时菜单一定还开着。
      let active = null // { observer, menu, viewport, wrap, label, closeTimer }
      // 最近一次点过省略号的行（左键 / 右键 / 键盘激活都记录）——用于把新打开
      // 的菜单归属到具体行。
      let lastRow = null // { rowEl, kind }

      function cleanupInjection() {
        if (active === null) return
        if (active.observer !== null) active.observer.disconnect()
        if (active.closeTimer !== null) clearTimeout(active.closeTimer)
        if (active.wrap !== null && active.wrap.parentElement !== null) {
          active.wrap.parentElement.removeChild(active.wrap)
        }
        active = null
      }

      /** 派发 Escape：内置 Menu 在 document 上监听 keydown，收到即 onClose。 */
      function closeMenu() {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true,
        }))
      }

      /**
       * 菜单打开后把「复制路径」插进其 viewport 首位，并用 MutationObserver
       * 钉住：React 重渲染（hover 换子菜单态、滚动/缩放重定位）会挪动或移除
       * 未知 DOM 节点，观察器在每个变更后把它重新插回第一项。
       */
      function injectCopyItem(menu, path) {
        cleanupInjection()
        const viewport = menu.querySelector(':scope > [role="presentation"]')
        if (viewport === null) return

        const wrap = document.createElement('div')
        wrap.setAttribute(INJECT_MARK, '')
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'menuitem')
        button.style.cssText = ITEM_CSS
        const icon = document.createElement('span')
        icon.style.cssText = ICON_CSS
        icon.innerHTML = COPY_ICON_SVG
        const label = document.createElement('span')
        label.style.cssText = LABEL_CSS
        label.textContent = t('menu.copyPath')
        button.appendChild(icon)
        button.appendChild(label)
        wrap.appendChild(button)

        let closeTimer = null
        button.addEventListener('click', (e) => {
          e.stopPropagation()
          if (active === null) return
          label.textContent = t('menu.copied')
          void copyText(path)
          // 定时器挂到 active 上：cleanupInjection 会在菜单被其它方式关闭时
          // 一并清除，避免残留 Escape 在 900ms 后误关之后打开的界面。
          active.closeTimer = window.setTimeout(closeMenu, COPIED_KEEP_MS)
        })

        viewport.insertBefore(wrap, viewport.firstElementChild)

        const observer = new MutationObserver(() => {
          if (active === null || active.menu !== menu || !menu.isConnected) {
            cleanupInjection()
            return
          }
          // React 可能把我们的节点挪走/移除：重新钉回 viewport 首位。
          if (!viewport.contains(wrap) || viewport.firstElementChild !== wrap) {
            viewport.insertBefore(wrap, viewport.firstElementChild)
          }
        })
        observer.observe(viewport, { childList: true })

        active = { observer, menu, viewport, wrap, label, closeTimer: null }
      }

      /**
       * 菜单锚点距离：菜单定位在锚点（省略号）旁边，返回菜单与某行省略号
       * 的位置偏差（越小越可能是该行开的菜单）。行高约 40px，阈值取 28px
       * 即可与相邻行干净区分。
       */
      function anchorDistance(menuRect, rowEl) {
        const ellipsis = rowEl.querySelector('button')
        if (ellipsis === null) return null
        const er = ellipsis.getBoundingClientRect()
        const dx = Math.abs(menuRect.left - er.left)
        const dy = Math.min(
          Math.abs(menuRect.top - er.bottom),
          Math.abs(menuRect.bottom - er.top),
        )
        return dy + dx * 0.2
      }

      /**
       * 识别刚打开的菜单属于哪一行：优先用「最近点过省略号的行」（菜单只可能
       * 由该行省略号的 onClick 打开，左键 / 右键 / 键盘激活都算，记录是可靠的），
       * 再用锚点位置校验；记录不可用时退化为全量扫描找最近的项目行。
       */
      function findMenuOwner(menu) {
        const menuRect = menu.getBoundingClientRect()
        if (lastRow !== null && lastRow.rowEl.isConnected) {
          const d = anchorDistance(menuRect, lastRow.rowEl)
          if (d !== null && d < 28) return lastRow
        }
        let best = null
        let bestD = Infinity
        for (const row of document.querySelectorAll('[role="treeitem"][aria-expanded]')) {
          const d = anchorDistance(menuRect, row)
          if (d === null) continue
          if (d < bestD) {
            bestD = d
            best = { rowEl: row, kind: 'project' }
          }
        }
        return bestD < 28 ? best : null
      }

      /** 全局菜单打开观察器：任何一行菜单出现，若属于工作区行则注入复制路径。 */
      let menuObserver = null
      function startMenuObserver() {
        if (menuObserver !== null) return
        menuObserver = new MutationObserver((mutations) => {
          if (!enabled) return
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof Element)) continue
              const menu = node.matches('[role="menu"]')
                ? node
                : node.querySelector('[role="menu"]')
              if (menu === null || !menu.isConnected) continue
              const owner = findMenuOwner(menu)
              if (owner === null || owner.kind !== 'project') continue
              const target = resolveWorkspaceRow(owner.rowEl, ctx.workspaces.list.getSnapshot())
              if (target === null) continue
              injectCopyItem(menu, target.workspace.path)
            }
          }
        })
        menuObserver.observe(document.body, { childList: true, subtree: true })
      }

      // ------------------------------------------------------------------
      // 右键监听：行上右键 → 阻止浏览器原生菜单，改为触发该行内置三点菜单。
      // 注入「复制路径」不在这里做——由全局菜单观察器对任何打开的工作区菜单
      // 统一处理（左键点「⋯」同样会注入）。
      // ------------------------------------------------------------------
      ctx.effect(() => {
        const onContextMenu = (event) => {
          if (event.defaultPrevented) return
          if (!(event.target instanceof Element)) return
          const rowEl = event.target.closest('[role="treeitem"]')
          if (rowEl === null) return
          const tree = rowEl.closest('[role="tree"]')
          if (tree === null) return
          // 工作区浏览器是文档里第一棵树（侧栏先于对话区渲染）。
          if (tree !== document.querySelector('[role="tree"]')) return
          if (!enabled) return
          const kind = rowKind(rowEl)
          if (kind === null) return
          // 行的省略号按钮：会话行只有一个按钮；工作区行第一个按钮就是它。
          // 空白「新会话」行 / 未分组桶没有按钮 → 不弹菜单（与内置一致）。
          const ellipsis = rowEl.querySelector('button')
          if (ellipsis === null) return

          event.preventDefault()
          // 同步记录归属行（注入由全局观察器按此识别菜单），再触发内置菜单。
          lastRow = { rowEl, kind }
          ellipsis.click()
        }
        document.addEventListener('contextmenu', onContextMenu, true)
        return () => {
          document.removeEventListener('contextmenu', onContextMenu, true)
          cleanupInjection()
        }
      }, 'sidebar-helper: contextmenu')

      // ------------------------------------------------------------------
      // 左键/键盘点省略号：记录归属行，供全局菜单观察器识别菜单属于哪一行。
      // 捕获阶段监听，先于 React 的 onClick（即使 onClick stopPropagation 也能
      // 记到）；只认行内第一个按钮（省略号），点「新建会话 +」不记录。
      // ------------------------------------------------------------------
      ctx.effect(() => {
        const onClick = (event) => {
          if (!(event.target instanceof Element)) return
          const rowEl = event.target.closest('[role="treeitem"]')
          if (rowEl === null) return
          const ellipsis = rowEl.querySelector('button')
          if (ellipsis === null) return
          if (event.target.closest('button') !== ellipsis) return
          lastRow = { rowEl, kind: rowKind(rowEl) }
        }
        document.addEventListener('click', onClick, true)
        return () => document.removeEventListener('click', onClick, true)
      }, 'sidebar-helper: ellipsis-track')

      // 全局菜单观察器随 fiber 生命周期启停；样式与注入一并清理。
      startMenuObserver()
      ctx.effect(() => {
        return () => {
          if (menuObserver !== null) menuObserver.disconnect()
          menuObserver = null
          cleanupInjection()
        }
      }, 'sidebar-helper: menu-observer')

      // 样式与注入随 fiber dispose 一并清理。
      ctx.effect(() => {
        return () => {
          const style = document.getElementById(STYLE_ID)
          if (style !== null) style.remove()
        }
      }, 'sidebar-helper: style')
    },
  }
}

// 浏览器：走模块加载器；Node（产物门单测）：导出纯函数。
if (typeof window !== 'undefined') {
  window.__ModuleLoader__.load({ id: '@freespace8/dsh-sidebar-helper', factory })
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NS, SETTINGS_ROUTE, COPIED_KEEP_MS, INJECT_MARK, STYLE_ID,
    ITEM_CSS, ICON_CSS, LABEL_CSS, COPY_ICON_SVG,
    zh, en, fmt,
    rowKind, projectRowTitle, resolveWorkspaceRow, copyText,
  }
}
