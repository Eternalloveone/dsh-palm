/**
 * 把两个仅服务于搜索结果快照的接口从 mobile-api.ts 搬到 process-state.ts，
 * 并完成最后一个进程级状态的迁移。可重复执行（已搬过会直接跳过）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const STATE = join(PKG, 'src', 'mobile', 'api', 'process-state.ts')

let api = readFileSync(API, 'utf8')

if (api.includes('interface OrdinarySearchSession')) {
  // 1) 摘掉两个接口（含其后空行）
  api = api.replace(/interface OrdinarySearchSession \{[\s\S]*?\n\}\n\n?/, '')
  api = api.replace(/interface OrdinarySearchSnapshot \{[\s\S]*?\n\}\n\n?/, '')

  // 2) 让现有 import 顺带引入这两个类型
  api = api.replace(
    "import { processState } from './mobile/api/process-state.ts'",
    "import { processState, type OrdinarySearchSession, type OrdinarySearchSnapshot } from './mobile/api/process-state.ts'",
  )
  writeFileSync(API, api)
  console.log('interfaces moved out of mobile-api.ts')
} else {
  console.log('interfaces already moved')
}

let state = readFileSync(STATE, 'utf8')
if (!state.includes('interface OrdinarySearchSession')) {
  state = state.replace(
    '/** TTL 缓存的通用形状',
    `/** 一条搜索命中的会话（普通搜索路径的中间形状）。 */
export interface OrdinarySearchSession {
  sessionId: string
  updatedAt: number
  title?: string
}

/** 普通搜索的进程内快照。 */
export interface OrdinarySearchSnapshot {
  sessions: OrdinarySearchSession[]
  byId: Map<string, OrdinarySearchSession>
  workspace: Map<string, string>
  workspaceTitle: Map<string, string>
  rosterPartial: boolean
}

/** TTL 缓存的通用形状`,
  )
  state = state.replace(
    '  /** 会话列表排序结果缓存（key 变化即失效）。 */',
    `  /** 普通搜索结果快照缓存。 */
  ordinarySearchSnapshotCache:
    | { at: number; proxy: ApiProxy; value: OrdinarySearchSnapshot }
    | undefined
  /** 会话列表排序结果缓存（key 变化即失效）。 */`,
  )
  state = state.replace(
    '  sessionListSortedCache: undefined,',
    '  ordinarySearchSnapshotCache: undefined,\n  sessionListSortedCache: undefined,',
  )
  writeFileSync(STATE, state)
  console.log('interfaces + cache field added to process-state.ts')
} else {
  console.log('state already contains interfaces')
}
