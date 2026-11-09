// @vitest-environment jsdom
/**
 * 状态条（32px 主条 + 方案 A 刻度轨）的渲染契约。
 *
 * 这里钉的是「视图不写死状态」的四件事：11 种状态都画得出宠物、进度未知时
 * 走游走块、刻度轨按步数分格、迷你版是同组件的尺寸切换。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StatusStrip, type StatusStripKind } from './status-strip.tsx'
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

describe('StatusStrip（状态胶囊 · 定版 pet-strip-v5）', () => {
  it('11 种 kind 都能渲染，各自带 kind 标记和一只内联宠物 SVG', () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<StatusStrip kind={kind} label="在做" />)
      const strip = container.querySelector(`.palm-strip[data-kind="${kind}"]`)
      expect(strip, `${kind} 没渲染出来`).not.toBeNull()
      expect(strip?.querySelector('svg.palm-strip-pet'), `${kind} 缺宠物`).not.toBeNull()
      // 宠物只有身体 + 表情零件，没有图片资源。
      expect(strip?.querySelector('image')).toBeNull()
      unmount()
    }
  })

  it('每种状态的表情形状不同（不是同一张脸换渐变）', () => {
    const shapes = new Set<string>()
    for (const kind of KINDS) {
      const { container, unmount } = render(<StatusStrip kind={kind} label="在做" />)
      const pet = container.querySelector('svg.palm-strip-pet')
      shapes.add(pet?.innerHTML ?? '')
      unmount()
    }
    // 排队无表情、思考与未知同形，其余 8 种各不同 → 至少 9 种。
    expect(shapes.size).toBeGreaterThanOrEqual(9)
  })

  it('进度未知：落 unknown 档（游走块），且不编百分比', () => {
    render(<StatusStrip kind="test" label="跑测试" detail="2,923 条" right="38s" />)
    const fill = document.querySelector('.palm-strip-fill')
    expect(fill?.getAttribute('data-fill')).toBe('unknown')
    expect(screen.getByRole('status').textContent).not.toContain('%')
  })

  it('已知进度折成 5% 档位；终态没给进度时默认铺满', () => {
    const at = (progress: number | undefined, kind: StatusStripKind = 'test'): string | null => {
      const { container, unmount } = render(<StatusStrip kind={kind} label="跑" progress={progress} />)
      const value = container.querySelector('.palm-strip-fill')?.getAttribute('data-fill') ?? null
      unmount()
      return value
    }
    expect(at(0)).toBe('p0')
    expect(at(0.42)).toBe('p40')
    expect(at(1)).toBe('p100')
    expect(at(-1)).toBe('p0')
    expect(at(2)).toBe('p100')
    expect(at(undefined, 'done')).toBe('p100')
  })

  it('刻度轨：已完成绿、当前蓝、未做灰，格数 = 总步数', () => {
    render(<StatusStrip kind="test" label="第 4 步 / 共 7 步" steps={{ done: 3, total: 7 }} />)
    const cells = Array.from(document.querySelectorAll('.palm-strip-rail i'))
    expect(cells.map(cell => cell.getAttribute('data-state')))
      .toEqual(['done', 'done', 'done', 'now', 'todo', 'todo', 'todo'])
  })

  it('终态的刻度轨没有「当前」格；拿不到步数就整条不画', () => {
    const done = render(<StatusStrip kind="done" label="完成 · 7 步" steps={{ done: 7, total: 7 }} />)
    expect(Array.from(document.querySelectorAll('.palm-strip-rail i')).map(cell => cell.getAttribute('data-state')))
      .toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done'])
    done.unmount()

    render(<StatusStrip kind="think" label="正在推理" />)
    expect(document.querySelector('.palm-strip-rail')).toBeNull()
  })

  it('mini：同组件换尺寸（data-size），只留宠物 + 主文案', () => {
    render(
      <StatusStrip
        kind="read"
        label="读文件"
        detail="ChatView.tsx"
        right="0s"
        steps={{ done: 1, total: 3 }}
        size="mini"
      />,
    )
    const wrap = document.querySelector('.palm-strip-wrap')
    const strip = document.querySelector('.palm-strip')
    expect(wrap?.getAttribute('data-size')).toBe('mini')
    expect(strip?.getAttribute('data-size')).toBe('mini')
    expect(strip?.querySelector('svg.palm-strip-pet')).not.toBeNull()
    expect(document.querySelector('[data-part="label"]')?.textContent).toBe('读文件')
    expect(document.querySelector('[data-part="detail"]')).toBeNull()
    expect(document.querySelector('[data-part="right"]')).toBeNull()
    expect(document.querySelector('.palm-strip-rail')).toBeNull()
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

describe('状态条样式契约（28px 主条 · 真机偏大）', () => {
  it('主条 28px / 圆角 10 / 宠物 18 / 主文案 11px，全部走 --palm-strip-* 令牌', () => {
    expect(pxToken('--palm-strip-h')).toBe(28)
    expect(pxToken('--palm-strip-r')).toBe(10)
    expect(pxToken('--palm-strip-pet')).toBe(18)
    expect(pxToken('--palm-strip-size')).toBe(11)
    expect(pxToken('--palm-strip-right-size')).toBeLessThanOrEqual(10)
    // 内边距也按比例收（8 → 7），不是写死在规则里。
    expect(pxToken('--palm-strip-pad')).toBe(7)
    expect(ruleBody('.palm-strip')).toContain('block-size: var(--palm-strip-h)')
    expect(ruleBody('.palm-strip')).toContain('border-radius: var(--palm-strip-r)')
    expect(ruleBody('.palm-strip-body')).toContain('padding-inline: var(--palm-strip-pad)')
    expect(ruleBody(".palm-strip [data-part='label']")).toContain('font-size: var(--palm-strip-size)')
  })

  it('刻度轨 4px、格间隙 2px（条与轨之间同步收到 5px）', () => {
    expect(pxToken('--palm-strip-rail-h')).toBe(4)
    expect(pxToken('--palm-strip-rail-gap')).toBe(2)
    expect(pxToken('--palm-strip-rail-mt')).toBe(5)
    expect(ruleBody('.palm-strip-rail')).toContain('gap: var(--palm-strip-rail-gap)')
    expect(ruleBody('.palm-strip-rail i')).toContain('block-size: var(--palm-strip-rail-h)')
    expect(ruleBody('.palm-strip-wrap')).toContain('gap: var(--palm-strip-rail-mt)')
  })

  it('迷你版（132×22 / 宠物 12 / 12px 字）不跟着缩；可点外层仍撑到 44px', () => {
    expect(pxToken('--palm-strip-mini-w')).toBe(132)
    expect(pxToken('--palm-strip-mini-h')).toBe(22)
    expect(pxToken('--palm-strip-pet-mini')).toBe(12)
    expect(ruleBody(".palm-strip[data-size='mini']")).toContain('inline-size: var(--palm-strip-mini-w)')
    expect(ruleBody(".palm-strip[data-size='mini']")).toContain('block-size: var(--palm-strip-mini-h)')
    expect(ruleBody(".palm-strip[data-size='mini'] [data-part='label']")).toContain('font-size: var(--palm-t-s)')
    // 28px 只是视觉高度：给了 onOpen 时外层是可点行，最小高度吃 --palm-hit。
    expect(pxToken('--palm-hit')).toBe(44)
    expect(ruleBody(".palm-strip-wrap[role='button']")).toContain('min-block-size: var(--palm-hit)')
  })
})
