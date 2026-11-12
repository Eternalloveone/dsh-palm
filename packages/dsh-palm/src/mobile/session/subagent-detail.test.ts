/**
 * 子代理详情摘要的契约。
 *
 * 这层的存在理由：详情页要显示「它跑了哪些工具、结论是什么」，而这两件事
 * 全都能从子会话的渲染行里读出来——不用另造执行树，也不用宿主加接口。
 */
import { describe, expect, it } from 'vitest'
import { digestRows, MAX_STEPS, toolDetail, type DigestRow } from './subagent-detail.ts'

describe('toolDetail（从参数 JSON 里挖一行摘要）', () => {
  it('按优先级取命令 / 查询词 / URL / 路径', () => {
    expect(toolDetail('{"command":"npm run build"}')).toBe('npm run build')
    expect(toolDetail('{"query":"find in page ux"}')).toBe('find in page ux')
    expect(toolDetail('{"url":"https://example.com/a"}')).toBe('https://example.com/a')
    expect(toolDetail('{"path":"C:/work/src"}')).toBe('C:/work/src')
  })

  it('不是 JSON、或没有任何已知键：整串压成一行并截断', () => {
    expect(toolDetail('ls -la')).toBe('ls -la')
    expect(toolDetail('{"weird":1}')).toBe('{"weird":1}')
    expect(toolDetail('')).toBe('')
    expect(toolDetail(undefined)).toBe('')
  })

  it('超长参数截断并加省略号（不能把卡片撑开）', () => {
    const long = `{"command":"${'x'.repeat(300)}"}`
    const out = toolDetail(long)
    expect(out.length).toBeLessThanOrEqual(96)
    expect(out.endsWith('…')).toBe(true)
  })

  it('多行文本压成一行', () => {
    expect(toolDetail('{"prompt":"第一行\\n第二行"}')).toBe('第一行 第二行')
  })
})

describe('digestRows（行 → 过程 + 输出）', () => {
  const row = (patch: Partial<DigestRow>): DigestRow => ({ kind: 'assistant', text: '', ...patch })

  it('工具按顺序进步骤，最后一条正文成为输出', () => {
    const digest = digestRows([
      row({
        time: 1000,
        text: '先看一下',
        tools: [{ callId: 'a', name: 'web_search', arguments: '{"query":"find in page"}' }],
      }),
      row({
        time: 2000,
        tools: [
          { callId: 'b', name: 'web_fetch', arguments: '{"url":"https://x.dev/a"}' },
          { callId: 'c', name: 'bash', arguments: '{"command":"pnpm test"}' },
        ],
      }),
      row({ time: 3000, text: '结论：都靠计数和上下跳。' }),
    ])
    expect(digest.toolCount).toBe(3)
    expect(digest.steps.map(step => `${step.name}:${step.detail}`)).toEqual([
      'web_search:find in page',
      'web_fetch:https://x.dev/a',
      'bash:pnpm test',
    ])
    expect(digest.output).toBe('结论：都靠计数和上下跳。')
    expect(digest.lastStep?.name).toBe('bash')
  })

  it('过程叙述不重复进输出：输出只认最后一条 assistant 正文', () => {
    const digest = digestRows([
      row({ text: '中间过程' }),
      row({ text: '   ' }),
      row({ text: '最终结论' }),
    ])
    expect(digest.output).toBe('最终结论')
  })

  it('用户行不算输出（子会话里也有用户消息）', () => {
    const digest = digestRows([
      row({ kind: 'assistant', text: '子代理的结论' }),
      row({ kind: 'user', text: '任务描述' }),
    ])
    expect(digest.output).toBe('子代理的结论')
  })

  it('步骤只留尾部 MAX_STEPS 条，但工具总数照实统计', () => {
    const rows: DigestRow[] = Array.from({ length: MAX_STEPS + 5 }, (_, index) => row({
      tools: [{ callId: `c${index}`, name: 'bash', arguments: `{"command":"step ${index}"}` }],
    }))
    const digest = digestRows(rows)
    expect(digest.toolCount).toBe(MAX_STEPS + 5)
    expect(digest.steps).toHaveLength(MAX_STEPS)
    expect(digest.steps[digest.steps.length - 1]?.detail).toBe(`step ${MAX_STEPS + 4}`)
  })

  it('什么都没跑：没有步骤、没有输出、没有最近一步', () => {
    const digest = digestRows([])
    expect(digest).toEqual({ steps: [], output: '', toolCount: 0 })
  })
})
