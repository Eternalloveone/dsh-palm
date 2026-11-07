/**
 * 真机跳动取证面板（只在 URL 带 `jumpdebug=1` 时启用）。
 *
 * 背景：安卓 Chrome 上点输入区「+」「/」时，消息区会往上跳一下再回来。
 * 桌面模拟里复现不出来（实测：视口高度改 60px 时贴底锚点稳如泰山、
 * 浮层不在滚动容器里、也没有任何 scroll 事件）。所以不再靠猜——
 * 让真机自己把"跳之前发生了什么"记下来，用户截个图就能定位。
 *
 * 采集内容（都是能直接指向根因的量）：
 *   · visualViewport 的 resize/scroll（软键盘、地址栏收起都会动它）
 *   · window.resize（布局视口变化）
 *   · .chat-scroll 的 clientHeight / scrollTop 变化（谁动了滚动区）
 *   · focusin/focusout（安卓 Chrome 会把聚焦元素滚进视野）
 * 面板渲染在屏幕顶部，最多 14 行，等宽小字，可一键复制。
 */

interface JumpProbe {
  events: string[]
  paint: () => void
}

const MAX_LINES = 14

function startProbe(): JumpProbe {
  const events: string[] = []
  const box = document.createElement('div')
  box.setAttribute('role', 'status')
  box.setAttribute('data-jumpdebug', 'panel')
  box.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
    'max-height:46vh', 'overflow:auto', 'background:rgba(0,0,0,0.86)', 'color:#9fe8a0',
    'font:10px/1.35 ui-monospace,Menlo,monospace', 'padding:4px 6px',
    'white-space:pre-wrap', 'pointer-events:none', '-webkit-user-select:text', 'user-select:text',
  ].join(';')

  const paint = (): void => {
    box.textContent = events.slice(-MAX_LINES).join('\n')
  }
  paint()
  document.body.append(box)

  const t0 = Date.now()
  const stamp = (): string => {
    const ms = Date.now() - t0
    return `${String(ms).padStart(6)}ms`
  }
  const push = (line: string): void => {
    events.push(line)
    if (events.length > 200) events.shift()
    paint()
  }

  const scrollOf = (): Element | null => document.querySelector('.chat-scroll')
  let scrollEl = scrollOf()
  let lastClient = scrollEl === null ? -1 : Math.round(scrollEl.clientHeight)
  let lastTop = scrollEl === null ? -1 : Math.round(scrollEl.scrollTop)

  push(`${stamp()} 起：client=${lastClient} top=${lastTop}`)

  const vv = window.visualViewport
  if (vv !== null && vv !== undefined) {
    push(`${stamp()} vv init h=${Math.round(vv.height)} off=${Math.round(vv.offsetTop)}`)
    vv.addEventListener('resize', () => {
      push(`${stamp()} vv resize h=${Math.round(vv.height)} off=${Math.round(vv.offsetTop)}`)
    })
    vv.addEventListener('scroll', () => {
      push(`${stamp()} vv scroll off=${Math.round(vv.offsetTop)}`)
    })
  }
  window.addEventListener('resize', () => {
    push(`${stamp()} win resize innerH=${window.innerHeight} client=${scrollEl === null ? -1 : Math.round(scrollEl.clientHeight)}`)
  })

  // .chat-scroll 可能被重新挂载（换会话），用事件代理 + 轮询兜住。
  const arm = (el: Element | null): void => {
    if (el === null) return
    el.addEventListener('scroll', () => {
      const now = Math.round(el.scrollTop)
      if (now === lastTop) return
      push(`${stamp()} scroll top=${lastTop}→${now} gap=${Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)}`)
      lastTop = now
    }, { passive: true })
  }
  arm(scrollEl)

  window.setInterval(() => {
    const el = scrollOf()
    if (el !== scrollEl) {
      scrollEl = el
      lastClient = el === null ? -1 : Math.round(el.clientHeight)
      push(`${stamp()} 滚动区换了 client=${lastClient}`)
      arm(el)
      return
    }
    if (el === null) return
    const client = Math.round(el.clientHeight)
    if (client !== lastClient) {
      push(`${stamp()} client ${lastClient}→${client} top=${Math.round(el.scrollTop)}`)
      lastClient = client
    }
  }, 100)

  document.addEventListener('focusin', (event) => {
    const el = event.target as HTMLElement | null
    if (el === null) return
    push(`${stamp()} focus ${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? (el.className || '').toString().split(' ')[0] ?? ''}`)
  }, true)
  document.addEventListener('focusout', (event) => {
    const el = event.target as HTMLElement | null
    if (el === null) return
    push(`${stamp()} blur  ${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? (el.className || '').toString().split(' ')[0] ?? ''}`)
  }, true)

  // 复制按钮单独一层，避免和不可交互的面板冲突。
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = '复制日志'
  copy.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483647',
    'min-height:40px', 'padding:0 12px', 'border-radius:10px', 'border:1px solid #444',
    'background:#111', 'color:#9fe8a0', 'font:12px/1 ui-monospace,monospace',
  ].join(';')
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(events.join('\n')).then(
      () => { copy.textContent = '已复制' },
      () => { copy.textContent = '复制失败' },
    )
  })
  document.body.append(copy)

  return { events, paint }
}

/** 只有带 `jumpdebug=1` 才启动，正常用户零影响。 */
export function installJumpProbeIfRequested(): JumpProbe | undefined {
  if (typeof window === 'undefined') return undefined
  const params = new URLSearchParams(window.location.search)
  if (!params.has('jumpdebug')) return undefined
  if (document.body === null) return undefined
  try {
    return startProbe()
  } catch {
    return undefined
  }
}
