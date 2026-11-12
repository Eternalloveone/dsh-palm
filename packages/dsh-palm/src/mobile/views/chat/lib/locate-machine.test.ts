/**
 * 定位状态机测试。
 *
 * 最重要的一条在文件末尾：**`waiting-data` 不可达 `not-found`**。
 * 它把「首屏没数据就判失败、然后沉到会话底部」这个真机 bug 变成结构上不可能。
 */
import { describe, expect, it } from 'vitest'
import { stepLocate, decideMiss, type LocateInput, type LocatePhase } from './locate-machine.ts'

const base = (patch: Partial<LocateInput> = {}): LocateInput => ({
  rows: [],
  anchor: { kind: 'message', id: 'm-1' },
  hasOlder: false,
  pending: false,
  attempts: 0,
  maxAttempts: 6,
  query: '',
  ...patch,
})

const row = (id: string, text: string, extra: { turn?: number; step?: number } = {}) => ({ id, text, ...extra })

describe('waiting-data：只等，不判失败', () => {
  it('一行都没有时动作是 wait，状态仍是 waiting-data', () => {
    const step = stepLocate({ kind: 'waiting-data' }, base())
    expect(step.state.kind).toBe('waiting-data')
    expect(step.action).toEqual({ type: 'wait' })
  })

  it('一行都没有、且已经没有更早历史：**仍然不放弃**', () => {
    // 这就是 2026-11-12 真机那个 bug 的形状：rows=0 且 hasOlder=false，
    // 旧代码直接 give-up 并锁死闸门，数据随后到达也不再定位。
    const step = stepLocate({ kind: 'waiting-data' }, base({ hasOlder: false, attempts: 99 }))
    expect(step.action.type).not.toBe('give-up')
    expect(step.state.kind).toBe('waiting-data')
  })
})

describe('有数据之后的寻路', () => {
  it('messageId 命中 → ready', () => {
    const step = stepLocate({ kind: 'waiting-data' }, base({ rows: [row('a', '别的'), row('m-1', '目标')] }))
    expect(step.state).toEqual({ kind: 'ready', rowIndex: 1 })
  })

  it('turn/step 命中 → ready（合并后 id 对不上也能找到）', () => {
    const input = base({ anchor: { kind: 'turn-step', turn: 12, step: 3 }, rows: [row('a', 'x', { turn: 12, step: 3 })] })
    const step = stepLocate({ kind: 'waiting-data' }, input)
    expect(step.state).toEqual({ kind: 'ready', rowIndex: 0 })
  })

  it('seq 锚点按「第一个 seq >= 目标」找', () => {
    const rows = [
      { id: 'a', text: 'x', seq: 10 },
      { id: 'b', text: 'y', seq: 20 },
    ]
    const step = stepLocate({ kind: 'waiting-data' }, base({ anchor: { kind: 'seq', seq: 15 }, rows }))
    expect(step.state).toEqual({ kind: 'ready', rowIndex: 1 })
  })

  it('找不到但有更早历史 → need-page，带跳页游标', () => {
    const step = stepLocate({ kind: 'waiting-data' }, base({ anchor: { kind: 'seq', seq: 42 }, rows: [row('a', 'x')], hasOlder: true }))
    expect(step.state.kind).toBe('need-page')
    expect(step.action).toEqual({ type: 'fetch', jump: 43 })
  })

  it('翻页请求在飞时不重复发', () => {
    const step = stepLocate({ kind: 'need-page' }, base({ rows: [row('a', 'x')], hasOlder: true, pending: true }))
    expect(step.action).toEqual({ type: 'wait' })
  })

  it('翻完仍找不到 → not-found + give-up', () => {
    const step = stepLocate({ kind: 'need-page' }, base({ rows: [row('a', 'x')], hasOlder: false }))
    expect(step.state).toEqual({ kind: 'not-found', reason: 'exhausted' })
    expect(step.action).toEqual({ type: 'give-up', reason: 'exhausted' })
  })

  it('预算耗尽也算翻完（不会无限翻）', () => {
    const step = stepLocate({ kind: 'need-page' }, base({ rows: [row('a', 'x')], hasOlder: true, attempts: 6 }))
    expect(step.state.kind).toBe('not-found')
  })
})

describe('关键词兜底只在翻完之后', () => {
  it('还有历史时不走关键词兜底（否则会落到更早的同词消息上）', () => {
    const step = stepLocate({ kind: 'waiting-data' }, base({
      anchor: { kind: 'query', term: '排队' },
      rows: [row('old', '更早的排队消息')],
      hasOlder: true,
      query: '排队',
    }))
    expect(step.state.kind).toBe('need-page')
  })

  it('历史翻完了才按关键词落点', () => {
    const step = stepLocate({ kind: 'waiting-data' }, base({
      anchor: { kind: 'query', term: '排队' },
      rows: [row('old', '更早的排队消息')],
      hasOlder: false,
      query: '排队',
    }))
    expect(step.state).toEqual({ kind: 'ready', rowIndex: 0 })
  })
})

describe('ready → landed 与终态', () => {
  it('ready 一步落到 landed 并给出 land 动作', () => {
    const step = stepLocate({ kind: 'ready', rowIndex: 3 }, base())
    expect(step.state).toEqual({ kind: 'landed', rowIndex: 3 })
    expect(step.action).toEqual({ type: 'land', rowIndex: 3 })
  })

  it('landed 之后不再动作（一次性意图）', () => {
    const step = stepLocate({ kind: 'landed', rowIndex: 3 }, base({ rows: [row('a', 'x')] }))
    expect(step.action).toEqual({ type: 'wait' })
    expect(step.state).toEqual({ kind: 'landed', rowIndex: 3 })
  })

  it('没有意图时 idle 保持不动', () => {
    const step = stepLocate({ kind: 'idle' }, base({ anchor: undefined }))
    expect(step.state.kind).toBe('idle')
    expect(step.action).toEqual({ type: 'wait' })
  })
})

describe('decideMiss：无状态版（组件重挂载也不影响）', () => {
  const miss = (patch: Partial<Parameters<typeof decideMiss>[0]> = {}) => decideMiss({
    rows: 10,
    hasOlder: true,
    attempts: 0,
    maxAttempts: 6,
    pending: false,
    jumped: false,
    ...patch,
  })

  it('一行都没有 → wait（不是 give-up）', () => {
    // 这就是 ChatView 里那个真机 bug 的形状：首屏数据没到，旧代码直接判死。
    expect(miss({ rows: 0 })).toEqual({ type: 'wait' })
    expect(miss({ rows: 0, hasOlder: false, attempts: 99 })).toEqual({ type: 'wait' })
  })

  it('有更早历史、没跳过 → 直跳目标页', () => {
    expect(miss({ jumpSeq: 5 })).toEqual({ type: 'fetch', jump: 6 })
  })

  it('跳过之后再找不到 → 普通翻页（不再重复跳同一页）', () => {
    expect(miss({ jumpSeq: 5, jumped: true })).toEqual({ type: 'fetch' })
  })

  it('没有目标 seq → 普通翻页', () => {
    expect(miss()).toEqual({ type: 'fetch' })
  })

  it('翻页请求在飞 → wait（不重复发、不烧预算）', () => {
    expect(miss({ pending: true })).toEqual({ type: 'wait' })
    expect(miss({ pending: true, jumpSeq: 5 })).toEqual({ type: 'wait' })
  })

  it('历史翻完 → give-up', () => {
    expect(miss({ hasOlder: false })).toEqual({ type: 'give-up', reason: 'exhausted' })
  })

  it('预算耗尽也算翻完', () => {
    expect(miss({ attempts: 6 })).toEqual({ type: 'give-up', reason: 'exhausted' })
  })

  it('不变量：rows=0 永不给 give-up（穷举）', () => {
    let visited = 0
    for (const hasOlder of [true, false]) {
      for (const attempts of [0, 3, 6, 99]) {
        for (const pending of [true, false]) {
          for (const jumped of [true, false]) {
            for (const jumpSeq of [undefined, 5]) {
              visited += 1
              expect(decideMiss({ rows: 0, hasOlder, attempts, maxAttempts: 6, pending, jumped, jumpSeq }).type).not.toBe('give-up')
            }
          }
        }
      }
    }
    expect(visited).toBe(64)
  })
})

describe('带 state 版的不变量：没有数据时不可达 not-found', () => {
  it('穷举「rows 为空」的所有输入组合，都不会跳到 not-found', () => {
    // 真机 bug 的根因是「空数据被当成没找到」。这里把**空窗口**下的输入空间铺开跑一遍：
    // 只要有一个组合能让 waiting-data 在 rows=[] 时进入 not-found，这个测试就红。
    //
    // 注意不变量说的是「没有行数据时」，不是「waiting-data 永远不失败」：
    // 手里有行、但目标不在其中且历史也翻完了，那是**有证据的**找不到，允许 not-found。
    const anchors = [
      { kind: 'message', id: 'm' } as const,
      { kind: 'turn-step', turn: 1 } as const,
      { kind: 'seq', seq: 5 } as const,
      { kind: 'query', term: 'x' } as const,
    ]
    let visited = 0
    for (const anchor of anchors) {
      for (const hasOlder of [true, false]) {
        for (const pending of [true, false]) {
          for (const attempts of [0, 3, 6, 99]) {
            const from: LocatePhase = { kind: 'waiting-data' }
            const next = stepLocate(from, base({ anchor, rows: [], hasOlder, pending, attempts, query: 'x' })).state
            visited += 1
            expect(next.kind).not.toBe('not-found')
            expect(next.kind).toBe('waiting-data')
          }
        }
      }
    }
    expect(visited).toBe(4 * 2 * 2 * 4)
  })

  it('对照：有行但目标不在、历史也翻完，允许 not-found（这是有证据的失败）', () => {
    const step = stepLocate({ kind: 'waiting-data' }, base({ rows: [row('a', '别的')], hasOlder: false }))
    expect(step.state).toEqual({ kind: 'not-found', reason: 'exhausted' })
  })
})
