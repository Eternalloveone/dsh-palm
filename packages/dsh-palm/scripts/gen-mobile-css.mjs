#!/usr/bin/env node
/**
 * 由 `src/mobile/styles/*.css` 生成 `src/mobile/mobile-styles.ts`（W1-3）。
 *
 * 为什么要生成：手机端样式是**一段字符串**（构建期交给 lightningcss 编译），
 * 但 9 千多行放在一个文件里没法维护。现在真源是 `styles/` 下按区块拆开的 CSS，
 * 本脚本负责按文件名顺序拼回去。
 *
 * 规则：
 * - **别直接改 mobile-styles.ts**，改 `styles/*.css` 再跑 `pnpm gen:css`；
 *   mobile-styles.freshness.test.ts 会拦「手改了没重新生成」。
 * - 文件顺序 = 文件名字典序，所以前缀数字是排版顺序（010 → 900）。
 * - 拼接是纯文本，不插入分隔符：编译产物与拆分前逐字节相同（W1-3 的验收口径）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STYLES_DIR = fileURLToPath(new URL('../src/mobile/styles/', import.meta.url))
const OUT = fileURLToPath(new URL('../src/mobile/mobile-styles.ts', import.meta.url))

const files = readdirSync(STYLES_DIR).filter(name => name.endsWith('.css')).sort()
if (files.length === 0) throw new Error('gen-mobile-css: src/mobile/styles/ 下没有 .css 文件')

// 统一 LF：Windows 编辑器/工具可能把源文件写成 CRLF，而打包器读模板串时会把
// CRLF 归一成 LF —— 两边不一致，freshness 测试就会假红。
const body = files
  .map(name => readFileSync(join(STYLES_DIR, name), 'utf8'))
  .join('')
  .replace(/\r\n/g, '\n')

const header = [
  '/**',
  ' * 手机端样式表（**自动生成，勿手改**）。',
  ' *',
  ' * 真源：`src/mobile/styles/*.css`（按文件名排序拼接）。',
  ' * 重新生成：`pnpm gen:css`；`pnpm build` 也会先跑一遍。',
  ' * 手改本文件会被 `mobile-styles.freshness.test.ts` 拦下。',
  ' *',
  ' * 构建期由 scripts/build-css.mjs 编译成 lib/mobile/app.css，页面用 <link> 引入。',
  ' * token（调色板 + 层级/字体/圆角/间距/字阶）在 design/tokens.ts。',
  ' */',
  '',
  "import { designTokensCss } from './design/tokens.ts'",
  '',
].join('\n')

// designTokensCss() 自己以换行结尾，这里只补一个空行，让生成的模板串里
// token 段与第一个区块横幅之间正好隔一行。
const output = header + 'export const mobileCss = `${designTokensCss()}' + '\n' + body + '`;\n'
writeFileSync(OUT, output)
console.log(
  '[gen-mobile-css] ' + files.length + ' 个样式文件 → mobile-styles.ts（'
  + (output.length / 1024).toFixed(1) + ' kB）',
)
