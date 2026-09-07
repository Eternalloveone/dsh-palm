// @vitest-environment jsdom
/** ReportBody integration: a settled report-like assistant turn renders the
 *  structured lines (sections, status rows + chips, commit chip) while its
 *  prose and fenced code keep flowing through the normal MarkdownText path. */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage } from './messages.ts'

function assistant(text: string, extra?: Partial<RenderMessage>): RenderMessage {
  return { id: 'assistant,1.0#3', kind: 'assistant', text, pending: false, seq: 3, time: 1_000, ...extra }
}

const REPORT_TEXT = [
  '### 验证结果',
  '- 脚本重启：✓ 通过',
  '构建 pipeline → ✗ 失败（超时）',
  '',
  '```sh',
  'npm run build',
  '```',
  '',
  'commit a3f9c21',
].join('\n')

describe('report card body (P2)', () => {
  it('renders sections, status chips, commit chip and delegates code fences', () => {
    const { container } = render(
      <MessageRow message={assistant(REPORT_TEXT)} showToolCalls={false} showSystemMessages={false} />,
    )
    const root = container.querySelector('.chat-msg-report')
    expect(root).not.toBeNull()
    // Section heading + status rows.
    expect(root!.querySelector('.rpt-section')!.textContent).toContain('验证结果')
    expect(root!.querySelectorAll('.rpt-line')).toHaveLength(2)
    expect(root!.querySelector('.rpt-ok')).not.toBeNull()
    expect(root!.querySelector('.rpt-fail')).not.toBeNull()
    // Fenced code delegated to the normal code card.
    expect(root!.querySelector('.code-block')).not.toBeNull()
    expect(root!.textContent).toContain('npm run build')
    // Commit chip + copy button.
    expect(root!.querySelector('.rpt-commit-hash')!.textContent).toBe('a3f9c21')
    expect(root!.querySelector('.rpt-copy')!.textContent).toContain('复制')
  })

  it('leaves plain prose messages untouched', () => {
    const { container } = render(
      <MessageRow
        message={assistant('普通叙述，没有任何状态行。\n\n这是第二段。')}
        showToolCalls={false}
        showSystemMessages={false}
      />,
    )
    expect(container.querySelector('.chat-msg-report')).toBeNull()
    expect(container.querySelector('.rpt-line')).toBeNull()
  })
})
