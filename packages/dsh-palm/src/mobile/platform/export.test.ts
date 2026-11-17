import { describe, expect, it } from 'vitest'
import { REDACTED } from './redact.ts'
import { escapeHtml, exportMarkdown, exportSingleFileHtml } from './export.ts'

const rows = [
  { role: 'user' as const, text: '把 key 写进 .env：sk-abcdefghijklmnop1234', at: 1_700_000_000_000 }, //gitleaks:allow
  { role: 'assistant' as const, text: '好的，已写入 <b>不是 HTML</b> 的文本', at: 1_700_000_060_000 },
]

const NOW = 1_700_000_000_000

describe('exportMarkdown', () => {
  it('renders one heading per row and redacts secrets', () => {
    const md = exportMarkdown('修复审批卡', rows, NOW)
    expect(md.startsWith('# 修复审批卡')).toBe(true)
    expect(md).toContain(`sk-${REDACTED}`)
    expect(md).not.toContain('abcdefghijklmnop1234')
    expect(md).toContain('## 我')
    expect(md).toContain('## 助手')
  })

  it('keeps raw text (Markdown is not HTML-escaped)', () => {
    expect(exportMarkdown('t', rows, NOW)).toContain('<b>不是 HTML</b>')
  })
})

describe('exportSingleFileHtml', () => {
  it('produces a self-contained page with escaped text', () => {
    const html = exportSingleFileHtml('修复 <审批>', rows, NOW)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<title>修复 &lt;审批&gt;</title>')
    // The assistant text must be escaped, not interpreted.
    expect(html).toContain('&lt;b&gt;不是 HTML&lt;/b&gt;')
    expect(html).not.toContain('<b>不是 HTML</b>')
    // And the secret is already masked before escaping.
    expect(html).toContain(`sk-${REDACTED}`)
    expect(html).not.toContain('abcdefghijklmnop1234')
    // No external assets: one <style> block, no src/href to load.
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<script|src=|href=/)
  })

  it('escapeHtml covers the five entities', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
