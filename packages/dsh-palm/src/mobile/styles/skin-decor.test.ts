/**
 * 皮肤装饰层的守卫（2026-11-11，用户选「装饰层」时加）。
 *
 * 装饰层 = 颜色令牌表达不了的那部分（衬线标题、报头线、玻璃、像素边框）。
 * 它比配色更容易出三种错，三种都不会让构建失败、只会让界面悄悄变差：
 *
 *   1. **裸色**：装饰里写了 `#fff` 或 `rgba(0,0,0,.1)` —— 换皮肤时会跟周围打架，
 *      而且换明暗档时不会跟着反色。
 *   2. **死选择器**：写了 `.palm-spec-head-title` 这种**根本不存在的类**，规则永远不生效，
 *      人眼又看不出来（报纸皮肤第一版就这么白写了三条）。
 *   3. **漏了皮肤前缀**：`blockquote { … }` 没写 `html[data-skin='x']`，于是这条装饰会
 *      污染**所有**皮肤（报纸的衬线会跑到石墨上）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STYLES_DIR = fileURLToPath(new URL('.', import.meta.url))
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url))

/** 装饰层文件：`6XX-skin-<皮肤标识>.css`（600 段专用于装饰；配色在 000-tokens.css，不在此列）。 */
const decorFiles = readdirSync(STYLES_DIR)
  .filter(name => /^6\d{2}-skin-[a-z0-9-]+\.css$/.test(name))
  .sort()

/** 去掉注释（避免注释里提到的类名/色值被当成真的规则）。 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 把一份 CSS 拆成 `选择器 { 声明 }` 的列表（装饰层都是平铺规则，没有 @media）。 */
function rulesOf(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selector: match[1].trim(),
    body: match[2].trim(),
  }))
}

/** 项目里所有 tsx 源码的 className 片段集合（判断类名到底存不存在）。 */
const tsxSources = readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.tsx'))
  .map(entry => readFileSync(join(entry.parentPath ?? SRC_DIR, entry.name), 'utf8'))
  .join('\n')

const classExists = (name: string) => tsxSources.includes(name)

/** 装饰层允许出现的「结构性」伪类/标签，其余一律要求是存在的类。 */
const KNOWN_TAGS = new Set(['html', 'body', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'hr', 'a', 'img', 'ul', 'ol', 'li', 'p', 'span'])

describe('皮肤装饰层', () => {
  // 「不许写裸色」这条不在本文件：`design/no-raw-colors.test.ts` 扫的是 styles/ 全目录
  // （只放行 000-tokens.css），装饰层 6NN-*.css 已经在它的网里。这里只测它管不到的两件事。

  it.each(decorFiles)('%s 的每条规则都限定在自己的皮肤上', (name) => {
    const id = /^6\d{2}-skin-([a-z0-9-]+)\.css$/.exec(name)?.[1] ?? ''
    const css = stripComments(readFileSync(join(STYLES_DIR, name), 'utf8'))
    const rules = rulesOf(css)
    expect(rules.length, `${name} 里没有解析到规则`).toBeGreaterThan(0)

    const unscoped = rules
      .map(rule => rule.selector)
      .filter(selector => !selector.split(',').every(part => part.includes(`html[data-skin='${id}']`)))
    expect(unscoped, `${name} 里没限定到 data-skin=${id} 的选择器：${unscoped.join(' / ')}`).toEqual([])
  })

  it.each(decorFiles)('%s 的类选择器都真实存在（没有白写的规则）', (name) => {
    const css = stripComments(readFileSync(join(STYLES_DIR, name), 'utf8'))
    const missing: string[] = []
    for (const rule of rulesOf(css)) {
      // 只看最后一个复合选择器里的类和标签：`html[data-skin='x'] .foo .bar` → `.foo .bar`
      const tail = rule.selector.split(/\s+/).filter(part => part.startsWith('.') || /^[a-z]/.test(part))
      for (const part of tail) {
        const classes = [...part.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1])
        for (const className of classes) if (!classExists(className)) missing.push(`.${className}`)
        const tag = /^([a-z]+)/.exec(part)?.[1]
        if (tag !== undefined && classes.length === 0 && !KNOWN_TAGS.has(tag)) missing.push(tag)
      }
    }
    expect([...new Set(missing)], `${name} 里这些类/标签在源码里找不到：${[...new Set(missing)].join(', ')}`).toEqual([])
  })
})
