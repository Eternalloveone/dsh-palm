import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'AppearanceView.tsx')
let text = readFileSync(P, 'utf8')

// 主题用的是 mode（system/light/dark），对应 getMobileThemeMode / setMobileThemeMode
text = text.replace(
  "import { getMobileTheme, setMobileTheme, type MobileThemeMode } from '../mobile-theme.ts'",
  "import { getMobileThemeMode, setMobileThemeMode, type MobileThemeMode } from '../mobile-theme.ts'",
)
text = text.replace('useState<MobileThemeMode>(() => getMobileTheme())', 'useState<MobileThemeMode>(() => getMobileThemeMode())')
text = text.replace('setMobileTheme(next)', 'setMobileThemeMode(next)')

writeFileSync(P, text)
console.log('主题 API 已对齐 mode 版本')
