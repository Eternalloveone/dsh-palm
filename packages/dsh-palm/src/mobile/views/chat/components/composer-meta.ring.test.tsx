// @vitest-environment jsdom
/**
 * 右下角上下文用量圆环（2026-11-10 用户：「渲染显示不准确」）。
 *
 * 以前它是一个只给 border-top 上色的 border 圆 —— 不管百分比是多少都画四分之一圈。
 * 现在弧长 = `--palm-ctx-ratio`，颜色按 70/90 分档。这里钉住三件事：
 * ① 比例真的是 pct/100（不是写死的 0.25）② 越界会被夹住 ③ 语气分档对。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerMeta } from './composer-meta.tsx'

afterEach(() => { cleanup() })

const base = {
  currentModel: { provider: 'p', model: 'deepseek-v4.1-flash' },
  permissions: { currentValue: 'full', options: [{ value: 'full', name: '完全访问' }] },
  modelCatalog: { status: 'idle' as const },
  panelOpen: false,
  panel: null,
  statusText: '空闲',
  pickerBusy: false,
  togglePanel: () => {},
  closePanel: () => {},
  loadModelCatalog: () => {},
  applyModel: () => {},
  applyPermission: () => {},
  staleHint: () => undefined,
}

const renderAt = (pct: number | undefined) => {
  const { container } = render(
    <ComposerMeta
      {...base}
      contextUsage={pct === undefined ? undefined : { pct, window: 200_000, pressure: Math.round(pct / 100 * 200_000) }}
    />,
  )
  const host = container.querySelector('.chat-meta-ctx')
  const circles = container.querySelectorAll('.chat-meta-ring circle')
  const track = circles[0] ?? null
  const fill = circles[1] ?? null
  return { host, fill, track }
}

describe('上下文用量圆环', () => {
  it('打开明细会先收起模型/权限面板（两块浮层不许叠在一起）', () => {
    // 2026-11-12 真机：「点权限/模型按钮，接着点上下文圆环，出现遮挡」——
    // 两个浮层各自开关，能同时开着，权限面板压住明细只露一角。
    const closePanel = vi.fn()
    const { container } = render(
      <ComposerMeta
        {...base}
        contextUsage={{ pct: 60, window: 200_000, pressure: 120_000 }}
        panelOpen={true}
        panel="permission"
        closePanel={closePanel}
      />,
    )
    const ring = container.querySelector('.chat-meta-ctx') as HTMLElement
    fireEvent.click(ring)
    expect(closePanel).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('打开模型/权限面板会收起明细（反方向也要互斥）', () => {
    const togglePanel = vi.fn()
    const { container } = render(
      <ComposerMeta
        {...base}
        contextUsage={{ pct: 60, window: 200_000, pressure: 120_000 }}
        togglePanel={togglePanel}
      />,
    )
    const ring = container.querySelector('.chat-meta-ctx') as HTMLElement
    fireEvent.click(ring)
    // 明细已经开着，此时点模型胶囊：应交出去 togglePanel，且明细不会再留下。
    const chips = container.querySelectorAll('.chat-meta-chip')
    fireEvent.click(chips[0] as HTMLElement)
    expect(togglePanel).toHaveBeenCalledWith('model')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    cleanup()
  })

  it('弧长按 pct/100 走，不再是写死的四分之一圈', () => {
    // pathLength=100 ⇒ strokeDasharray 的第一个数就是百分比本身。
    expect(renderAt(43).fill?.getAttribute('stroke-dasharray')).toBe('43.00 100')
    cleanup()
    expect(renderAt(78).fill?.getAttribute('stroke-dasharray')).toBe('78.00 100')
    cleanup()
    expect(renderAt(96).fill?.getAttribute('stroke-dasharray')).toBe('96.00 100')
  })

  it('有轨道与进度两层（静态 border 圆没有这两层）', () => {
    const { fill, track } = renderAt(43)
    expect(track).not.toBeNull()
    expect(fill).not.toBeNull()
  })

  it('70% 起琥珀、90% 起红色；没数据时是 calm', () => {
    expect(renderAt(43).host?.getAttribute('data-tone')).toBe('calm')
    cleanup()
    expect(renderAt(70).host?.getAttribute('data-tone')).toBe('warn')
    cleanup()
    expect(renderAt(90).host?.getAttribute('data-tone')).toBe('danger')
    cleanup()
    expect(renderAt(undefined).host?.getAttribute('data-tone')).toBe('calm')
  })

  it('没有投影时占位 --，比例是 0（不画弧也不报错）', () => {
    const { host, fill } = renderAt(undefined)
    expect(host?.textContent).toBe('--')
    expect(fill?.getAttribute('stroke-dasharray')).toBe('0.00 100')
    // 0% 打 data-empty，让 CSS 把弧藏起来（round 线帽会留一个亮点）。
    expect(host?.querySelector('.chat-meta-ring')?.hasAttribute('data-empty')).toBe(true)
  })
})

/**
 * 2026-11-11 用户：「右下角这个上下文圆环点不了，点一下要弹出一个小圆框显示明细」。
 * 这里钉住：① 圆环是按钮（能点、有无障碍语义）② 点开有明细 ③ 再点 / 点遮罩都能关
 * ④ 没有投影时给一句人话，不是 "NaN/NaN"。
 */
describe('上下文用量圆环 · 点开明细', () => {
  const withUsage = (pct: number) => render(
    <ComposerMeta {...base} contextUsage={{ pct, window: 200_000, pressure: Math.round(pct / 100 * 200_000) }} />,
  )

  it('圆环是按钮：可点、带 aria-expanded', () => {
    const { container } = withUsage(43)
    const ring = container.querySelector('.chat-meta-ctx')!
    expect(ring.tagName).toBe('BUTTON')
    expect(ring.getAttribute('aria-expanded')).toBe('false')
    expect(ring.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('点一下弹出明细：百分比 / 进度条 / 已用与剩余都在', () => {
    const { container } = withUsage(43)
    fireEvent.click(container.querySelector('.chat-meta-ctx')!)
    const dialog = screen.getByRole('dialog', { name: '上下文用量明细' })
    expect(dialog.className).toContain('chat-meta-pop')
    expect(dialog.textContent).toContain('43%')
    expect(dialog.textContent).toContain('已用 86k / 窗口 200k')
    expect(dialog.textContent).toContain('还剩 114k')
    expect(dialog.textContent).toContain('余量充足')
    // 进度条宽度 = 百分比（SVG width 属性，不是 inline style）。
    expect(dialog.querySelector('.ctx-bar-fill')?.getAttribute('width')).toBe('43')
  })

  it('再点一次圆环关闭；点卡片外面也关闭（不再铺全屏遮罩）', () => {
    const { container } = withUsage(43)
    const ring = container.querySelector('.chat-meta-ctx')!
    fireEvent.click(ring)
    expect(screen.queryByRole('dialog', { name: '上下文用量明细' })).not.toBeNull()
    // 2026-11-11 真机「整屏边缘白色留白」之后定的规则：**不再有任何全屏固定层**。
    expect(container.querySelector('.chat-picker-scrim')).toBeNull()
    fireEvent.click(ring)
    expect(screen.queryByRole('dialog', { name: '上下文用量明细' })).toBeNull()
    fireEvent.click(ring)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: '上下文用量明细' })).toBeNull()
  })

  it('点卡片里面不会关（明细要能正常看）', () => {
    const { container } = withUsage(43)
    fireEvent.click(container.querySelector('.chat-meta-ctx')!)
    const dialog = screen.getByRole('dialog', { name: '上下文用量明细' })
    fireEvent.pointerDown(dialog)
    expect(screen.queryByRole('dialog', { name: '上下文用量明细' })).not.toBeNull()
  })

  it('没有投影时给一句人话（不出现 NaN）', () => {
    const { container } = render(<ComposerMeta {...base} contextUsage={undefined} />)
    fireEvent.click(container.querySelector('.chat-meta-ctx')!)
    const dialog = screen.getByRole('dialog', { name: '上下文用量明细' })
    expect(dialog.textContent).toContain('宿主还没给上下文投影')
    expect(dialog.textContent).not.toContain('NaN')
  })
})
