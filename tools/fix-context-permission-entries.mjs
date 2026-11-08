import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')
const eol = '\r\n'

/* 1) 导入决策模块 */
if (!text.includes('entry-routing.ts')) {
  const anchor = "import { TurnListSheet" // 不存在则退回按第一个相对 import 插入
  const importLine = `import { contextEntryTarget, permissionEntryTarget } from './chat/state/entry-routing.ts'`
  const firstImport = text.indexOf("import ")
  text = `${text.slice(0, firstImport)}${importLine}${eol}${text.slice(firstImport)}`
  void anchor
}

/* 2) 上下文入口：接了页面就走页面 */
const beforeContext = `  const toggleContextPop = (): void => {
    if (contextUsage === undefined) return
    setPicker(null)
    setContextOpen(previous => !previous)
  }`
const afterContext = `  const toggleContextPop = (): void => {
    // 规则见 chat/state/entry-routing.ts：接了 ⑦ 页面就走页面，否则退回气泡
    const target = contextEntryTarget(contextUsage !== undefined, onOpenContext !== undefined)
    if (target === 'none') return
    setPicker(null)
    if (target === 'page') {
      setContextOpen(false)
      onOpenContext?.(contextUsage!)
      return
    }
    setContextOpen(previous => !previous)
  }`
if (text.includes(beforeContext)) text = text.replace(beforeContext, afterContext)

/* 3) 权限入口：接了页面就走页面 */
const beforePermission = `  const openPermissionPicker = (): void => {
    setContextOpen(false)
    setPicker('permission')
  }`
const afterPermission = `  const openPermissionPicker = (): void => {
    setContextOpen(false)
    if (permissionEntryTarget(onOpenApprovalMode !== undefined) === 'page') {
      setPicker(null)
      if (permissions !== undefined) onOpenApprovalMode?.(permissions)
      return
    }
    setPicker('permission')
  }`
if (text.includes(beforePermission)) text = text.replace(beforePermission, afterPermission)

writeFileSync(P, text)
console.log('导入:', text.includes('entry-routing.ts'), '| 上下文:', text.includes('contextEntryTarget(contextUsage'), '| 权限:', text.includes('permissionEntryTarget('))
