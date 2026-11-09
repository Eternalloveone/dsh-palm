// @vitest-environment jsdom
/**
 * 任务头的渲染契约（会话正文流第一块，版式真源 overview.html「2 · 会话正文」）：
 * 1. 四行固定顺序：状态行（点 + 词 + 步数 + 耗时）→ 目标 → 状态条 → 元信息；
 * 2. 拿不到的字段不出现（没有目标/耗时/测试数就不画那一行，不补占位）；
 * 3. 终态（失败/中断）用各自的状态词，颜色由 data-kind 交给样式表；
 * 4. 计数按千分位格式化；状态条的点击走既有 onOpen。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnHeader, formatSeconds } from './turn-header.tsx'
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

describe('TurnHeader（回合任务头）', () => {
  it('四行齐全：状态点+状态词+步数+耗时 / 目标 / 状态条 / 元信息', () => {
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
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('已完成')
    expect(container.querySelector('.palm-turn-steps')!.textContent).toBe('· 7 步 / 7 步')
    expect(container.querySelector('.palm-turn-time')!.textContent).toBe('12.4s')
    expect(container.querySelector('.palm-turn-goal')!.textContent).toContain('6/11')
    expect(container.querySelector('.palm-strip')!.getAttribute('data-kind')).toBe('done')
    expect(container.querySelector('.palm-turn-meta')!.textContent).toBe('改 12 个文件 · v4.1-flash')
  })

  it('字段缺失不崩：只给状态时只剩状态行 + 状态条', () => {
    const { container } = render(<TurnHeader kind="think" />)
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('思考中')
    expect(container.querySelector('.palm-turn-goal')).toBeNull()
    expect(container.querySelector('.palm-turn-time')).toBeNull()
    expect(container.querySelector('.palm-turn-steps')).toBeNull()
    expect(container.querySelector('.palm-turn-meta')).toBeNull()
    // 状态条仍在（它只有 kind + label 也能画）。
    expect(container.querySelector('.palm-strip')).not.toBeNull()
  })

  it('失败/中断各有状态词，data-kind 交给样式表上色', () => {
    const failed = render(<TurnHeader kind="failed" />)
    expect(failed.container.querySelector('.palm-turn-state')!.textContent).toBe('失败')
    expect(failed.container.querySelector('.palm-turn-head')!.getAttribute('data-kind')).toBe('failed')
    failed.unmount()
    const stopped = render(<TurnHeader kind="stopped" />)
    expect(stopped.container.querySelector('.palm-turn-state')!.textContent).toBe('已中断')
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
})
