// @vitest-environment jsdom
/**
 * 任务头的渲染契约（会话正文流第一块，版式真源 overview.html「2 · 会话正文」）：
 * 1. 三行固定顺序：目标 → 状态条 → 元信息（顶部「状态点 + 状态词 + 步数 + 耗时」已删除）；
 * 2. **状态词与计时只出现在状态条**：任务头里不带时间文本的元素只有一个
 *    （`[data-role="strip-time"]`），状态词也只出现一次；
 * 3. 拿不到的字段不出现（没有目标/耗时/测试数就不画那一行，不补占位）；
 * 4. 计数按千分位格式化；状态条的点击走既有 onOpen；
 * 5. 已删除那一行的 CSS（`.palm-turn-top/-dot/-state/-steps/-time` 与
 *    `--palm-flow-dot`）同步下线，样式表里不许留死规则。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnHeader, formatSeconds } from './turn-header.tsx'
import { mobileCss } from '../mobile-styles.ts'

afterEach(() => { cleanup() })

/** 计时口径（与真机复核一致）：分秒 / 秒 / mm:ss。 */
const TIMER = /\d+分\d+秒|\d+(\.\d+)?s|\d{2}:\d{2}/

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

/** 匹配计时口径的元素（只看最内层：有子元素的容器不算）。 */
function timerElements(root: ParentNode): Element[] {
  return [...root.querySelectorAll('*')].filter(element => element.children.length === 0 && TIMER.test(element.textContent ?? ''))
}

describe('TurnHeader（回合任务头）', () => {
  it('三行：目标 / 状态条 / 元信息；顶部状态行（点 + 词 + 步数 + 耗时）已删除', () => {
    const { container } = render(
      <TurnHeader
        kind="done"
        steps={{ done: 7, total: 7 }}
        durationMs={12_400}
        goal="让消息链接跳转的命中率从 6/11 提到 9/11"
        changedFiles={12}
        model="v4.1-flash"
      />,
    )
    const head = container.querySelector('.palm-turn-head')!
    // 行序 = 目标 → 状态条 → 元信息；没有第 0 行状态行。
    expect([...head.children].map(child => child.className)).toEqual(['palm-turn-goal', 'palm-strip-wrap', 'palm-turn-meta'])
    for (const dead of ['.palm-turn-top', '.palm-turn-dot', '.palm-turn-state', '.palm-turn-steps', '.palm-turn-time']) {
      expect(container.querySelector(dead), dead).toBeNull()
    }
    expect(container.querySelector('.palm-turn-goal')!.textContent).toContain('6/11')
    const strip = container.querySelector('.palm-strip')!
    expect(strip.getAttribute('data-kind')).toBe('done')
    expect(strip.querySelector('[data-part="label"]')!.textContent).toBe('完成 · 7 步')
    expect(container.querySelector('.palm-turn-meta')!.textContent).toBe('改 12 个文件 · v4.1-flash')
  })

  it('计时只出现在状态条：整头恰好一个计时元素，且带 data-role="strip-time"', () => {
    const { container } = render(
      <TurnHeader kind="done" steps={{ done: 7, total: 7 }} durationMs={12_400} goal="修首帧跳变" changedFiles={3} testsPassed={20} />,
    )
    const timers = timerElements(container)
    expect(timers).toHaveLength(1)
    const only = timers[0]!
    expect(only.getAttribute('data-role')).toBe('strip-time')
    expect(only.closest('.palm-strip')).not.toBeNull()
    expect(only.textContent).toBe('12.4s')
    // 旧状态行的耗时元素不复存在（也不存在第二个计时元素）。
    expect(container.querySelector('.palm-turn-time')).toBeNull()
    expect(container.querySelectorAll('[data-role="strip-time"]')).toHaveLength(1)
  })

  it('状态词只出现一次，且在状态条里；长状态词（已完成/思考中/可能卡住了）不再出现', () => {
    const { container } = render(
      <TurnHeader kind="done" steps={{ done: 7, total: 7 }} durationMs={12_400} goal="修首帧跳变" changedFiles={3} />,
    )
    const head = container.querySelector('.palm-turn-head')!
    for (const word of ['已完成', '思考中', '可能卡住了', '深度求索中']) {
      expect(head.textContent, word).not.toContain(word)
    }
    // 状态条文案是这一屏唯一的状态词。
    expect(head.textContent!.match(/完成/g) ?? []).toHaveLength(1)
    expect(head.querySelector('.palm-strip [data-part="label"]')!.textContent).toContain('完成')
  })

  it('字段缺失不崩：只给状态时只剩状态条（没有目标、时长与元信息）', () => {
    const { container } = render(<TurnHeader kind="think" />)
    expect(container.querySelector('.palm-turn-goal')).toBeNull()
    expect(container.querySelector('.palm-turn-meta')).toBeNull()
    expect(timerElements(container)).toHaveLength(0)
    // 状态条仍在（它只有 kind + label 也能画）。
    expect(container.querySelector('.palm-strip')!.getAttribute('data-kind')).toBe('think')
    expect(container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('思考')
  })

  it('失败/中断各有状态词，data-kind 交给样式表上色；词只在状态条里', () => {
    const failed = render(<TurnHeader kind="failed" />)
    expect(failed.container.querySelector('.palm-turn-head')!.getAttribute('data-kind')).toBe('failed')
    expect(failed.container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('失败')
    expect(failed.container.textContent!.match(/失败/g) ?? []).toHaveLength(1)
    failed.unmount()
    const stopped = render(<TurnHeader kind="stopped" />)
    expect(stopped.container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('已中断')
    expect(stopped.container.querySelector('.palm-turn-state')).toBeNull()
  })

  it('计数按千分位格式化，模型缺省不占位', () => {
    render(<TurnHeader kind="done" changedFiles={12} testsPassed={2923} />)
    expect(screen.getByText('改 12 个文件 · 2,923 测试通过')).toBeTruthy()
  })

  it('点状态条走既有 onOpen（键盘可激活的 ListRow）', () => {
    const onOpen = vi.fn()
    const { container } = render(<TurnHeader kind="done" onOpen={onOpen} />)
    fireEvent.click(container.querySelector('.palm-strip-wrap') as HTMLElement)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('formatSeconds：一分钟内保留一位小数，更长走分秒口径', () => {
    expect(formatSeconds(12_400)).toBe('12.4s')
    expect(formatSeconds(63_400)).toBe('1分3秒')
    expect(formatSeconds(384_000)).toBe('6分24秒')
    expect(formatSeconds(0)).toBe('0s')
  })

  it('随 28px 状态条收窄：行间 6 / 上 2 / 下 10、元信息 10px；目标行 15px 不动', () => {
    expect(pxToken('--palm-turn-gap')).toBe(6)
    expect(pxToken('--palm-turn-pad-t')).toBe(2)
    expect(pxToken('--palm-turn-pad-b')).toBe(10)
    expect(pxToken('--palm-turn-meta-size')).toBe(10)
    // 目标行是这一轮的主信息：字号保持 15px（只钉最小行高给骨架占位共用）。
    expect(pxToken('--palm-flow-goal-size')).toBe(15)
    expect(ruleBody('.palm-turn-head')).toContain('gap: var(--palm-turn-gap)')
    expect(ruleBody('.palm-turn-head')).toContain('padding-block: var(--palm-turn-pad-t) var(--palm-turn-pad-b)')
    expect(ruleBody('.palm-turn-meta')).toContain('font-size: var(--palm-turn-meta-size)')
    expect(ruleBody('.palm-turn-goal')).toContain('font-size: var(--palm-flow-goal-size)')
  })

  it('删掉状态行后不留死样式：旧类与 --palm-flow-dot 令牌一并下线', () => {
    for (const dead of ['.palm-turn-top', '.palm-turn-dot', '.palm-turn-state', '.palm-turn-steps', '.palm-turn-time']) {
      expect(CSS.includes(dead), dead).toBe(false)
    }
    expect(mobileCss.includes('--palm-flow-dot')).toBe(false)
  })
})
