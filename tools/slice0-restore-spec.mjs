import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

/* ── 1) 令牌回落定版值 ─────────────────────────────────────────────── */
const tokensPath = join(PKG, 'src', 'mobile', 'styles', '000-tokens.css')
let tokens = readFileSync(tokensPath, 'utf8')

tokens = tokens.replace(
  /  --palm-t-xs: 13px;[\s\S]*?--palm-t-2xl: 28px;/,
  [
    '  --palm-t-s: 12px;',
    '  --palm-t-m: 14px;',
    '  --palm-t-l: 17px;',
    '  --palm-t-xl: 22px;',
    '  --palm-t-2xl: 28px;',
  ].join('\r\n'),
)
tokens = tokens.replace('  --palm-lh-body: 1.6;', '  --palm-lh-body: 1.5;')
tokens = tokens.replace('  --palm-lh-head: 1.35;', '  --palm-lh-head: 1.3;')
tokens = tokens.replace(
  /  --palm-s5: 24px;[\s\S]*?--palm-s8: 36px;/,
  ['  --palm-s5: 20px;', '  --palm-s6: 24px;', '  --palm-s7: 32px;', '  --palm-s8: 32px;'].join('\r\n'),
)
tokens = tokens.replace(
  /  --palm-r-s: 10px;[\s\S]*?--palm-r-full: 9999px;/,
  [
    '  --palm-r-s: 8px;',
    '  --palm-r-m: 12px;',
    '  --palm-r-l: 18px;',
    '  --palm-r-full: 9999px;',
  ].join('\r\n'),
)
tokens = tokens.replace('  --palm-hit: 46px;', '  --palm-hit: 44px;')

/* 桥接：字号改回定版口径（xs 并到 s，lg 不再跳到 22） */
tokens = tokens.replace(
  /  --text-xs: var\(--palm-t-xs\);[\s\S]*?--text-lg: var\(--palm-t-xl\);/,
  [
    '  --text-xs: var(--palm-t-s);',
    '  --text-sm: var(--palm-t-s);',
    '  --text-md: var(--palm-t-m);',
    '  --text-base: var(--palm-t-l);',
    '  --text-lg: var(--palm-t-l);',
  ].join('\r\n'),
)
// 间距桥接回到定版阶梯
tokens = tokens.replace('  --space-5: var(--palm-s5);', '  --space-5: var(--palm-s5);')
tokens = tokens.replace('  --space-8: var(--palm-s8);', '  --space-8: var(--palm-s8);')

writeFileSync(tokensPath, tokens)

/* ── 2) 恢复分割线：把上一轮降下去的边线颜色改回来 ─────────────────── */
const palettePath = join(PKG, 'src', 'mobile', 'design', 'tokens.ts')
let palette = readFileSync(palettePath, 'utf8')
const restore = [
  ["'--border-default': '#eceef2',", "'--border-default': '#e2e4e8',"],
  ["'--border-subtle': '#f6f7f9',", "'--border-subtle': '#f0f0f2',"],
  ["'--card-border': '#f0f1f5',", "'--card-border': '#e8e8ed',"],
  ["'--border-default': '#232330',", "'--border-default': '#2a2a3a',"],
  ["'--border-subtle': '#1a1a23',", "'--border-subtle': '#1e1e2a',"],
]
let restored = 0
for (const [from, to] of restore) {
  if (palette.includes(from)) {
    palette = palette.replace(from, to)
    restored += 1
  }
}
writeFileSync(palettePath, palette)

console.log(JSON.stringify({
  字号: /--palm-t-s: 12px/.test(tokens),
  行高: tokens.includes('--palm-lh-body: 1.5;'),
  圆角: tokens.includes('--palm-r-s: 8px;'),
  触控: tokens.includes('--palm-hit: 44px;'),
  分割线恢复: `${restored}/5`,
}))
