import { describe, expect, it } from 'vitest'
import { SearchIndex, buildParagraphAnchor, buildSnippet, indexTokens, matchExpression, normalizeQueryText, stripToolBlocks } from './search-index.ts'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const probe = await SearchIndex.inMemory()
/** node:sqlite is missing on older Node builds; skip instead of failing the suite. */
const describeIndex = probe === undefined ? describe.skip : describe

describe('中文切分（bigram）', () => {
  it('连续中文切成相邻二字组，拉丁词小写保留', () => {
    expect(indexTokens('我们做了支付专项的调试')).toBe('我们 们做 做了 了支 支付 付专 专项 项的 的调 调试')
    expect(indexTokens('DP534 scan TIME')).toBe('dp534 scan time')
    expect(indexTokens('')).toBe('')
  })

  it('单个汉字原样保留（否则整条消息进不了索引）', () => {
    expect(indexTokens('支')).toBe('支')
  })

  it('标点被当分隔符，不产生 token', () => {
    expect(indexTokens('支付，专项！！')).toBe('支付 专项')
  })
})

describe('查询表达式', () => {
  it('2 字中文 → 一个 bigram 短语', () => {
    expect(matchExpression('支付')).toBe('"支付"')
  })

  it('3 字中文 → 相邻 bigram 短语（等价于子串匹配）', () => {
    expect(matchExpression('支付专项')).toBe('"支付 付专 专项"')
  })

  it('英文多词 → AND', () => {
    expect(matchExpression('scan time')).toBe('"scan" AND "time"')
  })

  it('中英混合 → 各自短语 AND', () => {
    expect(matchExpression('DP534 支付')).toBe('"dp534" AND "支付"')
  })

  it('单个汉字 / 纯标点无法索引 → undefined（调用方走 LIKE）', () => {
    expect(matchExpression('支')).toBeUndefined()
    expect(matchExpression('，。！')).toBeUndefined()
    expect(matchExpression('   ')).toBeUndefined()
  })

  it('引号不会被注入成 FTS 语法', () => {
    expect(matchExpression('say "hi"')).toBe('"say" AND "hi"')
  })

  it('全角输入折成半角：ＲＲＡＭ 与 RRAM 等价，全角空格当空格', () => {
    expect(normalizeQueryText('ＲＲＡＭ')).toBe('RRAM')
    expect(matchExpression('ＲＲＡＭ')).toBe('"rram"')
    expect(matchExpression('ＤＰ５３４　支付')).toBe('"dp534" AND "支付"')
    // 中文不受影响（全角中文本来就是汉字）
    expect(matchExpression('支付')).toBe('"支付"')
  })
})

describe('摘要与高亮', () => {
  const text = '第 0 条：支付专项调试记录，涉及 3 次抓波形'

  it('命中时摘要包住词，range 指到的就是那个词', () => {
    const { snippet, ranges } = buildSnippet(text, '支付专项')
    expect(snippet).toContain('支付专项')
    const first = ranges[0]
    expect(first).toBeDefined()
    expect(snippet.slice(first![0], first![1])).toBe('支付专项')
  })

  it('没命中时给开头，不给假高亮', () => {
    const { snippet, ranges } = buildSnippet(text, '完全不存在')
    expect(ranges).toEqual([])
    expect(snippet.length).toBeGreaterThan(0)
  })

  it('长文本命中在中间时两侧加省略号', () => {
    const long = `${'甲'.repeat(60)}支付专项${'乙'.repeat(80)}`
    const { snippet } = buildSnippet(long, '支付专项')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('支付专项')
  })
})

describeIndex('索引库：写入 / 查询 / 排序 / 删除', () => {
  const open = async (): Promise<SearchIndex> => {
    const memory = await SearchIndex.inMemory()
    if (memory === undefined) throw new Error('node:sqlite 不可用')
    return memory
  }

  it('中文 2 字能命中，且能按会话过滤', async () => {
    const index = await open()
    index.upsertSession(
      { sessionId: 's1', title: '支付专项排查', updatedAt: 100, complete: true, indexedThroughSeq: 5 },
      [
        { messageId: 'm1', seq: 1, text: '我做了支付专项的调试', user: true },
        { messageId: 'm2', seq: 2, text: '支付流程正常，没有异常', user: false },
      ],
      1000,
    )
    index.upsertSession(
      { sessionId: 's2', title: '报表导出', updatedAt: 200, complete: true, indexedThroughSeq: 9 },
      [
        { messageId: 'm3', seq: 3, text: '报表导出失败', user: true },
        { messageId: 'm4', seq: 4, text: '支付接口超时', user: false },
      ],
      2000,
    )

    const hits = index.query('支付')
    expect(hits.length).toBe(3)
    expect(new Set(hits.map(hit => hit.sessionId))).toEqual(new Set(['s1', 's2']))
    expect(hits.filter(hit => hit.sessionId === 's1').length).toBe(2)

    const onlyS2 = index.query('支付', { sessionId: 's2' })
    expect(onlyS2.length).toBe(1)
    expect(onlyS2[0]!.messageId).toBe('m4')

    // 标题命中不重复计入消息命中（否则一个会话的每条消息都会被标题带出来）
    expect(index.query('支付').length).toBe(3)
    expect(index.titleHits('支付')).toEqual([{ sessionId: 's1', title: '支付专项排查' }])
    index.close()
  })

  it('同一 query 下用户消息排在助手消息前面', async () => {
    const index = await open()
    index.upsertSession(
      { sessionId: 's1', updatedAt: 100, complete: true, indexedThroughSeq: 2 },
      [
        { messageId: 'a', seq: 1, text: '支付支付支付 助手说的', user: false },
        { messageId: 'u', seq: 2, text: '支付 我说的', user: true },
      ],
      1000,
    )
    const hits = index.query('支付')
    expect(hits[0]!.messageId).toBe('u')
    expect(hits[0]!.user).toBe(true)
    index.close()
  })

  it('单个汉字走 LIKE 兜底，仍然搜得到', async () => {
    const index = await open()
    index.upsertSession(
      { sessionId: 's1', updatedAt: 100, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'm1', seq: 1, text: '报销单据丢了', user: true }],
      1000,
    )
    const hits = index.query('销')
    expect(hits.length).toBe(1)
    expect(hits[0]!.snippet).toContain('销')
    index.close()
  })

  it('重复写入同一条消息不会产生重复行', async () => {
    const index = await open()
    const session = { sessionId: 's1', updatedAt: 100, complete: true, indexedThroughSeq: 1 }
    index.upsertSession(session, [{ messageId: 'm1', seq: 1, text: '支付专项', user: true }], 1000)
    index.upsertSession({ ...session, updatedAt: 200 }, [{ messageId: 'm1', seq: 1, text: '支付专项（改）', user: true }], 2000)
    expect(index.stats().docs).toBe(1)
    expect(index.query('支付').length).toBe(1)
    expect(index.query('改').length).toBe(1)
    index.close()
  })

  it('删掉会话后不再命中，统计同步下降', async () => {
    const index = await open()
    index.upsertSession(
      { sessionId: 's1', updatedAt: 100, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'm1', seq: 1, text: '支付专项', user: true }],
      1000,
    )
    index.upsertSession(
      { sessionId: 's2', updatedAt: 100, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'm2', seq: 1, text: '别的会话', user: true }],
      1000,
    )
    expect(index.stats()).toMatchObject({ docs: 2, sessions: 2 })
    index.dropSession('s1')
    expect(index.query('支付').length).toBe(0)
    expect(index.stats()).toMatchObject({ docs: 1, sessions: 1 })
    expect(index.sessionState('s1')).toBeUndefined()
    index.close()
  })

  it('分组结果给出每个会话的命中数与最佳命中', async () => {
    const index = await open()
    index.upsertSession(
      { sessionId: 's1', updatedAt: 100, complete: true, indexedThroughSeq: 3 },
      [
        { messageId: 'm1', seq: 1, text: '支付专项 第一次', user: true },
        { messageId: 'm2', seq: 2, text: '支付专项 第二次', user: false },
      ],
      1000,
    )
    const groups = index.queryGroups('支付')
    expect(groups.length).toBe(1)
    expect(groups[0]!.sessionId).toBe('s1')
    expect(groups[0]!.hits).toBe(2)
    expect(groups[0]!.best.user).toBe(true)
    index.close()
  })

  it('翻页取到的是同一份排序的连续切片（第二页不重复第一页）', async () => {
    const index = await open()
    // 12 个会话，每个 3 条命中：老实现按 perSession×(offset+cap+1) 决定候选池大小，
    // 第 2 页的池子比第 1 页大，同一个会话会被重新排进结果里 —— 真机「加载更多」
    // 5 条里 3 条和第一页重复。
    for (let i = 0; i < 12; i += 1) {
      index.upsertSession(
        { sessionId: `s${i}`, title: `会话 ${i}`, updatedAt: 100 + i, complete: true, indexedThroughSeq: 9 },
        [7, 8, 9].map(seq => ({ messageId: `s${i}m${seq}`, seq, text: `支付专项 第 ${seq} 条`, user: true })),
        1000 + i,
      )
    }
    const first = index.queryGroupsDetailed('支付专项', { limits: 2, sessions: 4, offset: 0 })
    const second = index.queryGroupsDetailed('支付专项', { limits: 2, sessions: 4, offset: first.groups.length })
    const firstIds = first.groups.map(group => group.sessionId)
    const secondIds = second.groups.map(group => group.sessionId)
    expect(firstIds).toHaveLength(4)
    expect(secondIds).toHaveLength(4)
    expect(secondIds.filter(id => firstIds.includes(id))).toEqual([])
    // 总组数在两页上一致：翻页不能改变「一共多少个会话命中」。
    expect(second.totalGroups).toBe(first.totalGroups)
    expect(first.totalGroups).toBe(12)
    expect(first.hasMore).toBe(true)
    index.close()
  })

  it('性能：2000 条消息里查中文 2 字，均值 < 50ms', async () => {
    const index = await open()
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      messageId: `m${i}`,
      seq: i,
      text: i % 5 === 0 ? `第 ${i} 条：支付专项调试记录` : `第 ${i} 条：闲聊内容 abc`,
      user: i % 2 === 0,
    }))
    index.upsertSession({ sessionId: 'big', updatedAt: 1, complete: true, indexedThroughSeq: 2000 }, rows, 1000)
    // 先用两次查询把 FTS 的段合并摊掉，再计时（否则测的是建索引的尾巴）
    index.query('支付专项', { limit: 20 })
    index.query('支付专项', { limit: 20 })
    const started = performance.now()
    const rounds = 20
    for (let i = 0; i < rounds; i++) {
      const hits = index.query('支付专项', { limit: 20 })
      expect(hits.length).toBeGreaterThan(0)
    }
    const average = (performance.now() - started) / rounds
    expect(average).toBeLessThan(25)
    index.close()
  })
})
describe('索引口径版本', () => {
  it('版本不符时整库作废（旧口径的文档不能留下来继续被搜到）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-index-version-'))
    const path = join(dir, 'index.db')
    try {
      const first = await SearchIndex.open(path)
      if (first === undefined) return
      first.upsertSession(
        { sessionId: 's1', title: '旧库', updatedAt: 100, complete: true, indexedThroughSeq: 5 },
        [{ messageId: 'm1', seq: 1, text: '折叠区里的过程叙述', user: false }],
        1000,
      )
      expect(first.stats().sessions).toBe(1)
      first.close()

      // 模拟"上一次写库时的旧口径"：把版本号改回 1，再打开就应当清空。
      const { DatabaseSync } = await import('node:sqlite')
      const raw = new DatabaseSync(path)
      raw.exec("UPDATE meta SET value = '1' WHERE key = 'index_version'")
      raw.close()

      const second = await SearchIndex.open(path)
      if (second === undefined) return
      expect(second.stats().sessions).toBe(0)
      expect(second.stats().docs).toBe(0)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
describe('分组分页与时间衰减', () => {
  it('分组分页：offset 切片、每会话最多 limits 条消息、hasMore 正确', async () => {
    const index = await SearchIndex.open(':memory:')
    if (index === undefined) return
    const now = Date.now()
    index.upsertSession(
      { sessionId: 's-a', title: 'A', updatedAt: now, complete: true, indexedThroughSeq: 3 },
      [
        { messageId: 'a1', seq: 1, text: '支付回调复核', user: true },
        { messageId: 'a2', seq: 2, text: '支付回调梳理', user: false },
        { messageId: 'a3', seq: 3, text: '支付回调确认', user: true },
      ],
      now,
    )
    index.upsertSession(
      { sessionId: 's-b', title: 'B', updatedAt: now - 1_000, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'b1', seq: 1, text: '支付回调排查', user: true }],
      now - 1_000,
    )
    index.upsertSession(
      { sessionId: 's-c', title: 'C', updatedAt: now - 2_000, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'c1', seq: 1, text: '支付回调排查', user: true }],
      now - 2_000,
    )

    const first = index.queryGroupsDetailed('支付', { limits: 2, sessions: 2, offset: 0 })
    expect(first.groups.map(group => group.sessionId)).toEqual(['s-a', 's-b'])
    expect(first.hasMore).toBe(true)
    // 每会话最多 2 条，但命中数照实报 3。
    expect(first.groups[0]?.messages.length).toBe(2)
    expect(first.groups[0]?.hits).toBe(3)

    const second = index.queryGroupsDetailed('支付', { limits: 2, sessions: 2, offset: 2 })
    expect(second.groups.map(group => group.sessionId)).toEqual(['s-c'])
    expect(second.hasMore).toBe(false)
  })

  it('时间衰减：相关度相同的时候，最近的会话排在前面', async () => {
    const index = await SearchIndex.open(':memory:')
    if (index === undefined) return
    const recent = Date.now()
    const ancient = recent - 3 * 365 * 86_400_000
    index.upsertSession(
      { sessionId: 's-new', title: '新', updatedAt: recent, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'n1', seq: 1, text: '支付回调排查', user: true }],
      recent,
    )
    index.upsertSession(
      { sessionId: 's-old', title: '旧', updatedAt: ancient, complete: true, indexedThroughSeq: 1 },
      [{ messageId: 'o1', seq: 1, text: '支付回调排查', user: true }],
      ancient,
    )
    const groups = index.queryGroupsDetailed('支付', { limits: 1, sessions: 5 })
    expect(groups.groups.map(group => group.sessionId)).toEqual(['s-new', 's-old'])
  })

  it('工具/技能原始块里的字不算命中（搜得到但点进去没有）', async () => {
    const index = await SearchIndex.open(':memory:')
    if (index === undefined) return
    index.upsertSession(
      { sessionId: 's-dirty', title: '脏文档', updatedAt: 500, complete: true, indexedThroughSeq: 9 },
      [
        // 旧库里的脏数据：答案正文其实是整段工具输出。
        { messageId: 'd1', seq: 1, text: 'thriving<tool_result><skill_content name="archify"> 画架构图的技能 </skill_content></tool_result>', user: false },
        { messageId: 'd2', seq: 2, text: '这一条是正常正文，讲 archify 的用法', user: false },
      ],
      5000,
    )
    const hits = index.query('archify', { limit: 10 })
    // 只剩正文那条：脏文档剥掉工具块之后就没有命中的字了。
    expect(hits.map(hit => hit.messageId)).toEqual(['d2'])
    // 剥出来的片段里不该再有标签残渣。
    expect(hits[0]?.snippet ?? '').not.toContain('<tool_result')
    expect(stripToolBlocks('前文<tool_result>隐藏</tool_result>后文')).toBe('前文 后文')
    // 未闭合的工具块按到结尾处理。
    expect(stripToolBlocks('前文<skill_content name="x">一直到结尾')).toBe('前文 ')
  })
})
describe('buildParagraphAnchor（方案 A/C 的段落锚点）', () => {
  const doc = [
    '第一段：这次改动只碰了样式，没有动逻辑。',
    '',
    '第二段：重启之后网关才认新的端口，命令是 systemctl restart dsh，注意先看日志。',
    '',
    '第三段：再跑一遍重启确认。',
  ].join('\n')

  it('段落 = 命中所在的那一块，不含前后段', () => {
    const anchor = buildParagraphAnchor(doc, 'systemctl restart')
    expect(anchor.paragraph).toContain('重启之后网关才认新的端口')
    expect(anchor.paragraph).not.toContain('第一段')
    expect(anchor.paragraph).not.toContain('第三段')
    expect(anchor.matchIndex).toBe(0)
  })

  it('两条命中落在同一张卡片时，段落能把它们区分开（A 的核心）', () => {
    // 一轮被打包成一张卡片：卡里两条消息都含「重启」，旧逻辑只会滚到卡里第一个标记。
    const first = '用户说：先别重启，等我确认。'
    const second = '助手说：确认过了，可以重启，命令是 systemctl restart dsh。'
    const a = buildParagraphAnchor(first, '重启')
    const b = buildParagraphAnchor(second, '重启')
    expect(a.paragraph).not.toBe(b.paragraph)
    expect(a.paragraph).toContain('先别重启')
    expect(b.paragraph).toContain('可以重启')
    expect(a.matchIndex).toBe(0)
    expect(b.matchIndex).toBe(0)
  })

  it('段落过长时围绕命中词截断，且带省略号', () => {
    const long = `${'甲'.repeat(400)}重启${'乙'.repeat(400)}`
    const anchor = buildParagraphAnchor(long, '重启')
    expect(anchor.paragraph).toContain('重启')
    expect(anchor.paragraph.length).toBeLessThan(400)
    expect(anchor.paragraph.startsWith('…')).toBe(true)
    expect(anchor.paragraph.endsWith('…')).toBe(true)
  })

  it('查不到词时给开头一段，matchIndex 归零（不能让前端拿到 NaN）', () => {
    const anchor = buildParagraphAnchor(doc, '不存在的词')
    expect(anchor.matchIndex).toBe(0)
    expect(anchor.paragraph.startsWith('第一段')).toBe(true)
  })
})