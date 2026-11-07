// @vitest-environment jsdom
/**
 * MessageVM + 块注册表（W2-2）。
 *
 * 验收口径是"新增一种块只改 2 处（注册 + 样式）"，所以这里重点钉两件事：
 * 1. `toVM` 的分组/顺序语义与拆分前逐条一致（否则就是行为回归）；
 * 2. 注册表能**在不改组件的前提下**多出一种块（这就是扩展点本身）。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProcessModel } from '../render/process-rows.ts'
import { BlockList, mergeRegistry, type BlockRegistry } from './block-registry.tsx'
import { toVM } from './to-vm.ts'
import type { MessageBlock } from './types.ts'

/** 造一个过程模型；只填测试关心的字段。 */
function model(rows: unknown[]): ProcessModel {
  return { rows, answer: undefined } as unknown as ProcessModel
}

const reasoning = { kind: 'reasoning', key: 'r1', lines: 3, text: '想一想' }
const text = (key: string, value: string, seq?: number) => ({ kind: 'text', key, text: value, ...(seq === undefined ? {} : { seq }) })
const tool = (key: string, view: unknown, callId = key) => ({ kind: 'tool', key, tool: { callId, name: 'write', view } })

describe('toVM', () => {
  it('按事件顺序产出块，思考块出现即结算前面的工具组', () => {
    const blocks = toVM(model([
      tool('t1', { kind: 'diff' }),
      reasoning,
      text('x1', '答案'),
    ]), { showToolCalls: true, pending: false })

    expect(blocks.map(block => block.kind)).toEqual(['tool', 'tool-group', 'reasoning', 'text'])
  })

  it('连续带 diff 的工具合成一张卡', () => {
    const blocks = toVM(model([
      tool('t1', { kind: 'diff' }),
      tool('t2', { kind: 'diff' }),
      text('x1', '写完'),
    ]), { showToolCalls: false, pending: false })

    const groups = blocks.filter(block => block.kind === 'tool-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind === 'tool-group' && groups[0].tools.map(item => item.callId)).toEqual(['t1', 't2'])
  })

  it('不带 diff 的工具行会断开分组', () => {
    const blocks = toVM(model([
      tool('t1', { kind: 'diff' }),
      tool('t2', undefined),
      tool('t3', { kind: 'diff' }),
    ]), { showToolCalls: false, pending: false })

    expect(blocks.filter(block => block.kind === 'tool-group')).toHaveLength(2)
  })

  it('关掉「显示工具调用」只挡工具行，不挡 diff 卡', () => {
    const blocks = toVM(model([tool('t1', { kind: 'diff' }), reasoning]), {
      showToolCalls: false,
      pending: false,
    })
    expect(blocks.map(block => block.kind)).toEqual(['tool-group', 'reasoning'])

    const withTools = toVM(model([tool('t1', { kind: 'diff' }), reasoning]), {
      showToolCalls: true,
      pending: false,
    })
    expect(withTools.map(block => block.kind)).toEqual(['tool', 'tool-group', 'reasoning'])
  })

  it('正文步骤号：优先行内 seq，否则退回合并步骤的 stepSeqs', () => {
    const blocks = toVM(model([text('a', '一'), text('b', '二', 42), text('c', '三')]), {
      showToolCalls: false,
      pending: false,
      stepSeqs: [7, 8, 9],
    })
    const seqs = blocks.filter(block => block.kind === 'text').map(block => (block.kind === 'text' ? block.seq : undefined))
    expect(seqs).toEqual([7, 42, 9])
  })

  it('块 key 稳定且互不重复', () => {
    const blocks = toVM(model([
      tool('t1', { kind: 'diff' }),
      tool('t2', { kind: 'diff' }),
      reasoning,
      text('x1', '答案'),
      tool('t3', { kind: 'diff' }),
    ]), { showToolCalls: true, pending: false })
    const keys = blocks.map(block => block.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('块注册表', () => {
  const base: BlockRegistry<{ label: string }> = {
    text: ({ block }) => (block.kind === 'text' ? <span>{block.text}</span> : null),
  }

  it('没注册的 kind 直接跳过，不抛错', () => {
    const blocks: MessageBlock[] = [{ kind: '未来块', key: 'k1' } as unknown as MessageBlock]
    render(<BlockList blocks={blocks} registry={base} ctx={{ label: '' }} />)
    expect(screen.queryByText('未来块')).toBeNull()
  })

  it('加一种块只需登记一张表：组件代码不用动', () => {
    const extended = mergeRegistry(base, {
      demo: ({ block }) => <span data-testid="demo">{block.key}</span>,
    })
    const blocks: MessageBlock[] = [{ kind: 'demo', key: 'd1' } as unknown as MessageBlock]
    render(<BlockList blocks={blocks} registry={extended} ctx={{ label: '' }} />)
    expect(screen.getByTestId('demo').textContent).toBe('d1')
  })

  it('默认正文块按文本渲染', () => {
    const blocks: MessageBlock[] = [{ kind: 'text', key: 't', text: '你好', index: 0 }]
    render(<BlockList blocks={blocks} registry={base} ctx={{ label: '' }} />)
    expect(screen.getByText('你好')).toBeTruthy()
  })
})
