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
    expect(strip.querySelector('[data-part="label"]')!.textContent).toBe('成了')
    // 2026-11-10 第二轮：完成态的改动数搬进**过程条头**（`改 N 个文件`），状态条不再重复报，
    // 元信息只剩模型 —— 同一件事全页只出现一次。
    expect(container.querySelector('.palm-strip [data-part="detail"]')).toBeNull()
    expect(container.querySelector('.palm-turn-meta')!.textContent).toBe('v4.1-flash')
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
    expect(only.textContent).toBe('12s')
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
    expect(head.textContent!.match(/成了/g) ?? []).toHaveLength(1)
    expect(head.querySelector('.palm-strip [data-part="label"]')!.textContent).toContain('成了')
  })

  it('字段缺失不崩：只给状态时只剩状态条（没有目标、时长与元信息）', () => {
    const { container } = render(<TurnHeader kind="think" />)
    expect(container.querySelector('.palm-turn-goal')).toBeNull()
    expect(container.querySelector('.palm-turn-meta')).toBeNull()
    expect(timerElements(container)).toHaveLength(0)
    // 状态条仍在（它只有 kind + label 也能画）。
    expect(container.querySelector('.palm-strip')!.getAttribute('data-kind')).toBe('think')
    expect(container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('琢磨着')
  })

  it('失败/中断各有状态词，data-kind 交给样式表上色；词只在状态条里', () => {
    const failed = render(<TurnHeader kind="failed" />)
    expect(failed.container.querySelector('.palm-turn-head')!.getAttribute('data-kind')).toBe('failed')
    expect(failed.container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('没成')
    expect(failed.container.textContent!.match(/没成/g) ?? []).toHaveLength(1)
    failed.unmount()
    const stopped = render(<TurnHeader kind="stopped" />)
    expect(stopped.container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('收了')
    expect(stopped.container.querySelector('.palm-turn-state')).toBeNull()
  })

  it('计数按千分位格式化，模型缺省不占位', () => {
    const { container } = render(<TurnHeader kind="done" changedFiles={12} testsPassed={2923} />)
    // 改动数已搬进过程条头（千分位在那里格式化），这里只验测试数在元信息行。
    expect(container.querySelector('.palm-strip [data-part="detail"]')).toBeNull()
    expect(screen.getByText('2,923 测试通过')).toBeTruthy()
  })

  it('空闲：说「闲着 · 等你发话」，右边是上一轮结束多久', () => {
    const closedAt = Date.now() - 4 * 60_000
    const { container } = render(<TurnHeader kind="idle" closedAtMs={closedAt} />)
    expect(container.querySelector('.palm-strip')!.getAttribute('data-kind')).toBe('idle')
    expect(container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('闲着')
    expect(container.querySelector('.palm-strip [data-part="detail"]')!.textContent).toBe('等你发话')
    expect(container.querySelector('[data-role="strip-time"]')!.textContent).toBe('4 分钟前')
  })

  it('完成但没改动：灰字写「未做改动」，不留空', () => {
    const { container } = render(<TurnHeader kind="done" steps={{ done: 2, total: 2 }} durationMs={4_000} />)
    expect(container.querySelector('.palm-strip [data-part="detail"]')!.textContent).toBe('未做改动')
    expect(container.querySelector('[data-role="strip-time"]')!.textContent).toBe('4s')
  })

  it('点状态条走既有 onOpen（键盘可激活的 ListRow）', () => {
    const onOpen = vi.fn()
    const { container } = render(<TurnHeader kind="done" onOpen={onOpen} />)
    fireEvent.click(container.querySelector('.palm-strip-wrap') as HTMLElement)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('formatSeconds：一分钟内是整数秒、不含小数点，更长走分秒口径', () => {
    expect(formatSeconds(12_400)).toBe('12s')
    expect(formatSeconds(3_500)).toBe('3s')
    expect(formatSeconds(999)).toBe('0s')
    expect(formatSeconds(59_999)).toBe('59s')
    expect(formatSeconds(63_400)).toBe('1分3秒')
    expect(formatSeconds(384_000)).toBe('6分24秒')
    expect(formatSeconds(0)).toBe('0s')
  })

  it('随状态条收窄：行间 6 / 上 2 / 下 4（2026-11-10 再收，贴住过程条）；目标行是次级标签，元信息回到可读层', () => {
    expect(pxToken('--palm-turn-gap')).toBe(6)
    expect(pxToken('--palm-turn-pad-t')).toBe(2)
    // 2026-11-10：10 → 4，状态条与过程条之间不再留空（用户：这两行靠近一点）。
    expect(pxToken('--palm-turn-pad-b')).toBe(4)
    // 目标行降为次级标签（2026-11-10 整屏实拍）：13px、二级前景色、常规字重；
    // 高度仍由 --palm-turn-goal-h 保证（骨架与真实头同高）。
    expect(pxToken('--palm-flow-title-size')).toBe(13)
    expect(ruleBody('.palm-turn-head')).toContain('gap: var(--palm-turn-gap)')
    expect(ruleBody('.palm-turn-head')).toContain('padding-block: var(--palm-turn-pad-t) var(--palm-turn-pad-b)')
    expect(ruleBody('.palm-turn-goal')).toContain('font-size: var(--palm-flow-title-size)')
    // 2026-11-10 重设计改判：目标行曾降成「灰字次级」，结果整屏看不出这段属于哪一轮。
    // 现在给它左侧强调竖条 + 正文色 + 加粗，但**字号不动**（仍 13px），所以不会变回
    // 「第二个标题」；高度仍由 --palm-turn-goal-h 保证。
    expect(ruleBody('.palm-turn-goal')).toContain('border-inline-start: 3px solid var(--palm-accent)')
    expect(ruleBody('.palm-turn-goal')).toContain('color: var(--palm-fg)')
    expect(ruleBody('.palm-turn-goal')).toContain('font-weight: var(--palm-w-bold)')
    // 元信息不再 10px 三级灰（低对比辅助文字），改成辅助层字号 + 二级前景色。
    expect(ruleBody('.palm-turn-meta')).toContain('font-size: var(--palm-flow-meta-size)')
    expect(ruleBody('.palm-turn-meta')).toContain('color: var(--palm-fg-2)')
  })

  it('删掉状态行后不留死样式：旧类与 --palm-flow-dot 令牌一并下线', () => {
    for (const dead of ['.palm-turn-top', '.palm-turn-dot', '.palm-turn-state', '.palm-turn-steps', '.palm-turn-time']) {
      expect(CSS.includes(dead), dead).toBe(false)
    }
    expect(mobileCss.includes('--palm-flow-dot')).toBe(false)
  })
})
