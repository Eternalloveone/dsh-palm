// 把闭包内的纯工具 wrap() 提成模块级 api/wrap.ts，并修正 move-domain2 的 import 位置。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const API = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile', 'api', 'wrap.ts')
const MOVE = join(import.meta.dirname, 'move-domain2.mjs')

writeFileSync(OUT, `/**
 * RPC 应答的统一外壳（从 makeMobileApiRoutes 闭包内提出来，纯函数）。
 *
 * 搬出来的理由：workspace / settings 等域的处理器都要用它，
 * 留在闭包里会让「整域搬移」永远差一口气。
 *
 * @module dsh-palm/mobile/api/wrap
 */

/** 把处理器返回值包成客户端认识的 server-response 帧。 */
export function wrap(response: { rpcId: string; result: unknown }): unknown {
  return {
    type: 'server-response' as const,
    rpcId: response.rpcId,
    result: response.result,
  }
}
`)

const lines = readFileSync(API, 'utf8').split('\n')
const start = lines.findIndex(line => /^\s*const wrap = \(response:/.test(line))
if (start < 0) {
  console.log('wrap 定义未找到（可能已搬过）')
} else {
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (/^\s*\}\)\s*$/.test(lines[i])) { end = i; break }
  }
  const next = [...lines.slice(0, start), ...lines.slice(end + 1)]
  next.unshift("import { wrap } from './mobile/api/wrap.ts'")
  writeFileSync(API, next.join('\n'))
  console.log(`wrap 搬出：删除 ${end - start + 1} 行，原文件 ${lines.length} → ${next.length}`)
}

// 修 move-domain2：import 必须落在顶层，不能插在函数体里
let mover = readFileSync(MOVE, 'utf8')
if (mover.includes('lines.splice(tableStarts[0], 0,')) {
  mover = mover.replace('lines.splice(tableStarts[0], 0,', 'lines.splice(0, 0,')
  writeFileSync(MOVE, mover)
  console.log('move-domain2 import 位置已修正为文件顶层')
}
