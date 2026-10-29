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
      ['--voice-level', 'views/ChatView.tsx'],
    ])
    const defined = new Set<string>()
    for (const match of mobileCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(match[1] as string)
    const used = new Set<string>()
    for (const match of mobileCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(match[1] as string)
    const missing = [...used].filter(name => !defined.has(name) && !runtimeInjected.has(name)).sort()
    expect(missing).toEqual([])
    for (const [name, file] of runtimeInjected) {
      const writer = readFileSync(join(import.meta.dirname, file), 'utf8')
      expect(writer).toContain(`setProperty('${name}'`)
    }
  })

  it('tone 令牌三套主题都定义（只写浅色会让系统深色模式掉色）', () => {
    // 样式表里主题有三处：:root（浅色）、:root[data-theme='dark']、@media (prefers-color-scheme: dark)。
    // 只在浅色里定义 —— 或者只补一处的 —— 到系统深色模式下就是透明/掉色，截图里看不出，
    // 因为只有那条分支的机器才复现（2026-10-22 的写死浅色小标签就是这么来的）。
    const counts = new Map<string, number>()
    for (const match of mobileCss.matchAll(/(--tone-[a-z0-9-]+)\s*:/g)) {
      counts.set(match[1] as string, (counts.get(match[1] as string) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThan(0)
    const incomplete = [...counts].filter(([, count]) => count < 3).map(([name, count]) => `${name} 只定义了 ${count} 处`)
    expect(incomplete).toEqual([])
  })
})
