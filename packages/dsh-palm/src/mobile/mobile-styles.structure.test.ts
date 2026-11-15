/**
 * 样式表的结构自检：这一层检查的是「肉眼看不见、截图只能看到症状」的那类损坏。
 *
 * 2026-10-22 真机现场：手机端点「+」和「/」弹的两个面板变成白底黑字的默认按钮，命令名和
 * 说明黏成一行。根因不是排版，是一条规则少了收尾花括号 —— 从那一行往后，浏览器把整段
 * 当成同一条规则的声明列表，后面所有规则（面板、菜单、语音、字号系统）全部静默失效。
 * 排在前面的气泡和输入框看着完全正常，所以第一眼看不出问题在样式表里。
 *
 * 所以这里不去断言某条具体样式（那有别的用例管），而是断言样式表**作为一份 CSS 是成立的**：
 *
 * 1. 每个块都能正常收尾，块内不会突然冒出一个新的 `{`（这正是少括号之后的形态）；
 * 2. 同一个块里没有重复声明（复制粘贴/行编辑事故的共同痕迹，后者会让前者失效）；
 * 3. 用到的每一个 `var(--x)` 都真的被定义过（历史事故：写了不存在的 `--radius-md`）。
 *
 * @module dsh-palm/mobile/mobile-styles.structure.test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mobileCss } from './mobile-styles.ts'

/** 去掉 CSS 注释，但保留换行，行号才对得上。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

function lineAt(css: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < css.length; i += 1) if (css[i] === '\n') line += 1
  return line
}

interface Block {
  /** 块的用途：普通规则体，或者 at-rule（@media / @supports …）里的容器。 */
  kind: 'rule' | 'at'
  /** 块前面的选择器/前导文本，用于报错。 */
  prelude: string
  /** 起始位置（字符下标）。 */
  at: number

}

/**
 * 最小 CSS 结构解析：只关心「块从哪开始、到哪结束、块里有没有不该有的 `{`」。
 *
 * 这不是完整的 CSS 解析器 —— 完整的解析器会把错误吞掉（浏览器就是这么表现的），
 * 而我们要的恰恰是把「被吞掉的那一刻」找出来，所以这里只做最保守的结构判断。
 */
function walkCss(css: string): { problems: string[]; ruleCount: number; atCount: number } {
  const source = stripComments(css)
  const problems: string[] = []
  const stack: Block[] = []
  let ruleCount = 0
  let atCount = 0
  let preludeStart = 0
  let paren = 0
  let quote: string | undefined

  const preludeOf = (end: number): string =>
    source.slice(preludeStart, end).trim().replace(/\s+/g, ' ').slice(0, 60)

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') { paren += 1; continue }
    if (char === ')') { paren = Math.max(0, paren - 1); continue }
    if (char === ';' && paren === 0) {
      // 声明边界只用来推进游标；重复声明的判断留给专门的用例（那里要放行 vh→dvh 分层写法）。
      preludeStart = i + 1
      continue
    }
    if (char === '{') {
      const top = stack[stack.length - 1]
      if (top !== undefined && top.kind === 'rule') {
        problems.push(
          `第 ${lineAt(source, preludeStart)} 行：规则 "${top.prelude}" 还没有收尾，`
          + `就出现了新块 "${preludeOf(i)}" —— 这里少了一个 }`,
        )
      }
      const prelude = preludeOf(i)
      const isAt = prelude.startsWith('@')
      stack.push({ kind: isAt ? 'at' : 'rule', prelude, at: i })
      if (isAt) atCount += 1
      else ruleCount += 1
      preludeStart = i + 1
      continue
    }
    if (char === '}') {
      const closed = stack.pop()
      if (closed === undefined) {
        problems.push(`第 ${lineAt(source, i)} 行：多了一个 }（前面没有未收尾的块）`)
      }
      preludeStart = i + 1
      continue
    }
  }

  if (quote !== undefined) problems.push('文件结束时还有没闭合的字符串引号')
  if (paren !== 0) problems.push(`文件结束时还有 ${paren} 个没闭合的圆括号`)
  for (const open of stack) {
    problems.push(`第 ${lineAt(source, open.at)} 行：块 "${open.prelude}" 到文件结束都没收尾`)
  }
  return { problems, ruleCount, atCount }
}

describe('mobileCss 结构自检', () => {
  it('每一块都能正常收尾（少一个括号会让后面整段静默失效）', () => {
    const { problems, ruleCount } = walkCss(mobileCss)
    expect(problems).toEqual([])
    // 顺带钉住规模：如果解析塌掉，规则数会骤降。
    expect(ruleCount).toBeGreaterThan(150)
  })

  it('同一个块里没有重复声明（复制粘贴与行编辑事故的痕迹）', () => {
    const duplicates: string[] = []
    const source = stripComments(mobileCss)
    const ruleBlocks = source.split('}')
    for (const block of ruleBlocks) {
      const open = block.indexOf('{')
      if (open < 0) continue
      const body = block.slice(open + 1)
      const seen = new Map<string, string>()
      for (const raw of body.split(';')) {
        const colon = raw.indexOf(':')
        if (colon <= 0) continue
        const property = raw.slice(0, colon).trim().toLowerCase()
        if (!/^[a-z-]+$/.test(property)) continue
        const value = raw.slice(colon + 1).trim()
        const previous = seen.get(property)
        // 允许的唯一形态：渐进增强的分层单位（先 vh 再 dvh/svh/lvh —— 老 WebView 用前一条，
        // 新浏览器用后一条）。除此之外的重复都是事故：后一条会把前一条静默吃掉。
        const layered = previous !== undefined && /dvh|svh|lvh|dvw|svw|lvw/.test(value)
        if (previous !== undefined && !layered) {
          duplicates.push(`${block.slice(0, open).trim()} 里重复了 ${property}`)
        }
        seen.set(property, value)
      }
    }
    expect(duplicates).toEqual([])
  })

  it('每个 var(--x) 都真的被定义过（写错变量名不会报错，只会不生效）', () => {
    // 运行时才注入的变量：由 TSX 侧用 style.setProperty 写进来，CSS 里当然查不到定义。
    // 下面会顺手核对「确实有人在写」，避免这条豁免哪天变成掩盖错误的口子。
    const runtimeInjected = new Map<string, string>([
      ['--voice-level', 'views/chat/hooks/use-chat-voice.ts'],
      // 2026-11-10：--palm-proc-ratio 随环形进度一起下线（组件不再写这个变量）。
    ])
    const defined = new Set<string>()
    for (const match of mobileCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(match[1] as string)
    const used = new Set<string>()
    for (const match of mobileCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(match[1] as string)
    const missing = [...used].filter(name => !defined.has(name) && !runtimeInjected.has(name)).sort()
    expect(missing).toEqual([])
    for (const [name, file] of runtimeInjected) {
      const writer = readFileSync(join(import.meta.dirname, file), 'utf8')
      // 三种写法都算「确实有人写它」：setProperty、React 的 style 对象键、
      // 或 `['--x' as string]: value`（TS 里写自定义属性的常见写法）。
      expect(writer.includes(name)).toBe(true)
    }
  })

  it('tone 令牌由皮肤令牌驱动（只定义一次，不再按明暗主题铺三份）', () => {
    // 2026-11-10「主题与皮肤冲突」收口后：tone 这类界面颜色**只有桥接段一处定义**，
    // 值指向 --palm-*，所以换皮肤就换色。原来按 :root / [data-theme=dark] /
    // prefers-color-scheme 铺三份，正是"两套色板打架"的形态。
    const counts = new Map<string, number>()
    for (const match of mobileCss.matchAll(/(--tone-[a-z0-9-]+)\s*:/g)) {
      counts.set(match[1] as string, (counts.get(match[1] as string) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThan(0)
    const duplicated = [...counts]
      .filter(([, count]) => count !== 1)
      .map(([name, count]) => `${name} 定义了 ${count} 处（应只由桥接段定义一次）`)
    expect(duplicated).toEqual([])
    const bridge = mobileCss.slice(mobileCss.indexOf('旧名桥接'))
    for (const name of counts.keys()) {
      expect(bridge, `${name} 没有桥接回皮肤令牌`).toContain(`${name}: var(--palm-`)
    }
  })
})

describe('子代理详情页要能上下滚', () => {
  // 2026-11-12 真机：「子代理界面看起来上下滑不动」。根因是照抄了 settingsLayout
  // 却漏了滚动三段式 —— 页面根不是 flex 列、grow 槽没限高、正文没 overflow，于是
  // 内容超出屏幕既不滚也被裁。组件测试测不出这种事，只能在这里钉住。
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const ruleBody = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('① 页面根是吃满高度的 flex 列', () => {
    expect(ruleBody('.subagent-page')).toContain('display: flex')
    expect(ruleBody('.subagent-page')).toContain('flex-direction: column')
    expect(ruleBody('.subagent-page')).toContain('block-size: 100%')
    expect(ruleBody('.subagent-page')).toContain('min-block-size: 0')
  })

  it('② grow 槽只限高，不自带滚动', () => {
    expect(ruleBody(".subagent-page [data-slot='groups']")).toContain('overflow: hidden')
  })

  it('③ 正文才是滚动容器', () => {
    expect(ruleBody('.subagent-page-body')).toContain('overflow-y: auto')
    expect(ruleBody('.subagent-page-body')).toContain('min-block-size: 0')
    expect(ruleBody('.subagent-page-body')).toContain('flex: 1 1 auto')
    expect(ruleBody('.subagent-page-body')).toContain('overscroll-behavior: contain')
  })
})

describe('元信息行必须压在面板遮罩之上', () => {
  // 2026-11-12 真机：「点模型或权限，底部出现一条灰色长条」。`.chat-picker-scrim`
  // 在 DOM 里排在 `.chat-meta` 后面、又不透明背景，元信息行没建层叠上下文就被压上
  // 12% 黑；顺带让那一行的胶囊点不到（点击只会关面板）。
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const ruleBody = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('.chat-meta 自建层叠上下文，且层级与输入行一致', () => {
    const body = ruleBody('.chat-meta')
    expect(body).toContain('position: relative')
    expect(body).toContain('z-index: var(--z-composer)')
  })

  it('底栏整块有不透明底色（底边的安全区留白不露出遮罩）', () => {
    expect(ruleBody('.chat-dock')).toContain('background: var(--palm-bg)')
  })
})

describe('对话页头部视觉层级', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const ruleBody = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('标题和工作区名共用中轴，工作区名使用可读的次级文字层级', () => {
    expect(ruleBody('.mobile-header')).toContain('grid-template-columns: 48px minmax(0, 1fr) 48px')
    expect(ruleBody('.mobile-titleWrap')).toContain('text-align: center')
    expect(ruleBody('.mobile-titlePath')).toContain('font-size: var(--text-sm)')
    expect(ruleBody('.mobile-titlePath')).toContain('color: var(--text-secondary)')
    expect(ruleBody('.mobile-titlePath')).toContain('text-align: center')
  })
})

/**
 * 尺寸契约：2026-11-08 实机投诉的两处渲染事故都出在「没有上限就没有版式」。
 *
 * 1. 过程区把 12 次工具调用画成 12 张 90px 上下的卡，一屏只看得到 6 条；
 * 2. 抽屉里的 SVG 只有 viewBox、没有 width/height，在 flex 行里按替换元素默认的
 *    300×150 参与布局，被行宽一挤就等比撑满整行，文字被压在图标下折行。
 *
 * 这两条都发生在**合成后的 mobileCss**（真正下发到浏览器的字符串）里，所以按既有
 * 结构自检的口径直接读它：令牌值与规则体都断言出来，肉眼看不出、截图只看到症状。
 */
describe('版式尺寸契约（过程行 / 抽屉）', () => {
  /** 取一条规则的声明体；选择器要写全（`.chat-proc` 不会匹配到 `.chat-proc-tools`）。 */
  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(mobileCss)
    if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
    return match[1] ?? ''
  }

  /** 选择器所在规则组的声明体（合并选择器也算命中：`.a,\n.b { … }`）。 */
  function declarationOf(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const blocks = [...mobileCss.matchAll(new RegExp('[^{}]*' + escaped + '[^{}]*\\{([^}]*)\\}', 'g'))]
      .map(match => match[1] ?? '')
    if (blocks.length === 0) throw new Error(`样式表里找不到选择器 ${selector}`)
    return blocks.join('\n')
  }

  /** 读一个 px 令牌的数值（没定义或不是 px 一律报错，不做"读不到就放过"）。 */
  function pxToken(name: string): number {
    const match = new RegExp(name + ':\\s*(-?\\d+(?:\\.\\d+)?)px').exec(mobileCss)
    if (match === null) throw new Error(`找不到 px 令牌 ${name}`)
    return Number(match[1])
  }

  it('过程行一行一步：行高 ≤36px、上下留白 6–8px', () => {
    expect(pxToken('--palm-proc-row-h')).toBeLessThanOrEqual(36)
    expect(pxToken('--palm-proc-row-h')).toBeGreaterThanOrEqual(34)
    expect(pxToken('--palm-proc-row-pad')).toBeGreaterThanOrEqual(6)
    expect(pxToken('--palm-proc-row-pad')).toBeLessThanOrEqual(8)
    // 行高从令牌走：改回写死的 44px 命中高度会让 12 条工具重新刷两屏。
    expect(ruleBody('.chat-step-head')).toContain('min-height: var(--palm-proc-row-h)')
    expect(ruleBody('.chat-step-head')).toContain('padding: var(--palm-proc-row-pad) 0')
  })

  it('过程摘要静态行 24px，可点击行实体占位 44px，不侵入相邻行', () => {
    expect(pxToken('--palm-proc-head-h')).toBe(24)
    expect(pxToken('--palm-proc-head-size')).toBeLessThanOrEqual(11)
    expect(pxToken('--palm-hit')).toBe(44)
    expect(ruleBody('.chat-proc-head')).toContain('min-height: var(--palm-proc-head-h)')
    expect(ruleBody('.chat-proc-head')).toContain('font-size: var(--palm-proc-head-size)')
    expect(ruleBody('.chat-proc-head:not(.chat-proc-head-static)')).toContain('min-height: var(--palm-hit)')
    expect(mobileCss).not.toContain('.chat-proc-head:not(.chat-proc-head-static)::after')
    expect(ruleBody('.palm-proc')).toContain('min-block-size: var(--palm-proc-head-h)')
    expect(ruleBody('button.palm-proc')).toContain('min-block-size: var(--palm-hit)')
  })

  it('标准聊天正文使用 15px，系统字号设置仍覆盖到 13px / 18px', () => {
    expect(pxToken('--palm-chat-body-size')).toBe(15)
    expect(ruleBody('.chat-msg')).toContain('font-size: var(--palm-chat-body-size)')
    expect(declarationOf("[data-font-scale='small'] .chat-msg")).toContain('font-size: 13px')
    expect(declarationOf("[data-font-scale='large'] .chat-msg")).toContain('font-size: 18px')
  })

  it('过程区不再画卡片外壳：无描边无底色，行间最多一条极淡分隔线', () => {
    const group = ruleBody('.chat-proc')
    expect(group).not.toContain('border:')
    expect(group).not.toContain('background:')
    expect(group).not.toContain('border-radius:')
    // 分隔线只认极淡的 --palm-line（不是把行重新画成一张张卡）。
    expect(ruleBody('.chat-step')).toContain('border-top: var(--palm-hair) solid var(--palm-line)')
  })

  it('已完成过程收起步骤，活动态保留错误步骤', () => {
    expect(ruleBody(".chat-proc[data-tools='summary'] > .chat-proc-tools")).toContain('display: none')
    expect(ruleBody(".chat-proc[data-tools='active'] > .chat-proc-tools > .chat-step[data-state='ok']")).toContain('display: none')
  })

  it('抽屉图标固定 16×16 且 flex:none（撑满整行的根因）', () => {
    expect(pxToken('--palm-drawer-glyph')).toBe(16)
    const svg = ruleBody('.palm-drawer svg')
    expect(svg).toContain('flex: none')
    expect(svg).toContain('inline-size: var(--palm-drawer-glyph)')
    expect(svg).toContain('block-size: var(--palm-drawer-glyph)')
  })

  it('抽屉行内文案单行 + 省略号（图标固定后折行的唯一来源）', () => {
    for (const selector of ['.palm-drawer-new > span', '.palm-drawer-search > span', '.palm-drawer-tool > span']) {
      const declarations = declarationOf(selector)
      expect(declarations, selector).toContain('white-space: nowrap')
      expect(declarations, selector).toContain('text-overflow: ellipsis')
      expect(declarations, selector).toContain('overflow: hidden')
    }
    expect(ruleBody('.palm-drawer-title')).toContain('text-overflow: ellipsis')
  })

  it('抽屉头像 36×36、迷你状态条 88×18，都不参与 flex 拉伸', () => {
    expect(pxToken('--palm-drawer-avatar')).toBe(36)
    expect(ruleBody('.palm-drawer-avatar')).toContain('inline-size: var(--palm-drawer-avatar)')
    expect(pxToken('--palm-drawer-strip-w')).toBe(88)
    expect(pxToken('--palm-drawer-strip-h')).toBe(18)
    const strip = ruleBody(".palm-drawer-row .palm-strip[data-size='mini']")
    expect(strip).toContain('flex: none')
    expect(strip).toContain('inline-size: var(--palm-drawer-strip-w)')
    expect(strip).toContain('block-size: var(--palm-drawer-strip-h)')
  })

  it('抽屉的新建和搜索入口与会话行统一为 44px 触控高度', () => {
    expect(pxToken('--palm-drawer-new-h')).toBe(44)
    expect(pxToken('--palm-drawer-search-h')).toBe(44)
    expect(ruleBody('.palm-drawer-new')).toContain('block-size: var(--palm-drawer-new-h)')
    expect(ruleBody('.palm-drawer-search')).toContain('block-size: var(--palm-drawer-search-h)')
  })
})

describe('审批与产物 surface 契约', () => {
  function declarations(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(mobileCss)
    if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
    return match[1] ?? ''
  }

  it('错误和审批警示面板以语义危险/警告底色区分', () => {
    expect(declarations('.error-note')).toContain('background: var(--palm-tint-danger)')
    expect(declarations('.approval-detail-warning')).toContain('background: var(--palm-tint-warn)')
    expect(declarations('.approval-detail-risk[data-risk=\'write\']')).toContain('border-color: var(--palm-warn)')
    expect(declarations(".approval-detail-risk[data-risk='install']")).toContain('border-color: var(--palm-danger)')
  })

  it('diff 和产物表头维持紧凑内容，但可点击产物头至少 44px 高', () => {
    expect(declarations('.diff-head')).toContain('min-height: var(--palm-hit)')
    expect(declarations('.chat-artifact-head')).toContain('min-height: var(--palm-hit)')
    expect(declarations('.chat-artifact-title')).toContain('padding: 6px 0 6px 10px')
  })

  it('会话内待决定审批使用警告边框和底色', () => {
    const panel = declarations('.chat-approval-panel')
    expect(panel).toContain('border: 1px solid var(--palm-warn)')
    expect(panel).toContain('background: var(--palm-tint-warn)')
  })

  it('审批与提问控件满足统一触控高度，答案输入保持 16px 字号', () => {
    for (const selector of [
      '.chat-approval-allow',
      '.chat-approval-reject',
      '.chat-question-option',
      '.chat-question-submit',
    ]) {
      expect(declarations(selector), selector).toContain('min-height: var(--palm-hit)')
    }
    expect(declarations('.chat-question-custom')).toContain('min-height: var(--palm-hit)')
    expect(declarations('.chat-question-custom')).toContain('font-size: 16px')
    for (const selector of [
      '.chat-approval-allow:active',
      '.chat-approval-reject:active',
      '.chat-question-option:active',
      '.chat-question-submit:active',
    ]) {
      expect(declarations(selector), selector).not.toContain('transform:')
    }
  })

  it('审批与提问交互表面只依赖皮肤感知的语义令牌', () => {
    expect(declarations('.chat-approval-allow')).toContain('background: var(--palm-accent)')
    expect(declarations('.chat-approval-reject')).toContain('border: var(--palm-hair) solid var(--palm-line)')
    expect(declarations('.chat-approval-reject')).toContain('color: var(--palm-fg-2)')
    expect(declarations('.chat-question-panel')).toContain('background: var(--palm-sur-1)')
    expect(declarations('.chat-question-panel')).toContain('box-shadow: var(--palm-sh1)')
    expect(declarations('.chat-question-option-selected')).toContain('background: var(--palm-tint-accent)')
    expect(declarations('.chat-question-custom')).toContain('background: var(--palm-sur-1)')
    expect(declarations('.chat-question-submit')).toContain('background: var(--palm-accent)')
    for (const selector of [
      '.chat-approval-allow',
      '.chat-approval-reject',
      '.chat-question-panel',
      '.chat-question-option',
      '.chat-question-option-selected',
      '.chat-question-custom',
      '.chat-question-submit',
    ]) {
      expect(declarations(selector), selector).not.toMatch(/var\(--(?:accent|card-bg|card-shadow|border-default|fill|bg-input|text-primary|text-secondary|text-tertiary)\)/)
    }
  })

  it('强调色按钮文字使用皮肤级 on-accent 对比令牌', () => {
    expect(declarations('.chat-approval-allow')).toContain('color: var(--palm-on-accent)')
    expect(declarations('.chat-question-submit')).toContain('color: var(--palm-on-accent)')
    expect(mobileCss).toMatch(/html\[data-skin='paper'\]\s*\{[^}]*--palm-on-accent:\s*#ffffff/)
    expect(mobileCss).toMatch(/html\[data-skin='nocturne'\]\s*\{[^}]*--palm-on-accent:\s*#0a0a0f/)
  })

  it('diff 按钮保留 28px 视觉高度，只扩展纵向的 44px 命中区', () => {
    const button = declarations('.diff-btn')
    expect(button).toContain('height: 28px')
    expect(button).toContain('position: relative')
    const hitArea = declarations('.diff-btn::after')
    expect(hitArea).toContain("content: ''")
    expect(hitArea).toContain('position: absolute')
    expect(hitArea).toContain('inset-inline: 0')
    expect(hitArea).toContain('inset-block-start: 50%')
    expect(hitArea).toContain('block-size: var(--palm-hit)')
    expect(hitArea).toContain('transform: translateY(-50%)')
  })

  it('逐行审阅为每个动作独占 44px 单元，静态 diff 保留原密度', () => {
    expect(declarations('.diff-row')).not.toContain('min-height:')
    const row = declarations('.diff-row-review')
    expect(row).toContain('min-height: var(--palm-hit)')
    expect(row).toContain('grid-template-columns: var(--palm-hit) 40px 40px minmax(0, 1fr)')
    const cell = declarations('.diff-review-cell')
    expect(cell).toContain('position: relative')
    expect(cell).toContain('align-self: stretch')
    expect(declarations('.diff-line-btn')).toContain('width: 20px')
    expect(declarations('.diff-line-btn')).toContain('height: 20px')
    expect(declarations('.diff-line-btn::after')).toContain('position: absolute')
    expect(declarations('.diff-line-btn::after')).toContain('inset: 0')
    // transform / filter 会让按钮自身成为伪元素定位容器，命中区缩回 20px。
    expect(declarations('.diff-line-btn:active')).not.toContain('transform:')
    expect(declarations('.diff-line-btn:active')).not.toContain('filter:')
    expect(declarations('.diff-line-btn-on')).not.toContain('filter:')
  })

  it('diff 展开、确认和结果动作各自保留 44px 实体高度', () => {
    for (const selector of ['.diff-fold-btn', '.diff-confirm', '.diff-undo']) {
      expect(declarations(selector), selector).toContain('min-height: var(--palm-hit)')
    }
    expect(declarations('.diff-fold-btn')).not.toContain('height: 30px')
    expect(declarations('.diff-confirm')).not.toContain('height: 32px')
  })

  it('审批参数展开动作占据自己的 44px 高度，不扩展到相邻动作', () => {
    expect(declarations('.chat-approval-expand')).toContain('min-height: var(--palm-hit)')
  })
})

describe('设置页表单触控契约', () => {
  function declarations(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(mobileCss)
    if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
    return match[1] ?? ''
  }

  it('开关保持 44×32 视觉轨道，同时按钮热区达到 44×44', () => {
    expect(declarations('.settings-switch')).toContain('width: var(--palm-hit)')
    expect(declarations('.settings-switch')).toContain('height: var(--palm-hit)')
    expect(declarations('.settings-switch')).toContain('background: transparent')
    expect(declarations('.settings-switch::before')).toContain('width: var(--palm-hit)')
    expect(declarations('.settings-switch::before')).toContain('height: 32px')
    expect(declarations('.settings-switch::before')).toContain('border-radius: 16px')
  })

  it('设置输入和选项控件满足 44px 触控高度与 16px 输入字号', () => {
    for (const selector of ['.settings-input', '.settings-textarea']) {
      expect(declarations(selector), selector).toContain('min-height: var(--palm-hit)')
      expect(declarations(selector), selector).toContain('font-size: 16px')
    }
    // 2026-11-10：主题设置整块移除后，.settings-themeOption 不再存在，只留选项芯片。
    for (const selector of ['.settings-optionChip']) {
      expect(declarations(selector), selector).toContain('min-height: var(--palm-hit)')
    }
  })
})

describe('搜索页输入与清除触控契约', () => {
  function declarations(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(mobileCss)
    if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
    return match[1] ?? ''
  }

  it('搜索框、输入字号和清除按钮都达到 44px，清除区不侵入输入框', () => {
    expect(mobileCss).toMatch(/--palm-spec-search-h:\s*44px/)
    expect(declarations('.palm-spec-search')).toContain('height: var(--palm-spec-search-h)')
    expect(declarations('.palm-spec-search-field')).toContain('font-size: 16px')
    expect(declarations('.palm-spec-search-clear')).toContain('width: var(--palm-spec-search-h)')
    expect(declarations('.palm-spec-search-clear')).toContain('height: var(--palm-spec-search-h)')
    expect(mobileCss).not.toMatch(/\.palm-spec-search-clear::after\s*\{/)
  })
})

describe('composer 与 dock 触控和对齐契约', () => {
  function declarations(selector: string): string {
    const css = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const blocks = css.split('}').flatMap(block => {
      const open = block.lastIndexOf('{')
      if (open < 0) return []
      const prelude = block.slice(0, open).trim().replace(/\s+/g, ' ')
      if (!prelude.split(',').some(candidate => candidate.trim() === selector)) return []
      return [block.slice(open + 1)]
    })
    if (blocks.length === 0) throw new Error('样式表里找不到规则 ' + selector)
    return blocks.join('\n')
  }

  it('输入框满足 16px 防缩放、44px 高度和统一焦点环', () => {
    const input = declarations('.chat-input')
    expect(input).toContain('min-height: var(--palm-hit)')
    expect(input).toContain('font-size: 16px')
    const field = declarations('.chat-field')
    expect(field).toContain('min-height: var(--palm-dock-field-h)')
    // 2026-11-10 第三轮：**外壳不再留内边距**（textarea 自己带 12/16），
    // 输入/点按的区域覆盖整个框 —— 用户要的「文字区域跟框一样大」。
  expect(field).toContain('padding: 0')
  expect(field).toContain('border-radius: 18px')
    // 框内 textarea 只负责文字：22px 行高（4 行整 = 92px 封顶），触控高度由外壳保证。
  expect(declarations('.chat-field > .chat-input')).toContain('min-height: 46px')
  // 2026-11-12：左右 16 → 12（用户：「一行放不了几个字」）。字形仍离圆弧有余量。
    expect(declarations('.chat-field > .chat-input')).toContain('padding: 12px 12px')
  expect(declarations('.chat-field > .chat-input')).toContain('line-height: 22px')
    expect(mobileCss).toContain('--palm-dock-field-h: 48px')
    expect(mobileCss).toContain('--palm-dock-input-h: 44px')
    expect(declarations('.chat-field:focus-within')).toContain('box-shadow: 0 0 0 3px var(--palm-tint-accent)')
    expect(declarations('.chat-inputbar')).toContain('padding: var(--palm-s2) var(--palm-dock-pad)')
  })

  it('发送、停止和附件按钮视觉紧凑但各自达到触控下限', () => {
    for (const selector of ['.chat-send', '.chat-attach-btn', '.chat-stop-mini']) {
      expect(declarations(selector), selector).toContain('position: relative')
    }
    expect(declarations('.chat-send')).toContain('width: var(--palm-dock-circle)')
    // 2026-11-12：附件键单独缩到 28（用户选了「缩小不隐藏」，把宽度让给文字），
    // 发送键仍是 --palm-dock-circle。命中区由伪元素补到 44。
    expect(declarations('.chat-attach-btn')).toContain('width: 28px')
    expect(declarations('.chat-send::after')).toContain('inset: calc((var(--palm-hit) - var(--palm-dock-circle)) / -2)')
    expect(declarations('.chat-attach-btn::after')).toContain('inset: -8px')
    expect(declarations('.chat-stop-mini::after')).toContain('inset: calc(var(--palm-s2) * -0.75)')
  })

  it('待发队列动作与编辑输入达到 44px 触控目标', () => {
    // 2026-11-10：主按钮视觉压到 30px（用户嫌大），命中区仍要 44 —— 用伪元素纵向补，
    // 不占布局，也不挤压相邻的 ⋯。编辑框照旧 44。
    //
    // 同日再改：头行与正文行按用户要求压到 32（面板太高），44 的目标移到**行内控件**：
    // 按钮用 ::after 补命中区，文字行同样用 ::after 纵向补 6（见下方断言）。
    // `.queue-dockInput` 已迁到逻辑属性（和下面 `.queue-dockBtn` 的 min-block-size
    // 一致）；`.queue-dockHead`／`.queue-dockText` 仍是物理属性。两种写法都在用，
    // 断言跟着各自的实现走。
    expect(declarations('.queue-dockInput')).toContain('min-block-size: var(--palm-hit)')
    expect(declarations('.queue-dockHead')).toContain('min-height: var(--palm-queue-row-h)')
    expect(declarations('.queue-dockText')).toContain('min-height: var(--palm-queue-row-h)')
    expect(declarations('.queue-dockText::after')).toContain('inset-block: calc(var(--palm-queue-row-hit) * -1)')
    // 2026-11-10 第二次收小：30 → 26（令牌），命中区仍 44（26 + 9*2）。
    expect(declarations('.queue-dockBtn')).toContain('min-block-size: var(--palm-queue-btn-h)')
    expect(declarations('.queue-dockBtn')).toContain('min-inline-size: var(--palm-queue-btn-h)')
    expect(declarations('.queue-dockBtn::after')).toContain('inset-block: calc(var(--palm-queue-btn-hit) * -1)')
    expect(declarations('.queue-dockInput')).toContain('font-size: 16px')
    expect(declarations('.queue-dockText')).toContain('text-overflow: ellipsis')
  })

  it('运行状态、目标条与插入条操作各自有独立的 44px 命中区', () => {
    expect(declarations('.chat-status-strip')).toContain('min-height: var(--palm-hit)')
    // 目标条状态行改成一行的信息+工具栏之后，判定区由 ::after 撑（视觉 30px，
    // 上下各溢出 7px ⇒ 44px），与文件里其它图标按钮同一套做法。
    expect(declarations('.chat-goal-head')).toContain('min-height: 30px')
    expect(declarations('.chat-goal-main::after')).toContain('inset-block: -7px')
    expect(declarations('.chat-goal-icon')).toContain('height: 30px')
    expect(declarations('.chat-goal-icon::after')).toContain('inset-block: -7px')
    expect(declarations('.chat-goal-btn')).toContain('min-width: var(--palm-hit)')
    expect(declarations('.chat-goal-btn::after')).toContain('inset-block: -8px')
    expect(declarations('.chat-goal-btn::after')).toContain('inset-inline: 0')
    expect(declarations('.chat-goal-input')).toContain('min-height: var(--palm-hit)')
    expect(declarations('.chat-goal-input')).toContain('font-size: 16px')
    expect(declarations('[data-insert-summary]')).toContain('min-height: var(--palm-insert-h)')
    expect(declarations('[data-insert-details] li')).toContain('height: var(--palm-insert-row-h)')
    expect(declarations('[data-insert-withdraw]')).toContain('height: var(--palm-insert-row-h)')
    expect(mobileCss).not.toMatch(/\[data-insert-withdraw\]::after\s*\{/)
  })

  /**
   * 2026-11-12 真机重叠的结构护栏：状态行里的信息必须可省略、且不得画出自己的盒子。
   * 只要 `.chat-goal-main` 仍是 overflow:hidden、摘要仍是 flex:0 1 auto + 省略号，
   * 无论摘要多长都只会被裁掉，不会压到右侧工具栏上。
   */
  it('目标条状态行只裁不压：信息盒裁剪、摘要可省略', () => {
    expect(declarations('.chat-goal-main')).toContain('overflow: hidden')
    expect(declarations('.chat-goal-main')).toContain('min-width: 0')
    expect(declarations('.chat-goal-meta')).toContain('flex: 0 1 auto')
    expect(declarations('.chat-goal-meta')).toContain('text-overflow: ellipsis')
    expect(declarations('.chat-goal-meta')).toContain('white-space: nowrap')
    expect(declarations('.chat-goal-tools')).toContain('flex: none')
    expect(declarations('.chat-goal-text')).toContain('text-overflow: ellipsis')
  })

  it('附件移除、取消与重试操作有 44px 实体命中区', () => {
    for (const selector of ['.chat-file-cancel', '.chat-file-retry']) {
      expect(declarations(selector), selector).toContain('min-height: var(--palm-hit)')
      expect(declarations(selector), selector).toContain('min-width: var(--palm-hit)')
    }
    for (const selector of ['.chat-attach-remove', '.chat-file-remove']) {
      expect(declarations(selector), selector).toContain('width: var(--palm-hit)')
      expect(declarations(selector), selector).toContain('height: var(--palm-hit)')
    }
  })
})

/**
 * P4 结论卡四态（2026-11-10）：卡面同一张骨架，只换状态色与文案。
 *
 * 两条都来自**组件预览截图**（把构建后的 app.css 套在真实标记上拍石墨深色）：
 * 1. 「看全部改动 ›」与「重试」原来是一块灰方块 —— `.palm-delivery-more` 只写了
 *    颜色，没有重置 UA 的按钮背景/边框；
 * 2. 新增的原因行 `<p>` 需要明确定级，否则吃基础段落字号，比卡头还抢眼。
 */
describe('P4 结论卡四态', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('四态各有一条状态修饰，颜色全部来自语义 token', () => {
    expect(body(".palm-delivery[data-state='failure']")).toContain('border-color: var(--palm-danger)')
    expect(body(".palm-delivery[data-state='failure'] .palm-delivery-check")).toContain('background: var(--palm-tint-danger)')
    expect(body(".palm-delivery[data-state='unknown'] .palm-delivery-title")).toContain('color: var(--palm-fg-2)')
    expect(body(".palm-delivery[data-state='running'] .palm-delivery-check")).toContain('background: var(--palm-tint-accent)')
  })

  it('卡内文字按钮重置 UA 背景与边框（否则手机上是一块灰方块）', () => {
    const more = body('.palm-delivery-more')
    expect(more).toContain('background: none')
    expect(more).toContain('border: none')
    expect(more).toContain('font: inherit')
    expect(more).toContain('color: var(--palm-accent)')
  })

  it('原因行是辅助层字号，不吃基础段落样式', () => {
    const reason = body('.palm-delivery-reason')
    expect(reason).toContain('font-size: var(--palm-flow-meta-size)')
    expect(reason).toContain('color: var(--palm-fg-2)')
  })

  it('浅色皮肤必须覆盖过程/结论卡的表面色（否则白底上是一块深色渐变）', () => {
    // 组件预览截图实测：paper 皮肤下卡片是深色渐变、分隔线看不见 —— 因为
    // `--palm-flow-*` 四个颜色只在基础令牌里定义了深色值，皮肤块没有覆盖。
    const paper = body("html[data-skin='paper']")
    for (const token of ['--palm-flow-card-bg', '--palm-flow-rule', '--palm-flow-card-line', '--palm-flow-tag-ok']) {
      expect(paper, `paper 皮肤缺 ${token}`).toContain(`${token}:`)
    }
  })
})

/**
 * 状态条的主次（2026-11-10 整屏实拍）：收工的主条是**满格渐变**，比回答本身还抢眼。
 * 主次应当是"运行中看过程，收工后看回答"：已完成的条退回表面色（没有进度可读），
 * 运行/失败/等审批仍然保留渐变。
 */
describe('状态条主次（收工退回表面色）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 2026-11-10 第三版：状态条整体改成**平铺一行**（用户口径：不要状态条、不要滑动条）。
  // 原来这三条钉的是「渐变填充 / 收工换表面色 / 运行中保留渐变」，现在填充与刻度轨
  // 一起下线，改钉"它们真的没了"与"平铺后靠留白分层"。
  it('填充与刻度轨的规则全部下线（不留死样式）', () => {
    expect(mobileCss).not.toContain('.palm-strip-fill')
    expect(mobileCss).not.toContain('.palm-strip-rail')
    expect(mobileCss).not.toContain('--palm-strip-grad-')
  })

  it('主条是平铺一行：无底色、无描边、不写死高度', () => {
    const strip = body('.palm-strip')
    expect(strip).toContain('background: none')
    expect(strip).toContain('border: 0')
    expect(strip).not.toContain('block-size: var(--palm-strip-h)')
    expect(mobileCss).not.toContain(".palm-strip[data-size='main'][data-kind='done']")
  })
})

/**
 * 回合头的主次（2026-11-10 整屏实拍）：目标行与正文同字号同是近白色，读起来像
 * "又一个标题"；元信息行 10px + 三级灰，是典型低对比辅助文字。目标行降为次级标签、
 * 元信息回到可读层级，回答才是这一屏的主语。
 */
describe('回合头主次（目标行降为次级标签）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('目标行有锚点、但不与回答抢层级（2026-11-10 重设计）', () => {
    // 2026-11-10 重设计改判：上一版把目标行降成「灰字次级」，整屏看不出这段属于哪一轮。
    // 现在用左侧竖条 + 正文色 + 加粗立起来，但字号不动（仍 --palm-flow-title-size），
    // 所以它不会变回「第二个标题」；高度契约不变。
    const goal = body('.palm-turn-goal')
    expect(goal).toContain('border-inline-start: 3px solid var(--palm-accent)')
    expect(goal).toContain('color: var(--palm-fg)')
    expect(goal).toContain('font-weight: var(--palm-w-bold)')
    expect(goal).toContain('font-size: var(--palm-flow-title-size)')
    expect(goal).toContain('min-block-size: var(--palm-turn-goal-h)')
  })

  it('元信息行不再 10px 三级灰，回到可读层级', () => {
    const meta = body('.palm-turn-meta')
    expect(meta).toContain('color: var(--palm-fg-2)')
    expect(meta).toContain('font-size: var(--palm-flow-meta-size)')
  })
})

/**
 * 外观页的皮肤卡（2026-11-10 截图）：色板原来是「底色 → 强调色」的对角渐变，
 * 石墨（中性灰）被画成一块蓝紫，三张卡看着都是"蓝色皮肤"，分不出谁是谁。
 * 现在色板以**真实底色为主**，强调色只做底边一条带；再补一道内描边，
 * 免得深色皮肤在深色页面上没有边界。
 */
describe('外观页皮肤卡（色板要能认出是哪套皮肤）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('三张卡的色板都以底色为主、强调色只留一条底带', () => {
    for (const skin of ['graphite', 'paper', 'nocturne']) {
      const value = rule(`.palm-spec-skin[data-skin='${skin}']`)
      expect(value, skin).toContain(`linear-gradient(180deg, transparent 0 82%`)
      expect(value, skin).toContain(`var(--palm-skin-${skin}-ink) 82%`)
      expect(value, skin).toContain(`var(--palm-skin-${skin}-bg)`)
    }
  })

  it('色板自带内描边，深色皮肤在深色页面上也有边界', () => {
    expect(rule('.palm-spec-skin-sw')).toContain('inset 0 0 0 var(--palm-hair) var(--palm-line)')
  })
})

/**
 * 抽屉的定位感（2026-11-10）：分组标题原来是 12px 三级灰、没有条数；当前会话只有
 * 一点点底色差，在带迷你状态条的行走里几乎看不出来。分组标题抬到二级色并带条数，
 * 当前会话加一条左侧强调轨。
 */
describe('抽屉定位感（分组条数 + 当前会话强调轨）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('分组标题用二级前景色，条数用三级色（不与会话标题抢）', () => {
    expect(rule('.palm-drawer-bucket')).toContain('color: var(--palm-fg-2)')
    expect(rule('.palm-drawer-bucket-count')).toContain('color: var(--palm-fg-3)')
  })

  it('当前会话行有一条左侧强调轨（底色差之外再给一个位置信号）', () => {
    expect(rule('.palm-drawer-row-current')).toContain('inset 2px 0 0 var(--palm-accent)')
  })
})

/**
 * 审批页的宽度约束（2026-11-10 审查）。**注意：这不是一个已复现的真 bug。**
 *
 * 审查时把审批页塞进一个 `display:flex` 的外壳里截图，长命令把卡片顶出屏幕、
 * 「原始参数」被挤出视口；换成真实页壳（块级 `#root` → `.palm-spec-page`）后
 * 同一份 markup 完全正常 —— 溢出是审查用的 flex 外壳造成的。
 *
 * 这两条留作**防御性约束**：flex 项的自动最小宽度是 min-content，将来若把审批页
 * 嵌进 flex 容器（例如抽屉里的内联审批），一条长命令就会重演同样的溢出。
 */
describe('审批页宽度约束（防御性：长命令不撑破容器）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('审批主体与详情列允许收缩（flex 项默认 min-width:auto 会被长命令撑开）', () => {
    for (const selector of ['.approval-page-body', '.approval-detail']) {
      expect(rule(selector), selector).toContain('min-inline-size: 0')
    }
  })

    // 2026-11-10 改判：原来要求"块内横滚"（切片 7 的取舍），实拍发现手机上批一条命令
    // 得横着拖才看得全，而聊天卡片里同一段命令是换行读的 —— 两个审批面两种读法。
    // 现在统一成"换行读 + 限高竖向滚"，宽度上限仍然保留（切换按钮永远看得见）。
    it('命令块有 100% 宽度上限、限高竖向滚，切换按钮永远看得见', () => {
      expect(rule('.approval-detail-code')).toContain('max-inline-size: 100%')
      const shared = rule('.approval-detail-code, .approval-detail-args')
      expect(shared).toContain('max-inline-size: 100%')
      expect(shared).toContain('max-block-size')
      expect(shared).toContain('overflow-y: auto')
      expect(shared).toContain('white-space: pre-wrap')
      expect(shared).not.toContain('overflow-x: auto')
    })

  it('横滚溢出时右缘渐隐：告诉用户命令后面还有（320px 实拍）', () => {
    // 切片 7 的取舍是「命令在块内横滚，按钮常驻」；代价是正文被容器圆角切一截。
    // 渐隐只在 data-fade=end 时出现，遮罩用 currentColor，不引入新颜色值。
    const fading = rule(".approval-detail-code[data-fade='end']")
    expect(fading).toContain('mask-image')
    expect(fading).toContain('currentColor')
    expect(fading).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
  it('页脚那句「批准之后会发生什么」是决策信息，用二级前景色', () => {
    expect(rule('.approval-page-hint')).toContain('color: var(--palm-fg-2)')
  })
})

/**
 * 空会话首屏（2026-11-10 实拍）：`.chat` 是 flex 列，正文空态没有 flex 权重，于是
 * composer 停在屏幕中间、下面一大片空；同一块里标题是居中的，图标块却被 flex 的
 * stretch 顶在左边。两条一起改成「内容占满 + 十字居中」。
 */
describe('空会话首屏（composer 贴底、空态整体居中）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('空态吃掉剩余高度，composer 被推到屏幕底部', () => {
    expect(rule('.chat > .empty-state')).toContain('flex: 1 1 auto')
  })

  it('空态十字居中：图标块不再被 stretch 顶到左边', () => {
    const rule_ = rule('.chat > .empty-state')
    expect(rule_).toContain('align-items: center')
    expect(rule_).toContain('justify-content: center')
  })

  it('空态可以被压缩：草稿写长时 composer 不许被顶出视口（320px 实拍）', () => {
    // flex 的默认最小高度是 auto（内容高度），空态不让位时 composer 整块掉到屏幕外，
    // 最后一行与发送键都露不全。min-block-size: 0 让它让位，必要时自己滚。
    const rule_ = rule('.chat > .empty-state')
    expect(rule_).toContain('min-block-size: 0')
    expect(rule_).toContain('overflow-y: auto')
  })
})

/**
 * 上下文页的百分比（2026-11-10 实拍）：数字和窗口总量分两行摆、占用条没有刻度，
 * 百分比只存在于 aria-label 里（只有读屏能拿到）。现在它写在数字旁，且不能比
 * 单位「已占用」更弱。
 */
describe('上下文页的百分比标签', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('百分比用二级前景色与正文偏小的字号（比单位「已占用」更醒目）', () => {
    const pct = rule('.context-page-figure-pct')
    expect(pct).toContain('color: var(--palm-fg-2)')
    expect(pct).toContain('font-size: var(--palm-t-m)')
    expect(pct).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})

/**
 * 分组标题（2026-11-10 设置页实拍）：外观 / 对话 / 其他 三组标题是 11px 三级灰，
 * 在深色皮肤上几乎读不出来 —— 而它们是这一页唯一的分区线索。抽屉的分组标题在
 * 切片 6 已经抬到二级色，这里对齐；右侧那句说明（显示效果 / 聊天与提醒）仍是
 * 辅助信息，保持三级色。
 */
describe('分组标题的可读性', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('分组标题用二级前景色（与抽屉分组一致）', () => {
    expect(rule('.palm-spec-group-head')).toContain('color: var(--palm-fg-2)')
  })

  it('右侧说明仍是三级色，不跟标题抢', () => {
    expect(rule('.palm-spec-group-note')).toContain('color: var(--palm-fg-3)')
  })
})

/**
 * 待发队列每一行的挤压（2026-11-10，320px 实拍）：一行里塞「编辑/删除/撤回/立即发送」
 * 四个按钮，文本格被压到只剩两个字宽，排队中的那句话变成「把…」—— 队列的意义就是
 * "让人知道排了什么"，这一压把意义压没了。动作行允许换行，文本格给一个最小宽度。
 */
describe('待发队列行在窄屏不挤压正文', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('一行只有「正文 + ×」：不再换行，也不再挤四个按钮', () => {
    // 2026-11-10 方案 A：动作收进动作表后，行内只剩正文和删除，
    // 正文可以一直占满宽度并单行省略（以前四个按钮会把它压成两个字）。
    const row = rule('.queue-dockRow')
    expect(row).not.toContain('flex-wrap: wrap')
    const text = rule('.queue-dockText')
    expect(text).toContain('flex: 1 1 auto')
    expect(text).toContain('text-overflow: ellipsis')
  })

  it('排到 3 条以上时列表封顶并内部滚动，别把正文挤没', () => {
    // 换行之后每条队列项变两行，列表再没有上限就会一路往上吃正文。
    const list = rule('.queue-dockList')
    expect(list).toContain('max-block-size: 32vh')
    expect(list).toContain('overflow-y: auto')
  })
})

describe('最近通知的类别徽章配色（2026-11-10）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('审批与提问用警示色，别跟普通条目一样落回灰底', () => {
    for (const kind of ['approval', 'question']) {
      const body = rule(`.settings-inboxKind-${kind}`)
      expect(body, kind).toContain('var(--tone-warning-soft)')
      expect(body, kind).toContain('var(--tone-warning-ink)')
    }
  })
})

describe('开关跟随皮肤（2026-11-10，paper/nocturne 实拍）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('「开」态用 --palm-accent，而不是固定的旧蓝', () => {
    // 旧名 --accent 在 design/tokens.ts 里两套主题都是 #5b5cf0，换肤时不变：
    // 纸色皮肤（棕）与夜航（青）下，开关仍是蓝的 —— 等于第二套配色。
    const on = rule('.settings-switch-on::before')
    expect(on).toContain('var(--palm-accent)')
    expect(on).not.toMatch(/var\(--accent\)/)
  })

  it('用量页的进度条与徽章也用皮肤强调色', () => {
    // 同一类漏：纸色用量页上，62% 的进度条与「pro / 余额」小徽章仍是靛蓝，
    // 而整页其余部分已经换成暖白 + 棕。2026-11-10 纸色 390px 实拍。
    const fill = rule('.usage-meterFill')
    expect(fill).toContain('var(--palm-accent)')
    expect(fill).toContain('var(--palm-accent-2)')
    expect(fill).not.toMatch(/var\(--accent\)/)

    const badge = rule('.usage-badge-ok')
    expect(badge).toContain('var(--palm-tint-accent)')
    expect(badge).toContain('var(--palm-accent)')
  })

  it('主按钮跟随皮肤（纸色下不再是一颗蓝按钮）', () => {
    // mobile-button-primary 是全站主操作（保存/刷新/确认），原来写死旧蓝。
    const primary = rule('.mobile-button-primary')
    expect(primary).toContain('var(--palm-accent)')
    expect(primary).toContain('var(--palm-on-accent)')
    expect(primary).not.toMatch(/var\(--accent\)/)
  })

  it('强调色上的字用 --palm-on-accent（白字压在亮靛/青上读不清）', () => {
    // --accent-contrast 在两套主题里恒为 #ffffff；三套皮肤的强调色分别是
    // 亮靛 #7c8cff、棕、青 #22d3ee —— 白字在上面只有 1.8~2.6:1。
    // 皮肤早就给了对应前景色（--101015 / #ffffff / #0a0a0f），主控件必须用它。
    for (const selector of ['.chat-send', '.mobile-new']) {
      const body = rule(selector)
      expect(body, selector).toContain('var(--palm-on-accent)')
      expect(body, selector).not.toMatch(/var\(--accent-contrast\)/)
    }
  })

  it('旧名 --accent* 在桥接段整批指回皮肤令牌（不再逐个改历史引用）', () => {
    // 根因治理：design/tokens.ts 的三个强调色旧名换肤不变。
    // 逐个改 100 余处既慢又会漏，桥接段一次性映射，皮肤才是唯一的颜色来源。
    expect(mobileCss, '缺少 --accent 桥接').toMatch(/--accent:\s*var\(--palm-accent\)/)
    expect(mobileCss, '缺少 --accent-soft 桥接').toMatch(/--accent-soft:\s*var\(--palm-tint-accent\)/)
    expect(mobileCss, '缺少 --accent-contrast 桥接').toMatch(/--accent-contrast:\s*var\(--palm-on-accent\)/)
  })

  it('提问卡：卡头是标签，问句才是标题（两行粗体抢重点）', () => {
    // 2026-11-10 390px + 1.7 倍实拍：卡头「交付卡怎么收尾」与问句「这两个方案你要哪个？」
    // 同字号同级，打开卡片分不清哪句是要你回答的。
    const header = rule('.chat-question-header')
    expect(header, '卡头应弱一档（二级前景 + 小字号）').toContain('var(--palm-fg-2)')
    expect(header).toContain('var(--palm-t-s)')

    const text = rule('.chat-question-text')
    expect(text, '问句应是正文里最亮的一档').toContain('var(--palm-fg)')
    expect(text).toContain('var(--palm-t-l)')
  })

  it('长问句不许被截断（4 行 + 5 个选项是真实形态）', () => {    // 2026-11-10 极限卡片实拍：四行问句 + 五个选项能把卡片顶到 640px 高，
    // 但它仍在聊天流里正常滚动 —— 不靠截断省地方。这条防止"为了清爽"加 clamp。
    for (const selector of ['.chat-question-text', '.chat-question-option-label']) {
      const body = rule(selector)
      expect(body, selector).not.toMatch(/line-clamp/)
      expect(body, selector).not.toMatch(/overflow:\s*hidden/)
      expect(body, selector).not.toMatch(/text-overflow/)
    }
  })
})
describe('过程折叠展开态：四行「完成」不像四个徽章', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('成功步骤的「完成」退成辅助色（异常态才用语义色）', () => {
    // 2026-11-10 展开态实拍：四行步骤尾巴各挂一枚绿色「完成」，像四枚徽章，
    // 反而把真正的异常（失败/中断）淹掉。绿色圆点已经说明"这一步过了"。
    const ok = rule('.chat-step-state-ok')
    expect(ok).toContain('var(--palm-fg-3)')
    for (const state of ['error', 'stopped', 'running']) {
      expect(rule(`.chat-step-state-${state}`), state).not.toContain('var(--palm-fg-3)')
    }
  })
})
describe('失败卡的原因行（2026-11-10 多行堆栈实拍）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const rule = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('宿主给的多行报错要保留换行（否则四条错误糊成一堵字墙）', () => {
    const reason = rule('.palm-delivery-reason')
    expect(reason).toContain('pre-line')
  })
})
describe('主按钮不许各写各的配色（2026-11-10 全量清点）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 现状确实有 6 套"大主键"：App 的重试、抽屉的新建会话、聊天发送、提问提交、
  // 审批允许、配对提交。合并成一套是后面的事；这一条只保证它们**不许**再各写一份裸色，
  // 必须走皮肤令牌（--accent 的桥接等价于 --palm-accent）。
  const primaries = [
    '.mobile-new',
    '.palm-drawer-new',
    '.chat-send',
    '.chat-question-submit',
    '.chat-approval-allow',
    '.mobile-pairSubmit',
  ]

  it.each(primaries)('%s 的底色与字色都来自皮肤令牌', (selector) => {
    const rule = body(selector)
    expect(rule, selector + ' 的底色').toMatch(/background:\s*var\(--(palm-)?accent\)/)
    expect(rule, selector + ' 的字色').toMatch(/color:\s*var\(--(palm-)?(on-accent|accent-contrast)\)/)
  })
})
describe('主按钮的按下/禁用态走同一组令牌（2026-11-10 清点后发现各写各的）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 六套主键原来分成两派：一套按下去 scale(0.98)+提亮，另一套只是降透明度到 0.88，
  // 抽屉那颗连按下态都没有。同一个动作三种反馈，用户会以为有的键"没反应"。
  const primaries = [
    '.mobile-new',
    '.palm-drawer-new',
    '.chat-send',
    '.chat-question-submit',
    '.chat-approval-allow',
    '.mobile-pairSubmit',
  ]

  it('../000-tokens.css 里有这组令牌', () => {
    expect(mobileCss).toMatch(/--palm-btn-press-scale:\s*0\.98/)
    expect(mobileCss).toMatch(/--palm-btn-press-dim:\s*1\.1/)
    expect(mobileCss).toMatch(/--palm-btn-disabled-opacity:\s*0\.6/)
  })

  // 「按一下就松手」的键：按下去缩一点 + 提亮。
  const instant = ['.mobile-new', '.palm-drawer-new', '.chat-send', '.mobile-pairSubmit']

  it.each(instant)('%s:active 用令牌，不写死数字', (selector) => {
    const rule = body(selector + ':active')
    expect(rule, selector).toContain('scale(var(--palm-btn-press-scale))')
    expect(rule, selector).toContain('brightness(var(--palm-btn-press-dim))')
    expect(rule).not.toMatch(/scale\(0\./)
    expect(rule).not.toMatch(/brightness\(1\./)
  })

  // 卡片里的两颗键（审批「按 1.5 秒」与提问提交）：只降透明度、**不许** scale。
  // 长按确认缩一圈再保持 1.5 秒是错的；审批键的进度靠 --holding 的 filter 表达，
  // :active 也不能改 filter 抢走它。
  it.each(['.chat-approval-allow', '.chat-question-submit'])('%s:active 只降透明度', (selector) => {
    const rule = body(selector + ':active')
    expect(rule, selector).toContain('opacity: var(--palm-btn-press-flat)')
    expect(rule, selector).not.toContain('transform:')
    expect(rule, selector).not.toContain('filter:')
  })
})
describe('减弱动效：六颗主键都要被照顾到（2026-11-10）', () => {
  const block = (() => {
    const start = mobileCss.indexOf('.page-enter-fwd,')
    const end = mobileCss.indexOf('}', mobileCss.indexOf('animation: none;', start))
    return mobileCss.slice(start, end)
  })()

  it.each(['.mobile-new', '.palm-drawer-new', '.chat-send', '.mobile-pairSubmit', '.chat-question-submit', '.chat-approval-allow'])(
    '%s 在 reduced-motion 列表里',
    (selector) => {
      // 六颗主键都带 transition: transform .1s；列表里漏一颗，开"减弱动效"的用户
      // 就还会看到那一颗在动 —— 三颗漏了（抽屉新建 / 配对 / 卡片两键）。
      expect(block, selector).toContain(selector)
    },
  )
})
describe('主键几何分三档，不是六个各写各的（2026-11-10 盘完几何）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 三档：页面级 CTA（44 + r-m + t-l）、卡片内 CTA（44 + r-s + t-m）、图标键（圆形）。
  // 抽屉那颗用自己的高（--palm-drawer-new-h，目前也是 44，但抽屉密度要单独可调）。
  it('页面级 CTA：--palm-hit 高、--palm-r-m 圆角、--palm-t-l 字号', () => {
    for (const sel of ['.mobile-new', '.mobile-pairSubmit']) {
      const rule = body(sel)
      expect(rule, sel).toMatch(/height: var\(--palm-hit\)|block-size: var\(--palm-hit\)/)
      expect(rule, sel).toContain('var(--palm-r-m)')
      expect(rule, sel).toContain('var(--palm-t-l)')
    }
  })

  it('卡片内 CTA：--palm-hit 高、--palm-r-s 圆角、--palm-t-m 字号', () => {
    for (const sel of ['.chat-question-submit', '.chat-approval-allow']) {
      const rule = body(sel)
      expect(rule, sel).toContain('var(--palm-hit)')
      expect(rule, sel).toContain('var(--palm-r-s)')
      expect(rule, sel).toContain('var(--palm-t-m)')
    }
  })

  it('发送键是圆形图标键，不跟着 CTA 走', () => {
    const rule = body('.chat-send')
    expect(rule).toContain('var(--palm-r-full)')
    expect(rule).toContain('var(--palm-dock-circle)')
  })
})
describe('减弱动效自动对账：写了位移过渡就必须登记（2026-11-10）', () => {
  const norm = (css: string): string => css.replace(/\s*>\s*/g, '>').replace(/\s+/g, ' ')

  const reducedBlock = (() => {
    const css = mobileCss
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/.exec(css)
    if (m === null) throw new Error('找不到 @media (prefers-reduced-motion: reduce)')
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < css.length && depth > 0) {
      const ch = css[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    return norm(css.slice(start, i))
  })()

  it('凡是 transition 里带动 transform 的选择器，都出现在减弱动效列表里', () => {
    // 上一片手工补了四颗主键，但全量对账后发现还有 13 个选择器漏着
    // （跳转键、diff 两键、拒绝键、选项、停止键、语音服务、设备键、对话框键、
    //  市场安装、代码块、语音波形）。人工清单靠不住，这里直接把样式表对一遍。
    // 先把注释剃掉：不剃的话选择器文本里会混进上一段注释，全部"匹配不上"。
    const clean = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1].trim(),
      body: m[2],
    }))
    const missing: string[] = []
    for (const rule of rules) {
      if (!/transition:[^;]*transform/.test(rule.body)) continue
      for (const part of rule.selector.split(',')) {
        const selector = norm(part.trim())
        if (selector === '' || reducedBlock.includes(selector)) continue
        if (!missing.includes(selector)) missing.push(selector)
      }
    }
    expect(missing, '这些选择器有位移过渡却没登记减弱动效：' + missing.join('、')).toEqual([])
  })
})
describe('减弱动效对账（二）：animation 驱动的动效也要有个说法', () => {
  const norm = (css: string): string => css.replace(/\s*>\s*/g, '>').replace(/\s+/g, ' ')
  const clean = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

  const reducedBlock = (() => {
    const css = clean(mobileCss)
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/.exec(css)
    if (m === null) throw new Error('找不到减弱动效块')
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < css.length && depth > 0) {
      const ch = css[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    return norm(css.slice(start, i))
  })()

  // 这些动画**表达的是状态**，不是装饰：转圈的 spinner、呼吸的"运行中"圆点、
  // 不确定进度条。开减弱动效把它们停掉，用户就分不清"还在跑"和"卡住了"。
  // 所以它们不进减弱动效列表，而是明写在白名单里，改一个都要回来看这里。
  const statefulMotion = [
    '.chat-status-dot-live',
    '.chat-task-dot-running',
    '.chat-subagent-dot-running',
    '.chat-goal-spinner',
    ".palm-strip-fill[data-fill='unknown']",
    ".palm-strip[data-kind='unknown'] .palm-strip-fill",
    // 2026-11-10 过程条：运行中状态点的呼吸属于状态表达（和 spinner 同类）。
    // 同一批的扫光 / 点阵脉冲 / 展开滑入是装饰，已登记进 360-reduced-motion。
    ".palm-proc-dot[data-state='running']",
  ]

  it('凡是 animation 的选择器，要么登记在减弱动效里，要么在白名单里说明理由', () => {
    const css = clean(mobileCss)
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1].trim(),
      body: m[2],
    }))
    const whitelist = new Set(statefulMotion.map(norm))
    const missing: string[] = []
    for (const rule of rules) {
      if (!/animation:\s*(?!none)/.test(rule.body)) continue
      for (const part of rule.selector.split(',')) {
        const selector = norm(part.trim())
        if (selector === '' || selector.startsWith('@') || selector.startsWith('to') || selector.startsWith('from')) continue
        if (whitelist.has(selector) || reducedBlock.includes(selector)) continue
        if (!missing.includes(selector)) missing.push(selector)
      }
    }
    expect(missing, '这些 animation 没登记也没进白名单：' + missing.join('、')).toEqual([])
  })
})
describe('减弱动效下"跳到了哪一条"不能完全没有标记（2026-11-10）', () => {
  const norm = (css: string): string => css.replace(/\s*>\s*/g, '>').replace(/\s+/g, ' ')

  const reducedBlock = (() => {
    const css = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/.exec(css)
    if (m === null) throw new Error('找不到减弱动效块')
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < css.length && depth > 0) {
      const ch = css[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    return norm(css.slice(start, i))
  })()

  // 这两处（聊天消息定位高亮 / 设置搜索跳转）原来的**全部**视觉就是一段脉冲动画。
  // 开减弱动效时动画被停掉，等于"跳过去了但什么都没标记"——这是功能缺口，不是动画取舍。
  it.each(['.chat-msg-focus', '[data-locate-id][data-focus]'])('%s 在减弱动效下有静态标记', (selector) => {
    // 规则可能和别的选择器合并成一条（".a, .b { … }"），所以按选择器表拆开找。
    const rules = [...reducedBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1].split(',').map((s) => s.trim()),
      body: m[2],
    }))
    // 同一个选择器在块里可能出现两次（一次 animation: none、一次给静态标记），
    // 所以要"存在一条带标记的"，而不是取第一条。
    const hits = rules.filter((r) => r.selectors.includes(selector))
    expect(hits.length, selector + ' 缺静态规则').toBeGreaterThan(0)
    const marked = hits.some((r) => /background:\s*var\(--palm-tint-accent\)|box-shadow:\s*inset/.test(r.body))
    expect(marked, selector + ' 要有静态可见标记').toBe(true)
  })
})
describe('设置页的定位标记要和行本身的描边区分开（2026-11-10）', () => {
  const norm = (css: string): string => css.replace(/\s*>\s*/g, '>').replace(/\s+/g, ' ')
  const reducedRules = (() => {
    const css = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/.exec(css)
    if (m === null) throw new Error('找不到减弱动效块')
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < css.length && depth > 0) {
      const ch = css[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    return [...norm(css.slice(start, i)).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((x) => ({
      selectors: x[1].split(',').map((s) => s.trim()),
      body: x[2],
    }))
  })()

  // 设置页每一行本来就有 1px 描边，再套一圈同样的描边等于没标记（实拍确认看不出）。
  // 聊天消息没有自己的边框，圆环在那边是有效的 —— 所以两边分开写，不共用一条规则。
  it('设置页用左侧竖条（只有横向偏移的内阴影），不是整圈描边', () => {
    // 同一选择器在块里出现两次（animation: none 与静态标记），要挑带 box-shadow 的那条。
    const hit = reducedRules.filter((r) => r.selectors.includes('[data-locate-id][data-focus]')).find((r) => r.body.includes('box-shadow'))
    expect(hit, '缺设置页定位规则').toBeDefined()
    expect(hit?.body, '左侧竖条').toMatch(/box-shadow:\s*inset\s+var\(--palm-focus\)\s+0\s+0/)
    expect(hit?.body, '不要再整圈描边').not.toMatch(/inset\s+0\s+0\s+0/)
  })

  it('聊天消息仍用整圈描边（它自己没有边框）', () => {
    const hit = reducedRules.filter((r) => r.selectors.includes('.chat-msg-focus')).find((r) => r.body.includes('box-shadow'))
    expect(hit, '缺聊天定位规则').toBeDefined()
    expect(hit?.body).toMatch(/box-shadow:\s*inset\s+0\s+0\s+0\s+var\(--palm-focus\)/)
  })
})
describe('语音面板的「请稍候」不能长得像能按（2026-11-10 真 DOM 实拍）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 转写中「完成」按钮 disabled 且文案变成「请稍候」，但它**没有 :disabled 规则**：
  // 实心强调色、完全可点的样子。用户会反复点，而它什么都不会做。
  it('「完成」禁用时要有禁用外观（不再像主键）', () => {
    const rule = body('.voice-done:disabled')
    expect(rule).toContain('opacity: var(--palm-btn-disabled-opacity)')
    expect(rule).toContain('cursor: default')
  })

  it('按下态走统一令牌', () => {
    const rule = body('.voice-done:active')
    expect(rule).toContain('scale(var(--palm-btn-press-scale))')
    expect(rule).toContain('brightness(var(--palm-btn-press-dim))')
  })
})
describe('语音倒计时最后 10 秒要真的"变脸"（2026-11-10 真 DOM 实拍）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 「还剩 8 秒」原来和「正在录音」同一个强调色，只多了一档字重 —— 实拍几乎看不出区别。
  // 警示态必须换成警示色，否则"最后 10 秒"这个提醒等于没有。
  it('警示态用 --palm-warn，且必须是复合选择器（否则被后面的 .voice-text 盖掉）', () => {
    // 第一次改写成单选择器 `.voice-text-warn`，因为 .voice-text 排在文件后面、
    // 同特异性，颜色被静默覆盖 —— 截图逐字节一模一样才发现没生效。
    const warn = body('.voice-text.voice-text-warn')
    expect(warn).toContain('var(--palm-warn)')
    expect(warn).not.toContain('var(--accent)')
    const normal = body('.voice-text')
    expect(normal).toContain('var(--accent)')
  })
})
describe('语音面板两颗键的几何走令牌（2026-11-10）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 这两颗键（录音的出口）原来写死 44px / 999px / 15px，且用的是旧名
  // --border-default / --bg-elevated / --text-secondary。高度必须等于触控下限，
  // 圆角必须等于胶囊令牌，否则换个皮肤或改一次触控下限就会对不上。
  it.each(['.voice-done', '.voice-cancel'])('%s：高 = --palm-hit，圆角 = 胶囊令牌', (selector) => {
    const rule = body(selector)
    expect(rule, selector).toContain('height: var(--palm-hit)')
    expect(rule, selector).toMatch(/border-radius: var\(--palm-r-full\)|border-radius: var\(--radius-capsule\)/)
    expect(rule, selector).not.toMatch(/height:\s*44px/)
    expect(rule, selector).not.toMatch(/border-radius:\s*999px/)
  })

  it('取消键的描边/底色/字色不再用旧名', () => {
    const rule = body('.voice-cancel')
    expect(rule).toContain('var(--palm-line)')
    expect(rule).toContain('var(--palm-sur-2)')
    expect(rule).toContain('var(--palm-fg-2)')
  })
})
describe('旧令牌名的棘轮：只许变少（2026-11-10 全量清点）', () => {
  // 三套皮肤 + 桥接段已经让"换皮肤"这件事成立了，但组件层仍有 370 处用旧名
  // （--text-primary / --border-default / --accent / --radius-card …）。
  // 逐个改是几百行的机械活，风险大于收益；这里改成**棘轮**：数字只能降不能升，
  // 以后每动一个文件顺手换掉几处，总量自然往下走，谁想新写旧名立刻红。
  // 2026-11-10：计数口径改成「引用即算」（var(--x) 与 var(--x, 兜底) 都算一次），
  // 因为这一轮把散落各处的兜底字面值删干净了，旧口径会把"删掉兜底"误判成"用量上涨"。
  // 下面两个按新口径重新标定；之后仍然只许降不许升。
  const caps: Record<string, number> = {
    accent: 68,
    'accent-soft': 19,
    'accent-contrast': 4,
    'accent-glow': 1,
    'text-primary': 55,
    'text-secondary': 56,
    'text-tertiary': 58,
    'bg-elevated': 27,
    'bg-surface': 7,
    'bg-page': 4,
    'border-default': 38,
    'border-focus': 11,
    'card-bg': 15,
    'radius-card': 7,
    'shadow-lg': 6,
  }

  /**
   * 数一个旧名被用了多少次。
   *
   * 2026-11-10：原来只数 `var(--x)` 这一种写法，于是把 `var(--x, #fff)` 的兜底字面值
   * 删掉之后计数反而"上涨"、撞上"只许降"的上限。真正该数的是「引用了这个名字」——
   * 带不带兜底都算一次。
   */
  const countOf = (name: string): number => {
    const pattern = new RegExp('var\\(--' + name.replace(/[-]/g, '\\-') + '[),]', 'g')
    return (mobileCss.match(pattern) ?? []).length
  }

  const total = Object.values(caps).reduce((sum, n) => sum + n, 0)

  it('总量不超过 370 处', () => {
    const actual = Object.keys(caps).reduce((sum, name) => sum + countOf(name), 0)
    expect(actual, '旧名总量只能降不能升').toBeLessThanOrEqual(total)
  })

  it.each(Object.entries(caps))('--%s 不超过当前用量', (name, cap) => {
    expect(countOf(name), '--' + name + ' 只能降不能升').toBeLessThanOrEqual(cap)
  })
})
describe('皮肤边界的现状：哪些旧名跟着皮肤走、哪些还只跟着明暗走（2026-11-10）', () => {
  // 查下来一件要紧的事：桥接段只接了「字号 / 间距 / 圆角 / 强调色」四族，
  // **颜色里只有强调色跟着皮肤走**；文字、页面底、表面、描边、卡片底、阴影这六族
  // 仍然是 designTokensCss() 按明暗主题注入的字面值，换皮肤不变。
  //
  // 现在看着没问题，是因为三套皮肤各自配了一个主题（纸色=浅、石墨/夜航=深）；
  // 一旦要加"自定义皮肤"（目标里明确要求可扩展），这六族就会留在旧主题上，
  // 皮肤只上一半。所以先用这条用例把边界钉住：谁想悄悄接过去，先改这条。
  const skinDriven = [
    'text-xs', 'text-sm', 'text-md', 'text-base', 'text-lg',
    'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-8',
    'radius-chip', 'radius-menu', 'radius-card', 'radius-sheet', 'radius-capsule', 'radius-full',
    'accent', 'accent-soft', 'accent-contrast', 'accent-glow',
    // 2026-11-10 切片 56：大面积底色接进皮肤，四族从"待接线"翻到"已接线"。
    'bg-page', 'bg-surface', 'bg-elevated', 'card-bg',
    // 2026-11-10 切片 57：文字 / 描边 / 阴影三族接进皮肤。
    'text-primary', 'text-secondary', 'text-tertiary', 'text-quaternary',
    'border-default', 'border-focus', 'card-border', 'card-shadow',
  ]

  // 2026-11-10 切片 57 之后这个清单已经空了：六族颜色全部接进皮肤。
  // 保留这个数组，是为了下一个"还锁在主题上"的家族（比如图表色、骨架屏）有地方落。
  const themeOnly: string[] = []

  it.each(skinDriven)('--%s 已接到皮肤令牌', (name) => {
    // --accent-glow 是用 color-mix 包着 --palm-accent 算出来的，允许这种写法。
    const head = '--' + name.replace(/-/g, '\\-') + ':'
    const pattern = new RegExp(head + '\\s*(var\\(--palm-|color-mix\\([^;]*var\\(--palm-)')
    expect(mobileCss, '--' + name + ' 应指回 --palm-*').toMatch(pattern)
  })

  it.each(themeOnly)('--%s 仍只跟明暗主题（待接线）', (name) => {
    const pattern = new RegExp('--' + name.replace(/-/g, '\\-') + ':\\s*var\\(--palm-')
    expect(mobileCss, '--' + name + ' 目前不该接皮肤令牌；接的时候请连同截图一起改这条').not.toMatch(pattern)
  })

  it('两族的边界写在这里，改动必须是有意的', () => {
    expect(skinDriven.length + themeOnly.length).toBe(34)
  })
})
describe('配对输入框在提交中要看得出来"改不了"（2026-11-10）', () => {
  const compact = (css: string): string => css.replace(/\s+/g, ' ')
  // 提交中把输入框设为只读，但只读在浏览器里**没有外观变化**：用户敲字没反应，
  // 会以为输入框坏了。给一条只读态样式（用禁用的同一档透明度）。
  it('只读态有可辨识的视觉降级', () => {
    const css = compact(mobileCss)
    const rule = /\.mobile-pairInput:read-only\s*\{([^}]*)\}/.exec(css) ?? /\.mobile-pairInput\[readonly\]\s*\{([^}]*)\}/.exec(css)
    expect(rule, '缺少只读态规则').not.toBeNull()
    expect(rule?.[1], '只读态要有透明度降级').toContain('var(--palm-btn-disabled-opacity)')
  })
})
describe('待发队列条：主操作不该绕开皮肤令牌（2026-11-10 双皮肤实拍）', () => {
  // 注释必须先剥掉：这条规则的新注释里就写着被替换掉的旧色值，
  // 不剥会把自己写的说明当成"仍在用裸色"。
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 「立即发送」原来写 var(--accent, #4f7cff) + color: #fff —— 兜底字面色和裸白，
  // 正好绕开 skin-contrast 量过的那组数字（--palm-on-accent 才是为对比度准备的）。
  it('「立即发送」用皮肤令牌，没有裸色与兜底字面值', () => {
    const rule = body('.queue-dockBtn-primary')
    expect(rule).toContain('var(--palm-accent)')
    expect(rule).toContain('var(--palm-on-accent)')
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(rule).not.toMatch(/var\(--accent\s*,/)
  })

  it('队列按钮的描边/字色/圆角/禁用透明度都走令牌', () => {
    const rule = body('.queue-dockBtn')
    expect(rule).toContain('var(--palm-line)')
    expect(rule).toContain('var(--palm-fg-3)')
    // 2026-11-10：主按钮从方角改成胶囊（视觉更轻），依旧只吃令牌。
    expect(rule).toContain('var(--palm-r-full)')
    expect(rule).not.toMatch(/border:\s*1px/)
    expect(rule).not.toMatch(/border-radius:\s*\d/)
    expect(body('.queue-dockBtn:disabled')).toContain('var(--palm-btn-disabled-opacity)')
  })
})
describe('离线横幅要看得出来是一条带子（2026-11-10 三方案对照）', () => {
  const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const compact = (css: string): string => strip(css).replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // --palm-tint-warn 是 10~12% 的一层薄雾：截图里几乎看不出"带子到哪儿为止"，
  // 用户只看到一行黄字飘在顶上。对照了三个方案（原样 12% / 加深到 24% / 16%+左侧竖条），
  // 选"加深到 24%"：断线是全屏状态，本来就该有一条整宽的状态带，而不是角落标记。
  it('用 --palm-warn-band（普通 rgba），不再靠 color-mix 现算', () => {
    const rule = body('.chat-offline-banner')
    expect(rule).toContain('var(--palm-warn-band)')
    expect(rule).not.toContain('color-mix')
  })

  it('重连成功后仍然退成无底灰字（不抢眼）', () => {
    const rule = body(".chat-offline-banner[data-state='back']")
    expect(rule).toContain('background: transparent')
  })
})
describe('断线提示只有一档浓度（2026-11-10）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  // 曾经有两档：聊天页顶部是 24% 的 @supports 带子，全站离线条是 10~12% 的薄雾——
  // 同一个语义、两种浓淡，用户会以为是两件不同的事。现在都走 --palm-warn-band。
  it('聊天页横幅与全站离线条用同一个令牌', () => {
    const css = compact(mobileCss)
    const bannerStart = css.indexOf('.chat-offline-banner {')
    const banner = css.slice(css.indexOf('{', bannerStart), css.indexOf('}', bannerStart))
    const barStart = css.indexOf('.mobile-offline-bar {')
    const bar = css.slice(css.indexOf('{', barStart), css.indexOf('}', barStart))
    expect(banner).toContain('var(--palm-warn-band)')
    expect(bar).toContain('var(--palm-warn-band)')
    expect(banner + bar).not.toContain('color-mix')
  })
})
describe('没有兜底的 color-mix 背景：清单只许变短（2026-11-10）', () => {
  // iOS 15.x / 16.0 不认识 color-mix，那条声明会被整条丢弃：这些块**只有**
  // color-mix 这一条 background，于是元素直接变透明（chip/徽章/激活态失去淡底）。
  // 逐个加 @supports 太重，先冻结清单：新增会红，改动这条清单必须是**有意的**。
  // 2026-11-10 清空：7 处全部改成预混令牌（--palm-press-bg / --palm-danger-band /
  // --palm-ok-band / --palm-accent-16 / --palm-search-mark），不再依赖 color-mix。
  const KNOWN: string[] = [
  ]

  const unguarded = (): string[] => {
    const css = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const guarded: Array<[number, number]> = []
    for (const m of css.matchAll(/@supports[^{]*\{/g)) {
      const start = (m.index ?? 0) + m[0].length
      let depth = 1
      let i = start
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') depth--
        i++
      }
      guarded.push([start, i])
    }
    const found: string[] = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? '').replace(/\s+/g, ' ').trim()
      const body = m[2] ?? ''
      if (selector.startsWith('@')) continue
      // 2026-11-14：皮肤装饰层（`html[data-skin=…]`）的玻璃面板允许 color-mix —
      // 它们是覆盖在组件底色之上的增强，不支持时退回组件底色而不是变透明。
      // 组件样式里「只有一条 color-mix 背景」那种仍然是零容忍。
      if (selector.startsWith('html[data-skin=')) continue
      if (!/background[a-z-]*:\s*color-mix/.test(body)) continue
      const at = m.index ?? 0
      if (guarded.some(([from, to]) => at >= from && at < to)) continue
      found.push(selector)
    }
    return [...new Set(found)].sort()
  }

  it('清单与冻结值一致（修掉一个就把它从清单里删掉）', () => {
    expect(unguarded()).toEqual([...KNOWN].sort())
  })
})

describe('四处最影响可读性的 color-mix 底色改成皮肤淡染令牌（2026-11-10）', () => {
  // 这四个块原来只有一条 color-mix background：iOS 15 上会直接变透明
  // （设置页标签、超限提示、离线横条全失去淡底）。皮肤里本来就有普通 rgba 的
  // --palm-tint-ok / --palm-tint-warn / --palm-tint-accent，直接用即可。
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it.each([
    [".palm-spec-tag[data-kind='ok']", 'var(--palm-tint-ok)'],
    [".palm-spec-tag[data-kind='edit']", 'var(--palm-tint-accent)'],
    ['.chat-msg-maxtokens', 'var(--palm-tint-warn)'],
    ['.mobile-offline-bar', 'var(--palm-warn-band)'],
  ])('%s 用普通淡染令牌，不靠 color-mix', (selector, token) => {
    const rule = body(selector)
    expect(rule).toContain(token)
    expect(rule).not.toContain('color-mix')
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})

describe('断线横幅的字色回到正文色（2026-11-10 对比度实测）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  // 带子加深到 24% 后，"琥珀字 + 琥珀带"在纸色皮肤下只有 4.04:1（低于 AA）。
  // 带子本身已经足够说明"这是警告"，文字改回正文色（三套皮肤都 ≥ 10:1）。
  it('文字用 --palm-fg，不用 --palm-warn', () => {
    const css = compact(mobileCss)
    const start = css.indexOf('.chat-offline-banner {')
    const rule = css.slice(css.indexOf('{', start), css.indexOf('}', start))
    expect(rule).toContain('color: var(--palm-fg)')
    expect(rule).not.toMatch(/color:\s*var\(--palm-warn\)\s*;?\s*/)
  })
})
describe('待发送图片的「×」：看得见才知道点到哪儿删（2026-11-10 整屏复核）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 原来的 44px 热区贴在缩略图右上角，可「×」本身只有 18px 且挤在最角上：
  // 用户看不出删除区从哪开始，容易点删。改成把「×」居中放进热区（热区仍是 44px），
  // 同时把三处裸色（rgba/#fff）换成皮肤令牌。
  it('热区仍 44px，且「×」在热区里居中', () => {
    const hit = body('.chat-attach-remove')
    expect(hit).toContain('var(--palm-hit)')
    expect(hit).toContain('align-items: center')
    expect(hit).toContain('justify-content: center')
  })

  it('「×」的底色与字色走皮肤令牌，没有裸色', () => {
    const dot = body('.chat-attach-remove::before')
    expect(dot).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(dot).not.toMatch(/rgba?\(/)
    // 角标底是**照片**，不是皮肤表面：必须用固定的压暗层，而不是会随皮肤变色的表面色。
    expect(dot).toContain('var(--palm-scrim)')
    expect(dot).toContain('var(--palm-on-scrim)')
    expect(compact(mobileCss)).toMatch(/--palm-scrim:\s*rgba\(0,\s*0,\s*0,\s*0?\.\d+\)/)
  })
})
describe('两处"看得见但没用"的样式（2026-11-10 夜航全屏扫）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // ① 输入区写了 backdrop-filter: blur(20px)，可底色是**不透明**的 --palm-bg ——
  //    模糊的是它自己，什么也看不见，只剩 GPU 开销。
  it('输入区不再挂着无用的 backdrop-filter', () => {
    expect(body('.chat-composer')).not.toContain('backdrop-filter')
    // 2026-11-14：玻璃皮肤（夏沫琉璃 / 壁纸专属）的 blur 是设计本身，
    // 不是"底色不透明还硬模糊"那种白烧 GPU —— 它们只挂在皮肤作用域上，
    // 组件样式里仍然一处都不许有。
    const css = compact(mobileCss)
    const offenders: string[] = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? '').trim()
      if (selector.startsWith('@') || selector.startsWith('html[data-skin=')) continue
      if (!(m[2] ?? '').includes('backdrop-filter')) continue
      offenders.push(selector)
    }
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  // ② 灯箱遮罩写死 rgba(0,0,0,.86)：与角标的 --palm-scrim（55%）是同一族，
  //    该有第二档令牌，而不是在组件里写裸色。
  it('灯箱遮罩用强压暗令牌，不写裸 rgba', () => {
    const rule = body('.lightbox-backdrop')
    expect(rule).toContain('var(--palm-scrim-strong)')
    expect(rule).not.toMatch(/rgba?\(/)
    expect(compact(mobileCss)).toMatch(/--palm-scrim-strong:\s*rgba\(0,\s*0,\s*0,\s*0?\.\d+\)/)
  })
})
describe('审批卡里的命令必须能读完（2026-11-10 双皮肤实拍）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 实拍：一条长命令被 -webkit-line-clamp: 2 硬切在「…&& p」处，卡上又没有展开入口 ——
  // 用户是在批准一条自己读不完的命令。改成"限高 + 内部可滚"，读得完、也不顶宽。
  it('限高可滚动，而不是硬切两行', () => {
    const rule = body('.chat-approval-preview')
    expect(rule).not.toContain('-webkit-line-clamp')
    expect(rule).toContain('max-block-size')
    expect(rule).toMatch(/overflow(-y)?:\s*auto/)
  })
})
describe('审批页的命令块：与卡片里同一种读法（2026-11-10）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // 原来这里写 white-space: pre + 横向滚动：手机上批命令得**横着拖**才能看全，
  // 而聊天卡片里同一段命令是换行读的 —— 两个审批面用两种读法，没道理。
  it('命令块换行读、限高竖向滚动，不再要求横向拖动', () => {
    const rule = body('.approval-detail-code, .approval-detail-args')
    expect(rule).toContain('white-space: pre-wrap')
    expect(rule).not.toContain('white-space: pre;')
    expect(rule).toMatch(/overflow-y:\s*auto/)
    expect(rule).toContain('max-block-size')
  })
})

describe('搜索命中的高亮不能依赖 color-mix（2026-11-10 iOS 15 兜底）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const body = (selector: string): string => {
    const css = compact(mobileCss)
    const start = css.indexOf(selector + ' {')
    if (start < 0) throw new Error('样式表里找不到规则 ' + selector)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  // color-mix() 要 Safari 16.2；iOS 15 上这条声明整条失效 → 命中词**没有底色**，
  // 搜索定位就瞎了。改成令牌：值在 000-tokens.css 里按皮肤算好，不依赖运行时混色。
  it('命中高亮用 --palm-search-mark 令牌，不写 color-mix', () => {
    expect(body('.mobile .chat-search-mark')).not.toContain('color-mix(')
    expect(body('.mobile .chat-search-mark')).toContain('var(--palm-search-mark)')
  })

  it.each(['graphite', 'paper', 'nocturne'])('%s 皮肤有 --palm-search-mark', (skin) => {
    const compact2 = compact(mobileCss)
    const start = compact2.indexOf(`html[data-skin='${skin}'] {`)
    expect(start, skin).toBeGreaterThan(-1)
    const open = compact2.indexOf('{', start)
    const block = compact2.slice(open + 1, compact2.indexOf('}', open))
    expect(block).toMatch(/--palm-search-mark:\s*#[0-9a-f]{6}/)
  })
})

describe('color-mix 债务清零（2026-11-10 收尾）', () => {
  // 从 21 处 → 0 处。iOS 15 / Safari 16.0 不认识 color-mix，任何一处都会让对应属性
  // 整条失效（背景变透明、描边消失、光晕没有）。全部改成构建期预混的令牌。
  // 这条用例只许**更严格**：以后再写一处，就会红。
  it('样式表里不再出现 color-mix 声明（皮肤装饰层除外，注释里提到不算）', () => {
    // 2026-11-14 收窄口径：这条禁令本是冲着**组件样式**来的（组件块只有一条
    // color-mix 背景，iOS 15 上会整条丢弃 → 元素变透明）。后来加进来的玻璃皮肤
    // （夏沫琉璃 / 壁纸专属 / 芙宁娜）是另一回事：它们的整个设计语言就是
    // 「半透面板 + 底色混算」，而且这些规则是**覆盖**在组件已有的底色之上，
    // 不支持 color-mix 的浏览器退回组件底色，不会变成透明。
    // 所以豁免只给 `html[data-skin=…]` 开头的皮肤作用域，组件样式照旧零容忍。
    const css = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const offenders: string[] = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? '').replace(/\s+/g, ' ').trim()
      if (selector.startsWith('@')) continue
      if (selector.startsWith('html[data-skin=')) continue
      if (!(m[2] ?? '').includes('color-mix(')) continue
      offenders.push(selector)
    }
    expect([...new Set(offenders)].sort()).toEqual([])
  })
})
describe('组合件样式只许用令牌（2026-11-10 原语层）', () => {
  const compact = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const blocks = (selector: string): string[] => {
    const css = compact(mobileCss)
    const out: string[] = []
    let from = 0
    for (;;) {
      const at = css.indexOf(selector, from)
      if (at < 0) break
      const open = css.indexOf('{', at)
      const close = css.indexOf('}', open)
      if (open < 0 || close < 0) break
      out.push(css.slice(open + 1, close))
      from = close + 1
    }
    return out
  }

  const SELECTORS = [
    '.palm-section-head',
    '.palm-section-title',
    '.palm-section-hint',
    '.palm-section-action',
    '[data-section-card]',
    '[data-result-row]',
    '.palm-result-name',
    '.palm-result-add',
    '.palm-result-del',
    '.palm-result-action',
    '.palm-action-bar',
    '.palm-action-primary',
    '.palm-action-secondary',
  ]

  it.each(SELECTORS)('%s 不写裸色、不写字面量圆角', (selector) => {
    for (const block of blocks(selector)) {
      expect(block, selector).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(block, selector).not.toMatch(/rgba?\(/)
      // 圆角/边框宽度都要走令牌（--palm-r-* / --palm-hair）。
      expect(block, selector).not.toMatch(/border-radius:\s*\d/)
      // order: 0 / order: none 是「不要边框」，不在此列。
      expect(block, selector).not.toMatch(/border:\s*(?!0\b|none)\d/)
    }
  })

  it('主操作是实心强调色，字用 --palm-on-accent（深浅皮肤都要读得出来）', () => {
    // 选择器先出现在「主/次共用」的规则里，所以要看全部块、而不是第一块。
    const rules = blocks('.palm-action-primary')
    expect(rules.some(rule => rule.includes('background: var(--palm-accent)'))).toBe(true)
    expect(rules.some(rule => rule.includes('color: var(--palm-on-accent)'))).toBe(true)
  })
})

