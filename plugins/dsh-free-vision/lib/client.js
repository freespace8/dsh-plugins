// dsh-free-vision — client half (免构建 bundle)。
// 浏览器侧通过 __ModuleLoader__.load 注册；id 必须等于包名（patch 行的 name）。
// 本文件被 host 扫描后经 /plugins/@freespace8/dsh-free-vision/client.js 提供给浏览器，
// 改写本文件会触发 client HMR（无需刷新页面）。
window.__ModuleLoader__.load({
  id: '@freespace8/dsh-free-vision',
  factory: (require) => {
    const React = require('react')

    const SLOT_KEY = 'conversation.input.right'
    const UPLOAD_URL = '/plugins/dsh-free-vision/images'

    function isInputTarget(target) {
      return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    }

    function imageFiles(files) {
      if (!files) return []
      return [...files].filter((f) => f.type.startsWith('image/'))
    }

    /** POST 图片字节到本机 DSH webServer，返回保存后的绝对路径。 */
    async function uploadImage(file) {
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) {
        let detail = 'HTTP ' + res.status
        try {
          const body = await res.json()
          if (body && typeof body === 'object' && body.error) detail = body.error
        } catch {
          /* 非 JSON 错误体，保留状态码 */
        }
        throw new Error(detail)
      }
      const body = await res.json()
      const path = (body && typeof body === 'object' && body.path) || ''
      if (!path) throw new Error('上传响应缺少 path')
      return path
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        // 在输入框右端注册一个渲染 null 的槽位组件：只接管图片粘贴。
        // slots.inject 等 ui-conversation 声明该槽后再注册，随 fiber dispose 清理。
        slots.inject(SLOT_KEY, () => slots.register(
          {
            name: SLOT_KEY,
            id: 'dsh-free-vision-paste',
            order: 999,
            label: 'Paste image to path',
          },
          function PasteToPath(props) {
            const input = props.input
            const inputActions = props.inputActions

            // owner 传入的 input 快照随 store 变更自动重渲染，用 ref 镜像最新 draft，
            // 事件闭包（mount 时挂一次监听）读取的永远是当前草稿。
            const draftRef = React.useRef('')
            draftRef.current = input && typeof input === 'object' ? (input.draft || '') : ''

            // 文档级 capture 监听 paste，仅当事件目标是输入框（textarea/input）
            // 且剪贴板含 image/* 文件时接管（preventDefault + stopPropagation，
            // 避免 DSH InputBar 的合成事件把剪贴板文本插进草稿）。
            // 不做拖拽接管：drop 事件被阻止会让 DSH 原生拖拽状态机残留遮罩/附件，
            // 与上游 free-vision-skill / modlens 一致只处理 paste。
            React.useEffect(() => {
              const handlePaste = (e) => {
                if (!isInputTarget(e.target)) return
                const files = imageFiles(e.clipboardData && e.clipboardData.files)
                if (!files.length) return
                e.preventDefault()
                e.stopPropagation()
                void saveToDraft(files)
              }
              document.addEventListener('paste', handlePaste, true)
              return () => {
                document.removeEventListener('paste', handlePaste, true)
              }
              // inputActions 身份 per-session 稳定，空依赖安全
              // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [])

            // 逐张串行上传并追加路径（串行保证多图插入顺序稳定）。
            const saveToDraft = async (files) => {
              for (const file of files) {
                try {
                  const path = await uploadImage(file)
                  const base = draftRef.current
                  const sep = base && !base.endsWith('\n') ? '\n' : ''
                  const next = base + sep + path
                  inputActions.setDraft(next)
                  draftRef.current = next
                } catch (err) {
                  // 槽位 kit 无通知通道（notify 属会话内部），失败走 console 便于诊断
                  console.error('[dsh-free-vision] 图片保存失败: ' + file.name, err)
                }
              }
            }

            return null
          },
        ))
      },
    }
  },
})
