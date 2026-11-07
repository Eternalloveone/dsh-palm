/** 审批预览：用户点「允许一次」之前，卡片上必须看得见要执行什么。 */
import { describe, expect, it } from 'vitest'
import { APPROVAL_PREVIEW_LIMIT, approvalPreviewText } from './approval-preview.ts'

describe('approvalPreviewText', () => {
  it('shows the command for a shell call', () => {
    expect(approvalPreviewText('{"command":"rm -rf build && pnpm build"}')).toBe('rm -rf build && pnpm build')
    expect(approvalPreviewText('{"cmd":"pnpm verify"}')).toBe('pnpm verify')
  })

  it('falls back to the file path for edit-style tools', () => {
    expect(approvalPreviewText('{"file_path":"src/mobile/api.ts","old":"a","new":"b"}')).toBe('src/mobile/api.ts')
  })

  it('never shows a multi-line blob: newlines collapse into one line', () => {
    expect(approvalPreviewText('{"command":"line1\\nline2\\n\\n line3"}')).toBe('line1 line2 line3')
  })

  it('clips long values with an ellipsis', () => {
    const long = 'x'.repeat(APPROVAL_PREVIEW_LIMIT + 50)
    const out = approvalPreviewText(JSON.stringify({ command: long })) ?? ''
    expect(out.length).toBe(APPROVAL_PREVIEW_LIMIT)
    expect(out.endsWith('…')).toBe(true)
  })

  it('keeps unknown shapes readable instead of dropping them', () => {
    expect(approvalPreviewText('{"whatever":1,"nested":{"a":2}}')).toBe('{"whatever":1,"nested":{"a":2}}')
    expect(approvalPreviewText('not json at all')).toBe('not json at all')
  })

  it('returns undefined when there is nothing to show', () => {
    expect(approvalPreviewText(undefined)).toBeUndefined()
    expect(approvalPreviewText('   ')).toBeUndefined()
  })
})
