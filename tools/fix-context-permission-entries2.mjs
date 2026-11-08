import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')

// 上下文入口：接了 ⑦ 页面就走页面（用正则吃 CRLF，别再按 LF 拼字符串）
text = text.replace(
  /  const toggleContextPop = \(\): void => \{\r?\n    if \(contextUsage === undefined\) return\r?\n    setPicker\(null\)\r?\n    setContextOpen\(previous => !previous\)\r?\n  \}/,
  [
    '  const toggleContextPop = (): void => {',
    '    // 规则见 chat/state/entry-routing.ts：接了 ⑦ 页面就走页面，否则退回气泡',
    "    const target = contextEntryTarget(contextUsage !== undefined, onOpenContext !== undefined)",
    "    if (target === 'none') return",
    '    setPicker(null)',
    "    if (target === 'page') {",
    '      setContextOpen(false)',
    '      onOpenContext?.(contextUsage!)',
    '      return',
    '    }',
    '    setContextOpen(previous => !previous)',
    '  }',
  ].join('\r\n'),
)

// 权限入口：接了 ⑥ 页面就走页面
text = text.replace(
  /  const openPermissionPicker = \(\): void => \{\r?\n    setContextOpen\(false\)\r?\n    setPicker\('permission'\)\r?\n  \}/,
  [
    '  const openPermissionPicker = (): void => {',
    '    setContextOpen(false)',
    "    if (permissionEntryTarget(onOpenApprovalMode !== undefined) === 'page') {",
    '      setPicker(null)',
    '      if (permissions !== undefined) onOpenApprovalMode?.(permissions)',
    '      return',
    '    }',
    "    setPicker('permission')",
    '  }',
  ].join('\r\n'),
)

writeFileSync(P, text)
console.log(
  '上下文:',
  text.includes('contextEntryTarget(contextUsage'),
  '| 权限:',
  text.includes('permissionEntryTarget(onOpenApprovalMode'),
)
