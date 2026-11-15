/**
 * 交付账本的契约。
 *
 * 钉住四条承诺：
 *  1. 折叠结果稳定（同一批行折两次结果一样）；
 *  2. 噪声（日志/补丁脚本）不产生有效交付；
 *  3. 合并**只追加不回退** —— 补页/重排不会让某一轮的卡回到旧值再变新；
 *  4. 身份是 `sessionId#turn`：两场都用同一个 turn 号也不许互相覆盖/互相读到
 *     （真机 2026-11-14 的幽灵交付卡就串在"裸 turn 号"这个弱身份上）。
 */
import { describe, expect, it } from 'vitest'
import { collectDeliveries, latestDeliveryOf, mergeDeliveries, turnKeyOf } from './deliveries.ts'

/** 造一条带 diff 的 assistant 行（id 唯一：dedupeById 会按 id 去重）。 */
let seq = 0
const row = (turn: number | undefined, diffs: Array<{ path: string; newText: string; oldText?: string | null }>) => {
  seq += 1
  return ({
    id: `a-${turn}-${seq}`,
    kind: 'assistant',
    text: '',
    ...(turn === undefined ? {} : { turn }),
    tools: [{ callId: `c${seq}`, name: 'edit', state: 'ok', view: { diffs } }],
  }) as never
}

/** 造一条 turn 收尾行（带 produced）。 */
const tail = (turn: number, produced: string[]) => ({
  id: `turn-tail:${turn}`,
  kind: 'turn',
  text: '',
  turn,
  produced,
}) as never

/** 默认用一个会话折账本。 */
const fold = (rows: ReturnType<typeof row>[], sessionId = 's1') => collectDeliveries(sessionId, rows)

describe('collectDeliveries（折叠成账本）', () => {
  it('按轮聚合改动，同一文件取最大的一次（最终形态）', () => {
    const small = fold([row(1, [{ path: 'a.ts', newText: 'one\n' }])])
    const large = fold([row(1, [{ path: 'a.ts', newText: 'one\ntwo\nthree\nfour\nfive\nsix\n' }])])
    const records = fold([
      row(1, [{ path: 'a.ts', newText: 'one\n' }]),
      row(1, [{ path: 'a.ts', newText: 'one\ntwo\nthree\nfour\nfive\nsix\n' }]),
      row(1, [{ path: 'b.ts', newText: 'x\n' }]),
    ])
    expect(records).toHaveLength(1)
    expect(records[0]?.turn).toBe(1)
    const a = records[0]?.changes.find(change => change.path === 'a.ts')
    // 取两次写入里较大的那次（最终形态），不是累加。
    expect(a?.adds).toBe(Math.max(small[0]?.changes[0]?.adds ?? 0, large[0]?.changes[0]?.adds ?? 0))
    expect(records[0]?.changes.find(change => change.path === 'b.ts')?.path).toBe('b.ts')
  })

  it('每条记录都带归属会话', () => {
    expect(fold([row(1, [{ path: 'a.ts', newText: 'x\n' }])], 's9')[0]?.sessionId).toBe('s9')
  })

  it('收尾行的产出文件进 presented', () => {
    const records = fold([tail(3, ['report.md', 'chart.png'])])
    expect(records[0]?.presented.map(file => file.path)).toEqual(['report.md', 'chart.png'])
    expect(records[0]?.meaningful).toBe(true)
  })

  it('全是噪声（日志 + 补丁脚本）的轮次不 meaningful', () => {
    const records = fold([
      row(2, [{ path: '/tmp/run.log', newText: 'x\n' }]),
      tail(2, ['D:\\work\\patch.mjs']),
    ])
    expect(records[0]?.meaningful).toBe(false)
  })

  it('没有 turn 号的行不贡献任何记录', () => {
    expect(fold([row(undefined, [{ path: 'a.ts', newText: 'x\n' }])])).toHaveLength(0)
  })

  it('折叠是纯函数：同一批行折两次结果一致', () => {
    const rows = [row(1, [{ path: 'a.ts', newText: 'x\n' }]), tail(1, ['a.ts'])]
    expect(fold(rows)).toEqual(fold(rows))
  })
})

describe('latestDeliveryOf（哪一轮出卡）', () => {
  it('取最后一条 meaningful，跳过纯噪声轮次', () => {
    const records = fold([
      row(1, [{ path: 'src/a.ts', newText: 'x\n' }]),
      row(2, [{ path: '/tmp/x.log', newText: 'x\n' }]),
    ])
    expect(latestDeliveryOf(records, 's1')?.turn).toBe(1)
  })

  it('没有可展示的交付时返回 undefined', () => {
    expect(latestDeliveryOf(fold([tail(9, ['/tmp/a.log'])]), 's1')).toBeUndefined()
  })

  it('只认本场：别的会话的记录（就算轮号一样）不进卡面', () => {
    const records = fold([row(3, [{ path: 'a.ts', newText: 'x\n' }])], 's-other')
    expect(latestDeliveryOf(records, 's1')).toBeUndefined()
    expect(latestDeliveryOf(records, 's-other')?.turn).toBe(3)
  })
})

describe('mergeDeliveries（只追加不回退）', () => {
  it('新轮次追加，旧轮次保留', () => {
    const first = fold([row(1, [{ path: 'a.ts', newText: 'x\n' }])])
    const second = fold([row(2, [{ path: 'b.ts', newText: 'y\n' }])])
    expect(mergeDeliveries(first, second).map(record => record.turn)).toEqual([1, 2])
  })

  it('同一轮只在"更全"时替换：补页拿回更少的明细不会把卡退回旧值', () => {
    const full = fold([row(2, [{ path: 'a.ts', newText: 'x\ny\nz\n' }, { path: 'b.ts', newText: 'q\n' }])])
    const partial = fold([row(2, [{ path: 'a.ts', newText: 'x\n' }])])
    expect(mergeDeliveries(full, partial)[0]?.changes).toHaveLength(2)
  })

  it('两场同一个 turn 号是两条记录，不互相覆盖', () => {
    const a = fold([row(1, [{ path: 'a.ts', newText: 'x\n' }])], 'sA')
    const b = fold([row(1, [{ path: 'b.ts', newText: 'y\n' }])], 'sB')
    const merged = mergeDeliveries(a, b)
    expect(merged).toHaveLength(2)
    expect(latestDeliveryOf(merged, 'sA')?.changes[0]?.path).toBe('a.ts')
    expect(latestDeliveryOf(merged, 'sB')?.changes[0]?.path).toBe('b.ts')
  })
})

describe('turnKeyOf', () => {
  it('同一轮号在不同会话里是不同的键', () => {
    expect(turnKeyOf('sA', 1)).not.toBe(turnKeyOf('sB', 1))
    expect(turnKeyOf('sA', 1)).toBe('sA#1')
  })
})
