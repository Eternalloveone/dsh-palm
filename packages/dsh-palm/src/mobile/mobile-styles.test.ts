/** 移动端样式契约：md 正文里的超长路径必须可折，代码/diff 卡保留横滚。 */
import { describe, expect, it } from 'vitest'
import { mobileCss } from './mobile-styles.ts'

const compact = (css: string): string => css.replace(/\s+/g, ' ')

describe('mobileCss long-token wrapping contract', () => {
  it('shows the whole session title instead of truncating it', () => {
    // 2026-10-20: the title shared its line with the date and truncation, so
    // every long title read as "子代理状态展…". The title now owns its line and
    // wraps; the date/status moved to .sess-meta underneath.
    const css = compact(mobileCss)
    expect(css).toContain('.sess-title { display: block; min-width: 0; white-space: normal; overflow-wrap: anywhere;')
    expect(css).not.toContain('.sess-title { flex: 0 1 auto; min-width: 0; overflow: hidden;')
    expect(css).toContain('.sess-meta { display: flex; align-items: center; flex-wrap: wrap;')
  })
  it('gives the session row a wider title column than the shared card row', () => {
    // The icon column (48→36) and the chevron column (48→24) used to eat the
    // title's width. Only the session row narrows — the workspace/settings rows
    // keep their 48px column because their icon is a 48px .ws-icon.
    const css = compact(mobileCss)
    expect(css).toContain('.mobile-row-sess { grid-template-columns: 36px minmax(0, 1fr) auto; gap: 8px; }')
    expect(css).toContain('.mobile-row-sess .card-action { min-width: 24px; }')
    expect(css).toContain('.card-action { min-width: 48px;')
  })
  it('keeps the running status dot a small circle, not an icon tile', () => {
    // `.card-icon > *` sizes every direct child as a 40px rounded icon box, so
    // the 8px running dot grew into a green square (phone report 2026-10-20).
    const css = compact(mobileCss)
    expect(css).toContain('.card-icon > .sess-dot { width: 8px; height: 8px; border-radius: var(--radius-full); }')
  })
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

/**
 * Page-transition stacking contract (#10).
 *
 * 减弱动态效果（prefers-reduced-motion: reduce）关掉页面动画后，退出页仍以
 * position:absolute 的不透明整屏覆盖层压在进入页上整整 260ms，然后把新页
 * 「弹」出来 —— iOS Safari 用户实测就是这个观感。所以 reduce 分支里必须整块
 * 不渲染退出页；正常动画分支则把层叠顺序写死（前进：进入页在上；返回：退出页
 * 在上），不要靠「定位元素天然盖住静态元素」这个副作用。
 */
describe('mobileCss page-transition stacking contract', () => {
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const at = css.indexOf(`${selector} {`)
    expect(at, `${selector} must exist`).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at) + 1)
  }
  const zIndexOf = (selector: string): number => {
    const match = /z-index:\s*(-?\d+)/.exec(rule(selector))
    expect(match, `${selector} must declare z-index`).not.toBeNull()
    return Number((match as RegExpExecArray)[1])
  }
  // Every reduce block, braces balanced, as compacted text.
  const reduceBlocks = (): string[] => {
    const blocks: string[] = []
    let from = 0
    for (;;) {
      const at = mobileCss.indexOf('@media (prefers-reduced-motion: reduce)', from)
      if (at === -1) return blocks
      let depth = 0
      let i = mobileCss.indexOf('{', at)
      for (; i < mobileCss.length; i += 1) {
        if (mobileCss[i] === '{') depth += 1
        else if (mobileCss[i] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      blocks.push(compact(mobileCss.slice(mobileCss.indexOf('{', at), i + 1)))
      from = i + 1
    }
  }

  it('drops the stacked exit page when the reduce query kills the animation', () => {
    // The exit page keeps its absolute positioning when the animation is off, so
    // "animation: none" alone leaves an opaque full-stage overlay above the new
    // page. The branch that hides the animation has to hide that page as well —
    // reduce motion means an instant swap, not a 260ms covered swap.
    const owning = reduceBlocks().filter((block) => block.includes('.page-enter-fwd'))
    expect(owning, 'the page classes must be covered by a reduce block').toHaveLength(1)
    expect(owning[0]).toContain('animation: none;')
    expect(owning[0]).toContain('.page-exit-fwd, .page-exit-back { display: none; }')
  })

  it('states the stacking order for both directions', () => {
    // Push slides the new page in over the old one, pop slides the old page away
    // over the new one. Both are flex items of .page-stage, which honour z-index
    // even without position, so the order no longer depends on "positioned paints
    // above static" (that accident was what made only the pop direction right).
    expect(zIndexOf('.page-enter-fwd')).toBeGreaterThan(zIndexOf('.page-exit-fwd'))
    expect(zIndexOf('.page-exit-back')).toBeGreaterThan(zIndexOf('.page-enter-back'))
  })

  it('keeps the leaving page out of the hit-test surface', () => {
    // Both exit rules must stay pointer-events:none and absolutely stacked, or a
    // tap during the animation would land on the page that is leaving.
    for (const selector of ['.page-exit-fwd', '.page-exit-back']) {
      expect(rule(selector)).toContain('position: absolute;')
      expect(rule(selector)).toContain('pointer-events: none;')
    }
  })
})

describe('mobileCss tap-target contract', () => {
  it('gives the mini stop button a 44px hit area without growing its face', () => {
    // 30px（窄屏 26px）在手机上真的会按空，尤其单手握着、拇指贴着屏幕边缘的时候。
    // 视觉尺寸保持不变（和主键拉开距离，避免误触），判定区靠伪元素补到 44px。
    const css = compact(mobileCss)
    expect(css).toContain('.chat-stop-mini { position: relative; }')
    expect(css).toContain(".chat-stop-mini::after { content: ''; position: absolute; inset: -7px; }")
  })

  it('spaces stacked subagent rows apart', () => {
    // 子代理行是 flex 行，容器没有 gap 时两条记录贴在一起，看起来像一条换了行。
    const css = compact(mobileCss)
    expect(css).toMatch(/\.chat-subagent-list \{[^}]*display: flex/)
    expect(css).toMatch(/\.chat-subagent-list \{[^}]*flex-direction: column/)
    expect(css).toMatch(/\.chat-subagent-list \{[^}]*gap: 8px/)
  })
  it('lays the expanded goal text out as readable body copy', () => {
    // 2026-10-22 真机：展开的目标是一段带小标题/空行/编号的多段文本，原先挤在按钮里
    // 用 normal + 12px，换行全丢、段落不分，读起来是一条文字墙。
    const css = compact(mobileCss)
    // 保留宿主给的换行与空行，否则多段目标会连成一段。
    expect(css).toMatch(/\.chat-goal-body \{[^}]*white-space: pre-wrap/)
    // 正文级行高与字号：13px 以下 + 单倍行高在手机上读不动。
    expect(css).toMatch(/\.chat-goal-body \{[^}]*line-height: 1\.65/)
    expect(css).toMatch(/\.chat-goal-body \{[^}]*font-size: var\(--text-base\)/)
    // 长目标不能把输入框挤出屏幕：限高后自己滚。
    expect(css).toMatch(/\.chat-goal-body \{[^}]*max-height: 38vh/)
  })

  it('keeps the composer icons on the input box centre line', () => {
    // 2026-10-22 真机：输入框一长成两行，+ / 命令 / 语音 / 停止 / 发送就贴在底边，
    // 看着像没对齐。整行改中线对齐，几个按钮也不许自己再贴底。
    const css = compact(mobileCss)
    expect(css).toMatch(/\.chat-inputbar \{[^}]*align-items: center/)
    expect(css).toMatch(/\.chat-attach-btn \{[^}]*align-self: center/)
    expect(css).toMatch(/\.chat-send \{[^}]*align-self: center/)
    expect(css).toMatch(/\.chat-stop-mini \{[^}]*align-self: center/)
  })

  it("gives the voice sheet's only exit a 44px height", () => {
    const css = compact(mobileCss)
    expect(css).toMatch(/\.voice-done \{[^}]*height: 44px/)
  })
})

describe('mobileCss structure', () => {
  it('keeps every rule closed (one stray brace kills the rest of the sheet)', () => {
    // 2026-10-22 真机现场：命令面板、附件面板、长按菜单全变成白底黑字的默认按钮，
    // 命令行说明还和名字黏在一起（"/compactCompact older conversation history"）。
    // 根因不是排版，是文件里少了一个右花括号 —— 浏览器从那一行往后把整段样式
    // 当成同一条规则的声明，后面所有规则一律失效。肉眼看不见，只能靠计数兜住。
    const source = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    for (const char of source) {
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        expect(depth).toBeGreaterThanOrEqual(0)
      }
    }
    expect(depth).toBe(0)
  })
})
