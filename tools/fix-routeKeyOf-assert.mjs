import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture-routes.test.ts')
let text = readFileSync(P, 'utf8')

text = text.replace(
  `  it('每个 kind 都能被 routeKeyOf 给出稳定 key', () => {
    const fn = APP.slice(APP.indexOf('export function routeKeyOf'), APP.indexOf('export function routeKeyOf') + 800)
    const missing = kinds.filter(kind => kind !== 'workspaces' && !fn.includes(\`route.kind === '\${kind}'\`))
    // workspaces 走最后的 \`return route.kind\` 兜底，所以单独放行
    expect(missing, \`routeKeyOf 缺少：\${missing.join(', ')}\`).toEqual([])
  })`,
  `  it('带参数的 kind 必须由 routeKeyOf 单独给 key（无参数的走兜底）', () => {
    const fn = APP.slice(APP.indexOf('export function routeKeyOf'), APP.indexOf('export function routeKeyOf') + 800)
    // 只对"联合类型里带字段"的 kind 提要求：它们必须按字段区分，否则两页共用一个 key
    const withParams = kinds.filter(kind => {
      const union = routeUnionText()
      const inline = new RegExp(\`\\\\{ kind: '\${kind}'[^}]*\\\\}\`).exec(union)?.[0] ?? ''
      if (inline.includes(';') || inline.includes(':')) return true
      // 多行写法的分支：从 kind 行到下一个 kind 之前
      const branch = new RegExp(\`kind: '\${kind}'\\\\r?\\\\n([\\\\s\\\\S]*?)(?=kind: '|\\\\z)\`).exec(union)?.[1] ?? ''
      return branch.trim() !== ''
    })
    const missing = withParams.filter(kind => !fn.includes(\`route.kind === '\${kind}'\`))
    expect(missing, \`routeKeyOf 缺少带参数分支：\${missing.join(', ')}\`).toEqual([])
  })`,
)

writeFileSync(P, text)
console.log('routeKeyOf 断言已按"是否带参数"区分')
