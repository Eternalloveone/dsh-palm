// @vitest-environment jsdom
/** Report-card container contract: settled assistant turns that read like a
 *  result report get .chat-msg-report; plain prose and pending rows do not. */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage } from './messages.ts'

function message(text: string, extra?: Partial<RenderMessage>): RenderMessage {
  return { id: 'assistant,1.0#1', kind: 'assistant', text, pending: false, seq: 1, time: 1_000, ...extra }
}

describe('conditional report card container', () => {
  it('marks report-like settled assistant text', () => {
    const { container } = render(
      <MessageRow
        message={message('- 脚本重启：✓ 通过\n- 宿主 3080：✓ 正常')}
        showToolCalls={false}
        showSystemMessages={false}
      />,
    )
    expect(container.querySelector('.chat-msg-report')).not.toBeNull()
  })

  it('keeps ordinary prose off the card path', () => {
    const { container } = render(
      <MessageRow message={message('好的，已经处理完了，明天继续。')} showToolCalls={false} showSystemMessages={false} />,
    )
    expect(container.querySelector('.chat-msg-report')).toBeNull()
  })

  it('never marks pending rows (streaming stays plain)', () => {
    const { container } = render(
      <MessageRow
        message={message('- 脚本重启：✓ 通过\n- 宿主 3080：✓ 正常', { pending: true })}
        showToolCalls={false}
        showSystemMessages={false}
      />,
    )
    expect(container.querySelector('.chat-msg-report')).toBeNull()
  })

  it('detects report content carried by flow text runs (empty message.text)', () => {
    const { container } = render(
      <MessageRow
        message={{
          id: 'assistant,1.0#7', kind: 'assistant', text: '', pending: false, seq: 7, time: 1_005,
          flow: [
            { kind: 'text', text: '### 验证结果', seq: 1 },
            { kind: 'text', text: '- 脚本重启：✓ 通过', seq: 2 },
            { kind: 'text', text: '- 单元测试：✓ 通过', seq: 3 },
          ],
        }}
        showToolCalls={false}
        showSystemMessages={false}
      />,
    )
    expect(container.querySelector('.chat-msg-report')).not.toBeNull()
    // Flow text runs now go through the report renderer too.
    expect(container.querySelector('.rpt-line')).not.toBeNull()
    expect(container.querySelector('.rpt-ok')).not.toBeNull()
  })

  it('renders the real copied agent report cleanly', () => {
    const raw = [
      'HEAD 又前进两个提交（`ccaa072`、`c811165`），领先 origin/main 15 个。对这最新 HEAD 重新跑完整验证：',
      '等待验证，同时收集新提交详情与完整领先列表：',
      '### dsh-palm 验证与构建（HEAD c811165）',
      '',
      '- Typecheck（`tsc -b --pretty false`）：✓ 通过',
      '- 单元测试（`vitest run`，74 文件 / 922 用例）：✓ 通过',
      '- 构建（`tsc -b && tsdown`，main/client/mobile 三入口）：✓ 通过',
      '- 工作树：✓ 干净（仅未跟踪 `running-probe.mjs`，预存非本次产物）',
      '',
      'commit c811165be17e0786adaf898a9f2a96725d6ef49d',
      '',
      '### commit 状态',
      '',
      '- HEAD `c811165`（fix(mobile): unified report body for flow turns）：✓ 已提交',
      '- 上一提交 `ccaa072`（fix(mobile): report card also on tool-interleaved flow turns）：✓ 已提交',
      '- 本地领先 `origin/main`（f8051a9）共 15 个提交，全部未推送：✓ 已提交未推送',
      '- 描述符 `v1.0.0-16-gc811165`（v1.0.0 之后 16 个提交）：✓',
      '',
      '本轮 3 个新测试场景并入，三项退出码全 0。',
    ].join('\n')
    const { container } = render(
      <MessageRow message={message(raw)} showToolCalls={false} showSystemMessages={false} />,
    )
    expect(container.querySelector('.chat-msg-report')).not.toBeNull()
    // Sections and status rows are formed from the real text.
    const sections = Array.from(container.querySelectorAll('.rpt-section')).map(el => el.textContent ?? '')
    expect(sections).toContain('dsh-palm 验证与构建（HEAD c811165）')
    expect(sections).toContain('commit 状态')
    expect(container.querySelectorAll('.rpt-line')).toHaveLength(8)
    expect(container.querySelectorAll('.rpt-ok')).toHaveLength(8)
    // The 40-hex commit becomes one chip (never a stray raw hash line).
    const hashes = Array.from(container.querySelectorAll('.rpt-commit-hash')).map(el => el.textContent)
    expect(hashes).toContain('c811165be17e0786adaf898a9f2a96725d6ef49d')
    expect(container.querySelector('.chat-msg-report')!.textContent).not.toContain('commit c811165be17e0786adaf898a9f2a96725d6ef49d')
  })
})
