import { describe, expect, it } from 'vitest'
import { artifactTally, collectArtifacts } from './artifacts.ts'
import type { RenderMessage } from '../projections/types.ts'

/** 造一行消息（只填本域关心的字段）。 */
function row(overrides: Partial<RenderMessage> = {}): RenderMessage {
  return { id: 'm', kind: 'assistant', text: '', ...overrides } as RenderMessage
}

describe('产物聚合（P6 ⑧ 屏数据层）', () => {
  it('交付物与工具产物合成一组，按轮分组', () => {
    const turns = collectArtifacts([
      row({ id: 'a', turn: 1, deliverables: [{ path: 'report.md', description: '报告' }], produced: ['src/a.ts'] }),
      row({ id: 'b', turn: 2, produced: ['src/b.ts'] }),
    ])
    expect(turns).toHaveLength(2)
    expect(turns[0]?.turn).toBe(2)
    expect(turns[1]?.turn).toBe(1)
    expect(turns[1]?.files.map(file => file.path)).toEqual(['report.md', 'src/a.ts'])
  })

  it('同一文件既交付又被改过：只算一次，且算交付物', () => {
    const turns = collectArtifacts([
      row({ id: 'a', turn: 1, deliverables: [{ path: 'x.md' }], produced: ['x.md'] }),
    ])
    expect(turns[0]?.files).toHaveLength(1)
    expect(turns[0]?.files[0]).toMatchObject({ path: 'x.md', kind: 'deliverable' })
  })

  it('保留交付物的说明文字', () => {
    const turns = collectArtifacts([row({ id: 'a', turn: 1, deliverables: [{ path: 'r.md', description: '交付报告' }] })])
    expect(turns[0]?.files[0]?.description).toBe('交付报告')
  })

  it('没有产物的行不产生空组', () => {
    const turns = collectArtifacts([row({ id: 'a', turn: 1, text: '只是说了一句话' })])
    expect(turns).toEqual([])
  })

  it('缺轮号的老事件排在最后', () => {
    const turns = collectArtifacts([
      row({ id: 'old', produced: ['old.ts'] }),
      row({ id: 'new', turn: 3, produced: ['new.ts'] }),
    ])
    expect(turns.map(turn => turn.turn)).toEqual([3, undefined])
  })

  it('统计给出总文件数与交付物数', () => {
    const turns = collectArtifacts([
      row({ id: 'a', turn: 1, deliverables: [{ path: 'a.md' }], produced: ['b.ts'] }),
      row({ id: 'b', turn: 2, produced: ['c.ts', 'a.md'] }),
    ])
    expect(artifactTally(turns)).toEqual({ files: 3, delivered: 1 })
  })

  it('不修改输入（纯函数）', () => {
    const input = [row({ id: 'a', turn: 1, produced: ['a.ts'] })]
    const snapshot = JSON.stringify(input)
    collectArtifacts(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
