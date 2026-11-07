/**
 * 设备适配不变式（真机清单第 1/2/4/7 项的「代码侧一半」）。
 *
 * 这四项（键盘 × sheet / 键盘 × 正文 / iOS 可视区 / 安全区）**只能真机验**，但它们的
 * 前提条件在代码里是可以锁死的：少了下面任何一条，真机上必然出问题，而桌面浏览器
 * 完全看不出来（没有软键盘、没有刘海）。所以这里把前提做成结构测试，回归时先红。
 *
 * 判据写法遵循铁律：**先剥注释再判**，否则注释里提到的字样会造成假通过。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = import.meta.dirname

/** 去掉块注释与行注释（保留字符串里的内容不动，这里只判关键字，够用）。 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  let quote: string | undefined
  while (i < source.length) {
    const char = source[i]!
    const next = source[i + 1]
    if (quote !== undefined) {
      out += char
      if (char === '\\') { out += next ?? ''; i += 2; continue }
      if (char === quote) quote = undefined
      i += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; i += 1; continue }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    out += char
    i += 1
  }
  return out
}

const styles = stripComments(readFileSync(join(HERE, 'mobile-styles.ts'), 'utf8'))
const chatView = stripComments(readFileSync(join(HERE, 'views', 'ChatView.tsx'), 'utf8'))
// W2-5：键盘订阅从 ChatView 挪到内核 hook，两处合起来才算数。
const keyboardHook = stripComments(readFileSync(join(HERE, 'ui', 'hooks', 'use-keyboard-inset.ts'), 'utf8'))
const viewportSources = chatView + '\n' + keyboardHook
const routes = stripComments(readFileSync(join(HERE, '..', 'mobile-routes.ts'), 'utf8'))

describe('设备适配不变式（真机 1/2/4/7 的代码前提）', () => {
  it('viewport meta 带 viewport-fit=cover 与 interactive-widget=resizes-content', () => {
    // 没有 viewport-fit=cover，env(safe-area-inset-*) 全是 0，安全区样式等于没写；
    // 没有 interactive-widget=resizes-content，软键盘弹出时布局视口不动，输入框会被键盘盖住。
    expect(routes).toContain('viewport-fit=cover')
    expect(routes).toContain('interactive-widget=resizes-content')
  })

  it('样式里同时用到顶部与底部安全区', () => {
    expect(styles).toContain('env(safe-area-inset-top')
    expect(styles).toContain('env(safe-area-inset-bottom')
  })

  it('ChatView 监听 visualViewport 的 resize，并且成对清理', () => {
    // 软键盘弹出只改 visual viewport，不改 layout viewport；不监听它就没法在键盘
    // 顶起时把输入框和最新一行留在可见区。漏掉 removeEventListener 会在切换会话后
    // 累积多个监听，表现为"发一条消息滚好几次"。
    // W2-5 起订阅在 ui/hooks/use-keyboard-inset.ts，ChatView 只是调用方。
    expect(viewportSources).toContain('window.visualViewport')
    expect(viewportSources).toContain("addEventListener('resize'")
    expect(viewportSources).toContain("removeEventListener('resize'")
  })

  it('输入区在键盘顶起时会让出空间（composer 有底部安全区或视口补偿）', () => {
    // 两种实现都算数：样式上给底部安全区，或 JS 侧按 visualViewport 高度做补偿。
    // 只要求"至少有一条路"，不绑死实现（绑死会在换实现时误报）。
    const stylesPadsComposer = /bottom-sheet|composer/i.test(styles) && styles.includes('env(safe-area-inset-bottom')
    const scriptPadsComposer = chatView.includes('window.visualViewport')
    expect(stylesPadsComposer || scriptPadsComposer).toBe(true)
  })
})
