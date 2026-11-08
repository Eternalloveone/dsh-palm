import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SettingsView.tsx')
let text = readFileSync(P, 'utf8')

// 上一步的替换把 <AppearanceSection 写成了两行（重复一次开场标签）；这里修回来
text = text.replace(
  /        <AppearanceSection\r?\n          onOpenAppearance=\{onOpenAppearance\}\r?\n<AppearanceSection\r?\n/,
  '        <AppearanceSection\r\n          onOpenAppearance={onOpenAppearance}\r\n',
)

writeFileSync(P, text)
const occurrences = (text.match(/<AppearanceSection/g) ?? []).length
console.log('AppearanceSection 开标签数量:', occurrences)
