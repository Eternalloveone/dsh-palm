/** 移动端样式契约：md 正文里的超长路径必须可折，代码/diff 卡保留横滚。 */
import { describe, expect, it } from 'vitest'
import { mobileCss } from './mobile-styles.ts'

const compact = (css: string): string => css.replace(/\s+/g, ' ')

describe('mobileCss long-token wrapping contract', () => {
  it('wraps unbreakable tokens inside the .md-html prose run', () => {
    // A too-long file path (no spaces) must wrap inside the md text run, or
    // it stretches the message / .fp-md file preview past the screen edge.
    const css = compact(mobileCss)
    expect(css).toContain('.chat-md-body .md-html { overflow-wrap: anywhere; word-break: normal; }')
    // The wrap applies to prose children too (their min-width must not feed a
    // wider min-content back into a flex parent).
    expect(css).toContain('.chat-md-body .md-html p,')
    expect(css).toContain('min-width: 0;')
  })

  it('keeps code and diff cards horizontally scrollable (unaffected by wrapping)', () => {
    const css = compact(mobileCss)
    // Long code lines stay scrollable, never re-wrapped by the prose rule.
    expect(css).toContain('.code-body { padding: 12px 16px; overflow-x: auto')
    expect(css).toContain('.diff-body { overflow-x: auto')
  })

  it('makes file-preview bodies selectable (opt out of global user-select:none)', () => {
    const css = compact(mobileCss)
    // The sheet previews (code/plain and markdown) must allow long-press text
    // selection even though the app body sets user-select:none globally.
    expect(css).toContain('.fp-body {')
    expect(css).toContain('user-select: text;')
    expect(css).toContain('.fp-md {')
  })

  it('colors the artifact +/- tally green (add) and red (del)', () => {
    const css = compact(mobileCss)
    // The diff artifact head's line tally must read at a glance: additions
    // green, deletions red, reusing the diff palette.
    expect(css).toContain('.chat-artifact-stat-add { color: var(--diff-add); }')
    expect(css).toContain('.chat-artifact-stat-del { color: var(--diff-del); }')
  })

  it('never scales a swipe row on press (the red delete action sits right behind it)', () => {
    const css = compact(mobileCss)
    // The session row rides on top of the swipe wrapper's always-present delete
    // button. The global press scale shrank the card to 98%, so every tap let a
    // red edge show along the right side — it read as "the delete button just
    // appeared". The press feedback keeps the background wash; the transform is
    // cancelled inside the swipe wrapper only.
    expect(css).toContain('.mobile-row-swipe .mobile-row:active { transform: none; }')
  })
})
