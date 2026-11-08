/**
 * 插入队列状态层：只测纯函数（身份、回执、去抖、摘要）。
 *
 * 这些用例对应真机上的两类症状：
 *  - 「输入框上方的插入条莫名消失/出现」→ missing 不删、回执才删、去抖与最短可见；
 *  - 「同一件事出现两行」→ 身份去重 + 同轮 agent/job 合并成一条摘要。
 */
import { describe, expect, it } from 'vitest'
import {
  INSERT_HIDE_CONFIRM_MS,
  INSERT_MIN_VISIBLE_MS,
  insertSourceOfKind,
  mergeInserts,
  normalizeInsertText,
  observeInsertPresence,
  summarizeInserts,
  visibleInserts,
  type InsertEntry,
  type InsertVisibility,
} from './insert-queue.ts'

function entry(
  id: string,
  turnNo = 1,
  source: InsertEntry['source'] = 'user',
  at = 0,
  text = id,
): InsertEntry {
  return { id, turnNo, source, text, at }
}

/** 第一次观察：条目都在，建立最短可见的起点。 */
function shown(entries: readonly InsertEntry[], present: readonly string[], now: number): InsertVisibility {
  return observeInsertPresence(undefined, entries, present, now)
}

describe('mergeInserts：按 id 并集，回执才删', () => {
  it('并集保留：新旧两侧的条目都在（不是后一份覆盖前一份）', () => {
    const prev = [entry('a')]
    const next = [entry('b')]
    expect(mergeInserts(prev, next).map(item => item.id)).toEqual(['a', 'b'])
  })

  it('missing 不删：宿主快照里看不到，条目仍然保留', () => {
    const prev = [entry('a'), entry('b')]
    expect(mergeInserts(prev, []).map(item => item.id)).toEqual(['a', 'b'])
  })

  it('只有 consumedIds / withdrawnIds 回执才移除', () => {
    const prev = [entry('a'), entry('b')]
    const next = [entry('a'), entry('b')]
    expect(mergeInserts(prev, next, { consumedIds: ['a'] }).map(item => item.id)).toEqual(['b'])
    expect(mergeInserts(prev, next, { withdrawnIds: ['b'] }).map(item => item.id)).toEqual(['a'])
    expect(mergeInserts(prev, next, { consumedIds: ['a'], withdrawnIds: ['b'] })).toEqual([])
  })

  it('同 id 重复事件幂等：同一身份只留一条', () => {
    const first = entry('a')
    const repeated = [entry('a'), entry('a'), entry('a')]
    expect(mergeInserts([first], repeated).map(item => item.id)).toEqual(['a'])
    expect(mergeInserts(repeated, repeated)).toHaveLength(1)
  })

  it('去重键是 (turnNo, source, id)：同 id 不同来源是两条，不会互相吞掉', () => {
    const user = entry('same', 1, 'user')
    const agent = entry('same', 1, 'agent')
    expect(mergeInserts([user], [agent]).map(item => `${item.source}:${item.id}`)).toEqual([
      'user:same',
      'agent:same',
    ])
  })

  it('乱序事件不丢条目，迟到的旧轮事件也不会把新轮挤掉', () => {
    const prev = [entry('a', 2), entry('b', 2)]
    const outOfOrder = [entry('c', 2), entry('a', 2), entry('stale', 1)]
    expect(mergeInserts(prev, outOfOrder).map(item => item.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('turnNo 变大只保留新轮（旧轮整体退场）', () => {
    const oldTurn = [entry('a', 3), entry('b', 3)]
    const newTurn = [entry('c', 4)]
    expect(mergeInserts(oldTurn, newTurn).map(item => item.id)).toEqual(['c'])
    // 下一拍新轮里没有 c（宿主慢半拍）：c 仍然保留，不能因为快照空就消失。
    expect(mergeInserts([entry('c', 4)], []).map(item => item.id)).toEqual(['c'])
  })

  it('快速连插 10 条：全部保留，不去重丢失', () => {
    const burst = Array.from({ length: 10 }, (_, index) => entry(`burst-${index}`, 1, 'user', index))
    const merged = mergeInserts([], burst)
    expect(merged).toHaveLength(10)
    expect(new Set(merged.map(item => item.id)).size).toBe(10)
  })
})

describe('visibleInserts：去抖 2 次确认 + 最短可见 800ms', () => {
  it('出现立即显示；第一次 missing 仍显示（只确认了 1 次）', () => {
    const items = [entry('a')]
    let visibility = shown(items, ['a'], 0)
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, 0).map(item => item.id)).toEqual(['a'])
    visibility = observeInsertPresence(visibility, items, [], 100)
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, 100).map(item => item.id)).toEqual(['a'])
  })

  it('连续 2 次确认且跨过去抖窗口才消失', () => {
    const items = [entry('a')]
    let visibility = shown(items, ['a'], 0)
    visibility = observeInsertPresence(visibility, items, [], 100)
    visibility = observeInsertPresence(visibility, items, [], 200)
    // 第 2 次确认在 200ms：距第一次缺失只有 100ms，仍被 600ms 窗口挡住。
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, 200)).toHaveLength(1)
    // 700ms 时去抖窗口已过，但最短可见（800ms）仍在兜底，所以还显示。
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, INSERT_HIDE_CONFIRM_MS + 100)).toHaveLength(1)
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, INSERT_MIN_VISIBLE_MS)).toEqual([])
  })

  it('最短可见 800ms：去抖已满足也不能提前消失', () => {
    const items = [entry('a')]
    let visibility = shown(items, ['a'], 0)
    visibility = observeInsertPresence(visibility, items, [], 0)
    visibility = observeInsertPresence(visibility, items, [], 10)
    // 2 次确认已满足、600ms 窗口也过了，但还没到 800ms。
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, 799)).toHaveLength(1)
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, INSERT_MIN_VISIBLE_MS)).toEqual([])
  })

  it('再次出现立即恢复：missingCount 清零，不用等去抖', () => {
    const items = [entry('a')]
    let visibility = shown(items, ['a'], 0)
    visibility = observeInsertPresence(visibility, items, [], 100)
    visibility = observeInsertPresence(visibility, items, [], 200)
    visibility = observeInsertPresence(visibility, items, ['a'], 300)
    expect(visibleInserts({ entries: items, turnNo: 1, ...visibility }, 300).map(item => item.id)).toEqual(['a'])
  })
})

describe('summarizeInserts：同轮 agent/job 合并成一条摘要', () => {
  it('按 source 分组给出计数与明细', () => {
    const summary = summarizeInserts([
      entry('u', 1, 'user'),
      entry('a', 1, 'agent'),
      entry('j', 1, 'job'),
    ])
    expect(summary.total).toBe(3)
    expect(summary.groups.map(group => [group.source, group.label, group.count])).toEqual([
      ['user', '你', 1],
      ['agent', '智能体', 1],
      ['job', '后台任务', 1],
    ])
    expect(summary.entries).toHaveLength(3)
  })

  it('agent 与 job 两类来源共用一个标题（不会画成两行）', () => {
    const summary = summarizeInserts([
      entry('a', 1, 'agent', 0, 'Agent 完成'),
      entry('j', 1, 'job', 1, 'Background subagent 完成'),
    ])
    expect(summary.title).toBe('已插入 2 条补充消息')
    expect(summary.title.includes('\n')).toBe(false)
    expect(summary.groups.map(group => group.source)).toEqual(['agent', 'job'])
  })

  it('空队列不出摘要', () => {
    const summary = summarizeInserts([])
    expect(summary.total).toBe(0)
    expect(summary.title).toBe('')
    expect(summary.groups).toEqual([])
    expect(summary.entries).toEqual([])
  })
})

describe('来源分类与正文归一', () => {
  it('user / agent / job 按宿主 source.kind 归类，看不见的注入不占摘要', () => {
    expect(insertSourceOfKind(undefined)).toBe('user')
    expect(insertSourceOfKind('user')).toBe('user')
    expect(insertSourceOfKind('agent-message')).toBe('agent')
    expect(insertSourceOfKind('team-message')).toBe('agent')
    expect(insertSourceOfKind('subagent-settled')).toBe('job')
    expect(insertSourceOfKind('tool-jobs')).toBe('job')
    expect(insertSourceOfKind('runtime-context')).toBeUndefined()
    expect(insertSourceOfKind('compact-checkpoint')).toBeUndefined()
  })

  it('正文归一折叠空白：同一句话的两种排版是同一个本地乐观项', () => {
    expect(normalizeInsertText('  已插入\n本轮  ')).toBe('已插入 本轮')
  })
})
