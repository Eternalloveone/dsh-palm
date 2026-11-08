import { describe, expect, it } from 'vitest'
import { turnVerdictProps, verdictStateOf } from './turn-verdict.ts'
import type { TurnVerdictInput } from './turn-verdict.ts'
import type { RenderMessage } from '../../../projections/types.ts'

/** 造一条回合尾行（只填本域用到的字段）。 */
function turnRow(overrides: Partial<RenderMessage> = {}): RenderMessage {
  return {
    id: 't-1',
    kind: 'turn',
    text: '重构已完成，全部测试通过。',
    ...overrides,
  } as RenderMessage
}

function input(overrides: Partial<TurnVerdictInput> = {}): TurnVerdictInput {
  return { message: turnRow(), running: false, ...overrides }
}

describe('verdictStateOf（四态优先级）', () => {
  it('待决定优先于一切', () => {
    expect(verdictStateOf(input({ awaitingDecision: true, running: true }))).toBe('decision')
  })

  it('在跑 → working（就算已经有交付物）', () => {
    expect(verdictStateOf(input({ running: true, message: turnRow({ deliverables: [{ path: 'a.ts' }] }) }))).toBe('working')
  })

  it('有正文或交付物 → conclusion', () => {
    expect(verdictStateOf(input())).toBe('conclusion')
    expect(verdictStateOf(input({ message: turnRow({ text: '', deliverables: [{ path: 'a.ts' }] }) }))).toBe('conclusion')
    expect(verdictStateOf(input({ message: turnRow({ text: '', produced: ['b.ts'] }) }))).toBe('conclusion')
  })

  it('既没正文也没产物 → failed', () => {
    expect(verdictStateOf(input({ message: turnRow({ text: '   ' }) }))).toBe('failed')
  })

  it('没有尾行时不判失败（当作还没收工）', () => {
    expect(verdictStateOf(input({ message: undefined }))).toBe('working')
  })

  it('断线不算"没做成"', () => {
    expect(verdictStateOf(input({ running: true, hostLost: true }))).toBe('working')
  })
})

describe('turnVerdictProps（文案与真实数字）', () => {
  it('结论句取第一句，且截断过长句子', () => {
    const props = turnVerdictProps(input({ message: turnRow({ text: '第一步完成了。后面还有两步。' }) }))
    expect(props?.headline).toBe('第一步完成了。')
  })

  it('过长的第一句会被截断并加省略号', () => {
    const long = `${'很长的句子'.repeat(20)}。`
    const props = turnVerdictProps(input({ message: turnRow({ text: long }) }))
    expect(props?.headline.endsWith('…')).toBe(true)
    expect((props?.headline ?? '').length).toBeLessThanOrEqual(49)
  })

  it('耗时进大号数字：一位小数的秒（对照稿 12.4s）', () => {
    const props = turnVerdictProps(input({ message: turnRow({ durationMs: 12_400 }) }))
    expect(props?.stats).toEqual([{ value: '12.4s', label: '耗时' }])
    const whole = turnVerdictProps(input({ message: turnRow({ durationMs: 8_000 }) }))
    expect(whole?.stats).toEqual([{ value: '8s', label: '耗时' }])
    const none = turnVerdictProps(input({ message: turnRow({ durationMs: undefined }) }))
    expect(none?.stats).toBeUndefined()
  })

  it('工具次数由调用方数出来：进大号数字与 chip-info，拿不到就两项都不出现', () => {
    const withTools = turnVerdictProps(input({ message: turnRow({ durationMs: 5_000 }), tools: 9 }))
    expect(withTools?.stats).toEqual([{ value: '5s', label: '耗时' }, { value: '9', label: '工具' }])
    expect(withTools?.chips).toEqual([{ label: '9 次工具', tone: 'info' }])

    const unknown = turnVerdictProps(input({ message: turnRow({ durationMs: 5_000 }) }))
    expect(unknown?.stats).toEqual([{ value: '5s', label: '耗时' }])
    expect(unknown?.chips).toBeUndefined()
  })

  it('交付物 + 产出文件合成「文件」数字与 chip-ok；缺的整项省略', () => {
    const props = turnVerdictProps(input({
      message: turnRow({ deliverables: [{ path: 'a.ts' }, { path: 'b.ts' }], produced: ['c.ts'] }),
    }))
    expect(props?.stats).toEqual([{ value: '3', label: '文件' }])
    expect(props?.chips).toEqual([{ label: '3 个文件', tone: 'ok' }])

    const neither = turnVerdictProps(input({ message: turnRow({ text: '说完了' }) }))
    expect(neither?.stats).toBeUndefined()
    expect(neither?.chips).toBeUndefined()
  })

  it('输出被截断 / 回复失败进 chip-warn（真发生了才出现）', () => {
    const truncated = turnVerdictProps(input({ message: turnRow({ maxTokens: true }) }))
    expect(truncated?.chips).toEqual([{ label: '输出被截断', tone: 'warn' }])
    const failed = turnVerdictProps(input({ message: turnRow({ failed: true }) }))
    expect(failed?.chips).toEqual([{ label: '本次回复失败', tone: 'warn' }])
  })

  it('running 态解释"结果出来后替换这张卡"；断线时说连接问题', () => {
    expect(turnVerdictProps(input({ running: true }))?.detail).toContain('结果出来后替换')
    expect(turnVerdictProps(input({ running: true, hostLost: true }))?.detail).toContain('连接断开')
  })

  it('failed 态给可重试的主操作', () => {
    const onRun = () => {}
    const props = turnVerdictProps(input({ message: turnRow({ text: '' }), primaryAction: { label: '重试', onRun } }))
    expect(props?.state).toBe('failed')
    expect(props?.actions?.[0]).toMatchObject({ label: '重试', primary: true })
  })

  it('decision 态只在给了主操作时才带动作', () => {
    expect(turnVerdictProps(input({ awaitingDecision: true }))?.actions).toBeUndefined()
    const withAction = turnVerdictProps(input({ awaitingDecision: true, primaryAction: { label: '去看看', onRun: () => {} } }))
    expect(withAction?.actions?.[0]?.label).toBe('去看看')
  })

  it('绝不编造工具次数或 token（拿不到就不给）', () => {
    const props = turnVerdictProps(input({ message: turnRow({ durationMs: 5_000, produced: ['a.ts'] }) }))
    expect(props?.stats).toEqual([{ value: '5s', label: '耗时' }, { value: '1', label: '文件' }])
    expect(JSON.stringify(props)).not.toContain('token')
    expect(JSON.stringify(props)).not.toContain('%')
  })
})
