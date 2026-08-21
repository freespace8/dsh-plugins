// dsh-deepseek-balance — client half (免构建 bundle)。
// 浏览器侧通过 __ModuleLoader__.load 注册；id 必须等于包名（patch 行的 name）。
// 本文件被 host 扫描后经 /plugins/@freespace8/dsh-deepseek-balance/client.js 提供给浏览器，
// 改写本文件会触发 client HMR（无需刷新页面）。
//
// 纯函数（时段 / 倒计时）放 IIFE 内：经典脚本 HMR 会整文件再执行，顶层 const 会撞全局词法环境。
// Node 下经 module.exports 导出供产物门单测；浏览器走 __ModuleLoader__.load。

;(function () {
const SLOT_KEY = 'conversation.session.header.utilities'
const ROUTE_PATH = '/plugins/dsh-deepseek-balance/balance'
const STYLE_ID = 'dsh-deepseek-balance-style'
const DEFAULT_INTERVAL_MS = 300000

// DeepSeek 官方计价窗口：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 高价 北京时间 09:00–12:00、14:00–18:00；其余为平价。中国无夏令时，固定 UTC+8。
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const PEAK_WINDOWS = '高价 09:00–12:00、14:00–18:00（北京时间）'

function beijingParts(ms) {
  const d = new Date(ms + BEIJING_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  }
}

function beijingWallToMs(year, month, day, hour, minute, second) {
  return Date.UTC(year, month - 1, day, hour, minute, second) - BEIJING_OFFSET_MS
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatBeijingHm(ms) {
  const p = beijingParts(ms)
  return pad2(p.hour) + ':' + pad2(p.minute)
}

/**
 * 当前计价时段。kind 为 peak（高价）或 idle（平价）；
 * untilMs 为该时段结束瞬间（北京整点），remainMs 为距结束的毫秒。
 */
function getPeriod(nowMs) {
  const p = beijingParts(nowMs)
  const y = p.year
  const mo = p.month
  const d = p.day
  const h = p.hour
  let kind
  let untilMs
  if (h >= 9 && h < 12) {
    kind = 'peak'
    untilMs = beijingWallToMs(y, mo, d, 12, 0, 0)
  } else if (h >= 12 && h < 14) {
    kind = 'idle'
    untilMs = beijingWallToMs(y, mo, d, 14, 0, 0)
  } else if (h >= 14 && h < 18) {
    kind = 'peak'
    untilMs = beijingWallToMs(y, mo, d, 18, 0, 0)
  } else if (h >= 18) {
    kind = 'idle'
    untilMs = beijingWallToMs(y, mo, d, 9, 0, 0) + 24 * HOUR_MS
  } else {
    kind = 'idle'
    untilMs = beijingWallToMs(y, mo, d, 9, 0, 0)
  }
  return { kind, untilMs, remainMs: Math.max(0, untilMs - nowMs) }
}

/** 倒计时 hh:mm:ss。 */
function formatRemain(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

function periodLabel(period) {
  const name = period.kind === 'idle' ? '平价' : '高价'
  return name + ' ' + formatRemain(period.remainMs)
}

function periodHover(period) {
  const clock = formatBeijingHm(period.untilMs)
  if (period.kind === 'idle') return '平价至 ' + clock + ' · ' + PEAK_WINDOWS
  return clock + ' 起平价 · ' + PEAK_WINDOWS
}

const css = [
  '.dsh-ds-balance { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
  '.dsh-ds-balance:hover { border-color: var(--dsw-alias-border-l2); }',
  '.dsh-ds-balance-idle { border-color: #22c55e; background: color-mix(in srgb, #22c55e 22%, var(--dsw-alias-bg-layer-1)); }',
  '.dsh-ds-balance-idle:hover { border-color: #4ade80; }',
  '.dsh-ds-balance-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }',
  '.dsh-ds-balance-loading .dsh-ds-balance-dot { background: var(--dsw-alias-state-warn-primary); }',
  '.dsh-ds-balance-error .dsh-ds-balance-dot { background: var(--dsw-alias-state-error-primary); }',
  '.dsh-ds-balance-text { font-size: 12px; line-height: 20px; }',
  '.dsh-ds-balance-value { color: var(--dsw-alias-label-primary); font-weight: 500; }',
  '.dsh-ds-balance-period { margin-left: 8px; font-weight: 700; font-variant-numeric: tabular-nums; }',
  '.dsh-ds-balance-idle .dsh-ds-balance-period { color: #3ddc97; }',
  '.dsh-ds-balance-peak .dsh-ds-balance-period { color: #ff4d4f; }',
  '.dsh-ds-balance-refresh { display: inline-flex; align-items: center; justify-content: center; height: 14px; padding: 0 2px 0 2px; border: none; border-left: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  '.dsh-ds-balance-refresh:hover { color: var(--dsw-alias-label-primary); }',
  '.dsh-ds-balance-refresh-spin { animation: dsh-ds-balance-spin 0.6s ease; }',
  '.dsh-ds-balance-refresh-loading svg { animation: dsh-ds-balance-spin 1s linear infinite; }',
  '@keyframes dsh-ds-balance-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
].join('\n')

function factory(require) {
  const React = require('react')

  return {
    inject: ['slots'],
    apply(ctx) {
      // 样式注入：幂等（固定 id + data-plugin），随 fiber dispose 清理。
      const ensureStyle = () => {
        if (document.getElementById(STYLE_ID)) return () => {}
        const el = document.createElement('style')
        el.id = STYLE_ID
        el.setAttribute('data-plugin', 'dsh-deepseek-balance')
        el.textContent = css
        document.head.appendChild(el)
        return () => { el.remove() }
      }
      ctx.effect(ensureStyle, 'dsh-deepseek-balance: styles')

      const slots = ctx.get('slots')
      if (slots === undefined) return

      slots.inject(SLOT_KEY, () => slots.register(
        {
          name: SLOT_KEY,
          id: 'deepseek-balance',
          order: -1,
          label: 'DeepSeek balance',
        },
        function BalanceChip() {
          const [state, setState] = React.useState({
            status: 'loading',
            refreshing: false,
            last: undefined,
            error: '',
            elapsedMs: 0,
            intervalMs: DEFAULT_INTERVAL_MS,
          })
          const [tick, setTick] = React.useState(0)
          const [nowMs, setNowMs] = React.useState(() => Date.now())

          // 拉取余额：保留旧值，只更新状态；in-flight guard + unmount 防护。
          const refresh = React.useCallback(() => {
            setState((prev) => ({ ...prev, refreshing: true, error: '' }))
            const t0 = performance.now()
            fetch(ROUTE_PATH, { cache: 'no-store' })
              .then((res) => {
                if (!res.ok) throw new Error('HTTP ' + res.status)
                return res.json()
              })
              .then((r) => {
                const elapsed = Math.round(performance.now() - t0)
                const d = (r === null || typeof r !== 'object') ? {} : r
                setState((prev) => {
                  const intervalMs = Number(d.intervalMs) > 0 ? Number(d.intervalMs) : prev.intervalMs
                  if (d.ok === true) {
                    return {
                      status: 'ok',
                      refreshing: false,
                      last: {
                        total: String(d.total || ''),
                        granted: String(d.granted || ''),
                        toppedUp: String(d.toppedUp || ''),
                      },
                      error: '',
                      elapsedMs: Number(d.elapsedMs) || elapsed,
                      intervalMs,
                    }
                  }
                  return {
                    ...prev,
                    status: prev.last === undefined ? 'error' : 'ok',
                    refreshing: false,
                    error: String(d.error || 'unknown error'),
                    elapsedMs: Number(d.elapsedMs) || elapsed,
                    intervalMs,
                  }
                })
              })
              .catch((err) => {
                setState((prev) => ({
                  ...prev,
                  status: prev.last === undefined ? 'error' : 'ok',
                  refreshing: false,
                  error: String((err && err.message) || err || 'unknown error'),
                }))
              })
          }, [])

          // 首次加载 + 每次 tick（点击/定时）触发。
          React.useEffect(() => {
            refresh()
          }, [tick, refresh])

          // 自动刷新：递归 setTimeout（不依赖 timer 服务），unmount 清理。
          React.useEffect(() => {
            let timer = 0
            const schedule = () => {
              timer = window.setTimeout(() => {
                setTick((t) => t + 1)
                schedule()
              }, state.intervalMs)
            }
            schedule()
            return () => { window.clearTimeout(timer) }
          }, [state.intervalMs])

          // 计价倒计时：每秒刷新文案；跨 9/12/14/18 整点立刻翻色。
          React.useEffect(() => {
            setNowMs(Date.now())
            const timer = window.setInterval(() => { setNowMs(Date.now()) }, 1000)
            return () => { window.clearInterval(timer) }
          }, [])

          const { last, refreshing, status, error, elapsedMs } = state
          const failed = status === 'error'
          const period = getPeriod(nowMs)
          const periodEl = React.createElement('span', { className: 'dsh-ds-balance-period' }, periodLabel(period))
          const titleParts = []
          let chip
          if (last !== undefined) {
            const amount = last.total ? '¥' + last.total : ''
            chip = React.createElement('span', { className: 'dsh-ds-balance-text' },
              '余额 ',
              React.createElement('span', { className: 'dsh-ds-balance-value' }, amount),
              ' ',
              periodEl,
            )
            if (refreshing) titleParts.push('正在刷新余额…')
            else if (error !== '') titleParts.push(error, '点击刷新按钮重试')
            else titleParts.push('赠送 ' + last.granted, '充值 ' + last.toppedUp, '上次刷新 ' + elapsedMs + 'ms')
          } else if (status === 'loading') {
            chip = React.createElement('span', { className: 'dsh-ds-balance-text' }, '余额 … ', periodEl)
            titleParts.push('正在获取 DeepSeek 余额…')
          } else {
            chip = React.createElement('span', { className: 'dsh-ds-balance-text' }, '余额 获取失败 ', periodEl)
            titleParts.push(error, '点击刷新按钮重试')
          }
          titleParts.push(periodHover(period))
          const cls = 'dsh-ds-balance'
            + (period.kind === 'idle' ? ' dsh-ds-balance-idle' : ' dsh-ds-balance-peak')
            + ((last === undefined && refreshing) ? ' dsh-ds-balance-loading' : '')
            + (failed ? ' dsh-ds-balance-error' : '')
          const spinCls = tick > 0 ? ' dsh-ds-balance-refresh-spin' : ''
          const onClick = () => { setTick((t) => t + 1) }
          return React.createElement('span', { className: cls, title: titleParts.join(' · ') },
            React.createElement('span', { className: 'dsh-ds-balance-dot' }),
            chip,
            React.createElement('button',
              {
                type: 'button',
                className: 'dsh-ds-balance-refresh' + (refreshing ? ' dsh-ds-balance-refresh-loading' : ''),
                title: '刷新余额',
                'aria-label': '刷新余额',
                onClick: onClick,
              },
              React.createElement('svg',
                {
                  key: tick,
                  className: spinCls.trim(),
                  viewBox: '0 0 24 24',
                  width: 14,
                  height: 14,
                  fill: 'currentColor',
                  'aria-hidden': true,
                },
                React.createElement('path', { d: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-8 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z' }),
              ),
            ),
          )
        },
      ))
    },
  }
}

// 浏览器：走模块加载器；Node（产物门单测）：导出纯函数。
if (typeof window !== 'undefined') {
  window.__ModuleLoader__.load({
    id: '@freespace8/dsh-deepseek-balance',
    factory,
  })
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BEIJING_OFFSET_MS,
    beijingParts,
    beijingWallToMs,
    formatBeijingHm,
    getPeriod,
    formatRemain,
    periodLabel,
    periodHover,
  }
}
})()
