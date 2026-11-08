/**
 * 路由完整性守卫（P6）。
 *
 * 背景：迁移过程中连续两次出现"页面写好了、路由挂了、但**没有任何入口能点进去**"
 * （审批详情、单文件 diff）。typecheck 全绿、测试全绿，用户照样到不了那一屏 ——
 * 这类漏不在类型系统里，只能靠一条静态断言兜住。
 *
 * 对 `App.tsx` 里每一个 `Route` kind，断言四件事：
 * 1. `backTargetOf` 有它的分支（否则返回是死按钮）；
 * 2. `ROUTE_DEPTH` 有它的深度（否则转场方向算错）；
 * 3. 带参数的 kind 在 `routeKeyOf` 里有专门分支（否则两页共用一个栈 key）；
 * 4. 至少有**一处导航**会构造它（否则这屏没人能到）。
 *
 * @module dsh-palm/mobile/architecture-routes.test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(join(import.meta.dirname, 'views', 'App.tsx'), 'utf8')

/**
 * 不带参数的 kind：key 就是 kind 本身，走 `routeKeyOf` 末尾的兜底。
 * 新增无参数页时加到这里即可；一旦它开始带参数（比如带上 sessionId），
 * 必须从这份名单移走并在 `routeKeyOf` 里单独写分支。
 */
const PARAMLESS = ['workspaces', 'run-overview']

/** 只取 `type Route =` 那一段（到下一个空行 + 注释块为止）。 */
function routeUnionText(): string {
  const start = APP.indexOf('type Route =')
  expect(start, 'App.tsx 里找不到 `type Route =`').toBeGreaterThan(-1)
  const rest = APP.slice(start)
  const end = rest.indexOf('\n\n/**')
  return end === -1 ? rest : rest.slice(0, end)
}

/** 联合类型里出现的全部 kind。 */
function routeKinds(): string[] {
  return [...new Set([...routeUnionText().matchAll(/kind: '([a-z-]+)'/g)].map(match => match[1]!))]
}

describe('路由完整性（每个 kind 都要能到达、能返回、能压栈）', () => {
  const kinds = routeKinds()
  const withParams = kinds.filter(kind => !PARAMLESS.includes(kind))

  it('至少解析出 7 个路由（防止正则失效导致空断言）', () => {
    expect(kinds.length).toBeGreaterThanOrEqual(7)
  })

  it('无参数名单里的 kind 仍然存在（删了页面要同步改名单）', () => {
    for (const kind of PARAMLESS) expect(kinds).toContain(kind)
  })

  it('每个 kind 都在 backTargetOf 里有分支', () => {
    const missing = kinds.filter(kind => !APP.includes(`case '${kind}':`))
    expect(missing, `backTargetOf 缺少分支：${missing.join(', ')}`).toEqual([])
  })

  it('每个 kind 都在 ROUTE_DEPTH 里登记', () => {
    const depthLine = /const ROUTE_DEPTH = \{([^}]*)\}/.exec(APP)?.[1] ?? ''
    const missing = kinds.filter(kind => !depthLine.includes(`${kind}:`) && !depthLine.includes(`'${kind}':`))
    expect(missing, `ROUTE_DEPTH 缺少：${missing.join(', ')}`).toEqual([])
  })

  it('带参数的 kind 在 routeKeyOf 里有专门分支', () => {
    const at = APP.indexOf('export function routeKeyOf')
    const fn = at === -1 ? '' : APP.slice(at, at + 1600)
    const missing = withParams.filter(kind => !fn.includes(`route.kind === '${kind}'`))
    expect(missing, `routeKeyOf 缺少带参数分支：${missing.join(', ')}`).toEqual([])
  })

  it('每个 kind 至少有一处导航会构造它（否则这屏点不进去）', () => {
    const unreachable = kinds.filter(kind => {
      const occurrences = APP.split(`kind: '${kind}'`).length - 1
      // 联合类型里 1 处，至少还要有 1 处导航/构造
      return occurrences < 2
    })
    expect(unreachable, `没有入口能到达：${unreachable.join(', ')}`).toEqual([])
  })
})
