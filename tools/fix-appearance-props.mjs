import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

// 1) SettingsView：可选入口
const S = join(PKG, 'src', 'mobile', 'views', 'SettingsView.tsx')
let s = readFileSync(S, 'utf8')
if (!s.includes('onOpenAppearance')) {
  s = s.replace(
    /export interface SettingsViewProps \{([\s\S]*?)\n\}/,
    (match, body: string) => `export interface SettingsViewProps {${body}${eol}  /** 打开「外观」页（P6 ⑭ 屏）；不给就还开浮层。 */${eol}  onOpenAppearance?: (() => void) | undefined${eol}}`,
  )
  // 解构里补上
  s = s.replace(/export function SettingsView\(\{([^}]*)\}\)/, (match, body: string) => `export function SettingsView({${body.replace(/\s*$/, '')}${body.includes('onBack') ? '' : ''} })`.replace(',  }', ',  }'))
  writeFileSync(S, s)
}

// 2) 等价性测试补 appearance
const T = join(PKG, 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let t = readFileSync(T, 'utf8')
if (!t.includes('  appearance: {')) {
  t = t.replace(
    `  model: { kind: 'chat', session, workspace },`,
    `  model: { kind: 'chat', session, workspace },${eol}  appearance: { kind: 'settings', workspace },`,
  )
}
if (!t.includes("kind: 'appearance'")) {
  t = t.replace(
    `  { kind: 'model', session, workspace },`,
    `  { kind: 'model', session, workspace },${eol}  { kind: 'appearance', workspace },`,
  )
}
writeFileSync(T, t)

console.log('settings props:', s.includes('onOpenAppearance'), '| test:', t.includes('appearance: {'))
