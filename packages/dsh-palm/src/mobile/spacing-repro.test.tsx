// @vitest-environment jsdom
/**
 * Streaming must never change the line rhythm of already-rendered content:
 * (1) while a second paragraph is still open it lives in its own .md-html
 * run next to the stable run (the cross-run gap is the CSS
 * `.md-html + .md-html` rule — this test pins the DOM contract), and
 * (2) hard line breaks inside a paragraph stay <br /> after the turn
 * closes, matching the streaming preview (markdown.ts renderInline).
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownText } from './markdown-text.tsx'

function mdHtmlRuns(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.md-html')).map(el => el.innerHTML)
}

describe('streaming paragraph rhythm', () => {
  it('an open paragraph renders as its own .md-html run next to the stable run', () => {
    const { container } = render(<MarkdownText pending={true} text={'第一段\n\n第二段开头'} />)
    // Two runs (stable <p> + open tail <p>): the CSS cross-run rule keeps
    // the same 16px gap the settled p + p rhythm provides inside one run.
    expect(mdHtmlRuns(container)).toEqual(['<p>第一段</p>', '<p>第二段开头</p>'])
  })

  it('settled paragraphs share one run so p + p keeps the rhythm', () => {
    const { container } = render(<MarkdownText pending={false} text={'第一段\n\n第二段完整'} />)
    expect(mdHtmlRuns(container)).toEqual(['<p>第一段</p>\n<p>第二段完整</p>'])
  })

  it('hard line breaks keep a visible line gap after settling', () => {
    // Streaming shows single \n as <br /> (6px via .chat-md-body p br); the
    // settled parse must render the same structure instead of collapsing
    // the break into a space. (jsdom serializes the <br /> element as <br>.)
    const { container } = render(<MarkdownText pending={false} text={'行1\n行2'} />)
    expect(mdHtmlRuns(container)).toEqual(['<p>行1<br>行2</p>'])
  })
})
