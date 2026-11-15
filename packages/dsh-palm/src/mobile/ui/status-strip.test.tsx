// @vitest-environment jsdom
/**
 * 状态栏（2026-11-10 第三版：平铺一行）的渲染契约。
 *
 * 用户口径：「做成桌面端 DSH 那种 —— 不要状态条、不要滑动条，只有一个状态栏，平铺显示。」
 * 于是这一版钉的是四件事：
 * 1. 11 种状态共用一枚鲸尾，识别交给底盘（`data-kind`）与文案；
 * 2. `main` 是**平铺一行**：没有填充块、没有刻度轨，只有「鲸尾 + 文案 + 时间」；
 * 3. `mini` 是抽屉里的小胶囊：只留鲸尾 + 主文案；
 * 4. 不给 `onOpen` 时是纯状态区，给了才是可点行（键盘也能开）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StatusStrip, WORD_WIND_MS, type StatusStripKind } from './status-strip.tsx'
import { mobileCss } from '../mobile-styles.ts'

afterEach(() => { cleanup() })

/** 去掉注释后的样式表：规则边界才好用 `}` 定位。 */
const CSS = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** 读一条规则的声明体（选择器要写全，且必须从规则边界开始）。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('(?:^|[}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(CSS)
  if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
  return match[1] ?? ''
}

/** 读一个 px 令牌的数值（没定义或不是 px 一律报错）。 */
function pxToken(name: string): number {
  const match = new RegExp(name + ':\\s*(-?\\d+(?:\\.\\d+)?)px').exec(mobileCss)
  if (match === null) throw new Error(`找不到 px 令牌 ${name}`)
  return Number(match[1])
}

const KINDS: readonly StatusStripKind[] = [
  'think', 'read', 'edit', 'test', 'approve', 'stuck',
  'unknown', 'done', 'failed', 'stopped', 'queued',
]

describe('StatusStrip（状态栏 · 平铺一行）', () => {
  it('11 种 kind 都渲染得出来，各自带 data-kind 与一枚内联鲸尾', () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<StatusStrip kind={kind} label="在做" />)
      const strip = container.querySelector(`.palm-strip[data-kind="${kind}"]`)
      expect(strip, `${kind} 没渲染出来`).not.toBeNull()
      expect(strip?.querySelector('[data-mark="whale"]'), kind).not.toBeNull()
      // 纯内联 SVG：没有图片资源、没有 emoji（emoji 在下面的用例里单独钉）。
      expect(strip?.querySelector('image')).toBeNull()
      unmount()
    }
  })

  it('同一枚鲸尾，靠底色区分状态（11 张表情脸 → 1 枚尾）', () => {
    const marks = new Set<string>()
    for (const kind of KINDS) {
      const { container, unmount } = render(<StatusStrip kind={kind} label="在做" />)
      marks.add(container.querySelector('.palm-strip-mark')?.getAttribute('data-kind') ?? '')
      unmount()
    }
    // 底色按 kind 分派，11 种状态一个不少。
    expect(marks.size).toBe(11)
  })

  it('主条是平铺一行：没有填充块、没有刻度轨', () => {
    render(<StatusStrip kind="test" label="深度求索中" detail="改 delivery-card.tsx" right="02:14" />)
    expect(document.querySelector('.palm-strip-fill')).toBeNull()
    expect(document.querySelector('.palm-strip-rail')).toBeNull()
    expect(document.querySelector('[data-mark="whale"]')).not.toBeNull()
    expect(document.querySelector('[data-part="detail"]')?.textContent).toBe('改 delivery-card.tsx')
    expect(document.querySelector('[data-part="right"]')?.textContent).toBe('02:14')
    // 平铺：不再是 28px 胶囊（高度由内容决定，没有 block-size 写死）。
    expect(ruleBody('.palm-strip')).not.toContain('block-size: var(--palm-strip-h)')
  })

  it('mini：同组件换尺寸（data-size），只留鲸尾 + 主文案', () => {
    render(
      <StatusStrip kind="read" label="读文件" detail="ChatView.tsx" right="0s" size="mini" />,
    )
    const wrap = document.querySelector('.palm-strip-wrap')
    const strip = document.querySelector('.palm-strip')
    expect(wrap?.getAttribute('data-size')).toBe('mini')
    expect(strip?.getAttribute('data-size')).toBe('mini')
    expect(strip?.querySelector('[data-mark="whale"]')).not.toBeNull()
    expect(document.querySelector('[data-part="label"]')?.textContent).toBe('读文件')
    expect(document.querySelector('[data-part="detail"]')).toBeNull()
    expect(document.querySelector('[data-part="right"]')).toBeNull()
  })

  it('不给 onOpen 时是状态区；给了就是可点行（键盘也能开）', () => {
    const idle = render(<StatusStrip kind="done" label="完成" detail="12 个文件" right="12s" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('完成，12 个文件，12s')
    expect(document.querySelector('.palm-strip-wrap')?.getAttribute('role')).toBeNull()
    idle.unmount()

    const onOpen = vi.fn()
    render(<StatusStrip kind="done" label="完成" onOpen={onOpen} />)
    const hit = screen.getByRole('button')
    expect(hit.className).toContain('palm-strip-wrap')
    fireEvent.click(hit)
    fireEvent.keyDown(hit, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('只用文字和 SVG：没有 emoji、没有图片', () => {
    render(<StatusStrip kind="approve" label="等你就绪" detail="rm -rf dist" right="等你 42s" />)
    const text = document.body.textContent ?? ''
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text)).toBe(false)
    expect(document.querySelector('img')).toBeNull()
  })
})

describe('词槽：星尘聚形（2026-11-15）', () => {
  /** jsdom 没有 matchMedia：组件据此走静止路径。这条本身就是被测前提。 */
  it('jsdom 环境没有 matchMedia（测试因此永远走静止路径）', () => {
    expect(typeof window.matchMedia).not.toBe('function')
  })

  it('静止时只有一份文本：不挂 canvas、不留碎块', () => {
    const { container } = render(<StatusStrip kind="think" label="琢磨着" wind />)
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('.palm-word-slot')?.textContent).toBe('琢磨着')
    // 读屏与快照读的仍是这一份文本。
    expect(container.querySelector('[data-part="label"]')?.textContent).toBe('琢磨着')
  })

  it('没给 wind 的调用点（抽屉迷你条等）连词槽都不出现', () => {
    const { container } = render(<StatusStrip kind="think" label="琢磨着" size="mini" />)
    expect(container.querySelector('.palm-word-slot')).toBeNull()
    expect(container.querySelector('.palm-word')).toBeNull()
    expect(container.querySelector('[data-part="label"]')?.textContent).toBe('琢磨着')
  })

  it('环境不允许动画：换词直接替换，不挂 canvas', () => {
    const view = render(<StatusStrip kind="think" label="琢磨着" wind />)
    view.rerender(<StatusStrip kind="think" label="盘算着" wind />)
    expect(view.container.querySelector('canvas')).toBeNull()
    expect(view.container.querySelector('[data-part="label"]')?.textContent).toBe('盘算着')
  })

  /**
   * 真机路径只钉**时序**（挂 canvas → 560ms 后摘掉 → 回到一份文本）：
   * jsdom 没有 canvas 实现，像素采样与推帧靠 preview 页的真机图验证，
   * 这里断言渲染时机，避免"星尘不消失、一直盖着字"或"动画没开始就被摘"。
   */
  it('浏览器允许动画：换词挂上星尘 canvas，WORD_WIND_MS 后收回一份文本', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
      }),
    })
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.useFakeTimers()
    try {
      const view = render(<StatusStrip kind="think" label="琢磨着" wind />)
      act(() => { view.rerender(<StatusStrip kind="think" label="盘算着" wind />) })
      expect(view.container.querySelector('canvas.palm-word-canvas')).not.toBeNull()
      act(() => { vi.advanceTimersByTime(WORD_WIND_MS) })
      expect(view.container.querySelector('canvas')).toBeNull()
      expect(view.container.querySelector('[data-part="label"]')?.textContent).toBe('盘算着')
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(window, 'matchMedia')
      getContext.mockRestore()
    }
  })
})

describe('词槽样式契约（星尘聚形）', () => {
  it('词槽锁 3em（灰字与计时不跳），canvas 比词槽四周各大一圈', () => {
    expect(ruleBody('.palm-word-slot')).toContain('inline-size: 3em')
    const canvas = ruleBody('.palm-word-canvas')
    expect(canvas).toContain('calc(3em + var(--palm-star-pad-x) * 2)')
    expect(canvas).toContain('pointer-events: none')
  })

  it('字号 14px：1px 粒子才有可见空隙（11px 上必然糊成一团）', () => {
    expect(pxToken('--palm-strip-size')).toBe(14)
  })

  it('上一版碎块方案彻底下线，不留死样式', () => {
    expect(CSS.includes('.grain')).toBe(false)
    expect(CSS.includes('palm-grain-away')).toBe(false)
    expect(CSS.includes('palm-grain-gather')).toBe(false)
    expect(CSS.includes('data-grain')).toBe(false)
  })
})

describe('状态栏样式契约（平铺一行）', () => {
  it('平铺：主条不写死高度、没有底色与描边，靠留白与正文分开', () => {
    const main = ruleBody('.palm-strip')
    expect(pxToken('--palm-strip-size')).toBe(14)
    expect(pxToken('--palm-strip-pad')).toBe(7)
    expect(main).toContain('border: 0')
    expect(main).toContain('background: none')
    expect(main).not.toContain('border-radius')
    expect(ruleBody('.palm-strip-body')).toContain('padding-inline: var(--palm-strip-pad)')
    expect(ruleBody(".palm-strip [data-part='label']")).toContain('font-size: var(--palm-strip-size)')
  })

  it('刻度轨与填充的规则一并下线（不留死样式）', () => {
    expect(CSS.includes('.palm-strip-rail')).toBe(false)
    expect(CSS.includes('.palm-strip-fill')).toBe(false)
    expect(CSS.includes('--palm-strip-grad-think')).toBe(false)
  })

  it('迷你版（132×22 / 12px 字）仍是小胶囊；可点外层仍撑到 44px', () => {
    expect(pxToken('--palm-strip-mini-w')).toBe(132)
    expect(pxToken('--palm-strip-mini-h')).toBe(22)
    expect(pxToken('--palm-strip-pet-mini')).toBe(12)
    expect(ruleBody(".palm-strip[data-size='mini']")).toContain('inline-size: var(--palm-strip-mini-w)')
    expect(ruleBody(".palm-strip[data-size='mini']")).toContain('block-size: var(--palm-strip-mini-h)')
    expect(ruleBody(".palm-strip[data-size='mini'] [data-part='label']")).toContain('font-size: var(--palm-t-s)')
    // 平铺行的视觉高度很小：给了 onOpen 时外层是可点行，最小高度吃 --palm-hit。
    expect(pxToken('--palm-hit')).toBe(44)
    expect(ruleBody(".palm-strip-wrap[role='button']")).toContain('min-block-size: var(--palm-hit)')
  })
})
