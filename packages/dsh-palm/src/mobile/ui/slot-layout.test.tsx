import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LayoutContractError,
  SlotLayout,
  assertDataOnly,
  validateLayout,
  type LayoutSpec,
} from './slot-layout.tsx'

const spec = (over: Partial<LayoutSpec> = {}): LayoutSpec => ({
  name: 'chat',
  blocks: [{ slot: 'header' }, { slot: 'thread', grow: true }, { slot: 'composer' }],
  required: ['header', 'thread', 'composer'],
  ...over,
})

describe('布局契约（slot-layout）', () => {
  it('正常排布：按顺序渲染，grow 槽吃到剩余空间', () => {
    const html = renderToStaticMarkup(
      <SlotLayout
        spec={spec()}
        slots={{ header: 'H', thread: 'T', composer: 'C' }}
      />,
    )
    expect(html.indexOf('H')).toBeLessThan(html.indexOf('T'))
    expect(html.indexOf('T')).toBeLessThan(html.indexOf('C'))
    expect(html).toContain('data-layout="chat"')
    expect(html).toContain('data-slot="thread"')
  })

  it('必填槽缺失时抛错（不允许默默少渲染）', () => {
    expect(() =>
      renderToStaticMarkup(<SlotLayout spec={spec()} slots={{ header: 'H', thread: 'T' }} />),
    ).toThrow(LayoutContractError)
  })

  it('提供了插槽却没被排布引用 → 报错（写了不渲染）', () => {
    expect(
      validateLayout(spec(), { header: 'H', thread: 'T', composer: 'C', unused: 'X' }),
    ).toContain('插槽 "unused" 提供了但没有排布引用（写了不渲染）')
  })

  it('必填槽被使用两次 → 报错', () => {
    const problems = validateLayout(
      spec({ blocks: [{ slot: 'header' }, { slot: 'header' }, { slot: 'thread' }, { slot: 'composer' }] }),
      { header: 'H', thread: 'T', composer: 'C' },
    )
    expect(problems.join()).toContain('被使用了 2 次')
  })

  it('排布里出现函数 → 视为把逻辑塞进版式', () => {
    const bad = { ...spec(), blocks: [{ slot: 'header' }], onClick: () => 1 } as unknown as LayoutSpec
    expect(assertDataOnly(bad).join()).toContain('排布必须纯数据')
  })

  it('排布引用不存在的插槽 → 报错', () => {
    expect(
      validateLayout(spec({ blocks: [{ slot: 'header' }, { slot: 'ghost' }], required: ['header'] }), {
        header: 'H',
      }),
    ).toContain('排布引用了不存在的插槽 "ghost"')
  })
})
