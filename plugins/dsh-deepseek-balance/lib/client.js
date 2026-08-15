// dsh-deepseek-balance — client half (免构建 bundle)。
// 浏览器侧通过 __ModuleLoader__.load 注册；id 必须等于包名（patch 行的 name）。
// 本文件被 host 扫描后经 /plugins/@freespace8/dsh-deepseek-balance/client.js 提供给浏览器，
// 改写本文件会触发 client HMR（无需刷新页面）。
window.__ModuleLoader__.load({
  id: '@freespace8/dsh-deepseek-balance',
  factory: (require) => {
    const React = require('react')

    const OFFICIAL_PROVIDER = 'deepseek-official'
    const SLOT_KEY = 'conversation.session.header.utilities'
    const ROUTE_PATH = '/plugins/dsh-deepseek-balance/balance'
    const STYLE_ID = 'dsh-deepseek-balance-style'
    const DEFAULT_INTERVAL_MS = 300000

    const css = [
      '.dsh-ds-balance { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
      '.dsh-ds-balance:hover { border-color: var(--dsw-alias-border-l2); }',
      '.dsh-ds-balance-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }',
      '.dsh-ds-balance-loading .dsh-ds-balance-dot { background: var(--dsw-alias-state-warn-primary); }',
      '.dsh-ds-balance-error .dsh-ds-balance-dot { background: var(--dsw-alias-state-error-primary); }',
      '.dsh-ds-balance-text { font-size: 12px; line-height: 20px; }',
      '.dsh-ds-balance-value { color: var(--dsw-alias-label-primary); font-weight: 500; }',
      '.dsh-ds-balance-refresh { display: inline-flex; align-items: center; justify-content: center; height: 14px; padding: 0 2px 0 2px; border: none; border-left: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
      '.dsh-ds-balance-refresh:hover { color: var(--dsw-alias-label-primary); }',
      '.dsh-ds-balance-refresh-spin { animation: dsh-ds-balance-spin 0.6s ease; }',
      '.dsh-ds-balance-refresh-loading svg { animation: dsh-ds-balance-spin 1s linear infinite; }',
      '@keyframes dsh-ds-balance-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
    ].join('\n')

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
          function BalanceChip(props) {
            const sessionId = props.sessionId
            const modelDirectories = ctx.get('modelDirectories')
            const [sessionProvider, setSessionProvider] = React.useState('unknown')
            const [state, setState] = React.useState({
              status: 'loading',
              refreshing: false,
              last: undefined,
              error: '',
              elapsedMs: 0,
              intervalMs: DEFAULT_INTERVAL_MS,
            })
            const [tick, setTick] = React.useState(0)

            // 会话级模型判定：仅当会话当前模型为官方 deepseek-official 时显示。
            React.useEffect(() => {
              if (modelDirectories === undefined) {
                setSessionProvider('unknown')
                return
              }
              let directory
              try {
                directory = modelDirectories.directoryFor(sessionId)
              } catch (err) {
                setSessionProvider('unknown')
                return
              }
              const read = () => {
                const current = directory.store.getSnapshot().current
                setSessionProvider(current === null || current === undefined ? 'unknown' : current.provider)
              }
              read()
              void directory.load().catch(() => undefined)
              const stop = directory.store.subscribe(read)
              return () => { stop() }
            }, [sessionId])

            const eligible = sessionProvider === OFFICIAL_PROVIDER

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
              if (!eligible) return
              refresh()
            }, [eligible, tick, refresh])

            // 自动刷新：递归 setTimeout（不依赖 timer 服务），unmount 清理。
            React.useEffect(() => {
              if (!eligible) return
              let timer = 0
              const schedule = () => {
                timer = window.setTimeout(() => {
                  setTick((t) => t + 1)
                  schedule()
                }, state.intervalMs)
              }
              schedule()
              return () => { window.clearTimeout(timer) }
            }, [eligible, state.intervalMs])

            if (!eligible) return null
            const { last, refreshing, status, error, elapsedMs } = state
            const failed = status === 'error'
            let chip
            let title
            if (last !== undefined) {
              const amount = last.total ? '¥' + last.total : ''
              chip = React.createElement('span', { className: 'dsh-ds-balance-text' },
                'DeepSeek 余额 ',
                React.createElement('span', { className: 'dsh-ds-balance-value' }, amount),
              )
              if (refreshing) title = '正在刷新余额…'
              else if (error !== '') title = error + ' · 点击刷新按钮重试'
              else title = '赠送 ' + last.granted + ' · 充值 ' + last.toppedUp + ' · 上次刷新 ' + elapsedMs + 'ms'
            } else if (status === 'loading') {
              chip = React.createElement('span', { className: 'dsh-ds-balance-text' }, '余额 …')
              title = '正在获取 DeepSeek 余额…'
            } else {
              chip = React.createElement('span', { className: 'dsh-ds-balance-text' }, '余额 获取失败')
              title = error + ' · 点击刷新按钮重试'
            }
            const cls = 'dsh-ds-balance'
              + ((last === undefined && refreshing) ? ' dsh-ds-balance-loading' : '')
              + (failed ? ' dsh-ds-balance-error' : '')
            const spinCls = tick > 0 ? ' dsh-ds-balance-refresh-spin' : ''
            const onClick = () => { setTick((t) => t + 1) }
            return React.createElement('span', { className: cls, title: title },
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
  },
})
