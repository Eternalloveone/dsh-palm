/**
 * **工作区花名册缓存**（W4-4：从 `api.ts` 移到 data 层）。
 *
 * 原来它是 `api.ts` 顶部的两个 `let`：`workspaceRosterCached` 与 `workspaceRosterInFlight`。
 * 域实现要搬出去时撞上一条硬约束——**ES 模块的导入绑定不可赋值**（TS2632），
 * 所以可变状态不能直接跨模块搬，必须包成访问器。
 *
 * 包成访问器还顺带解决了一个隐性问题：状态只在**一个模块内部**被改，谁也不能从外面
 * 把它置成半初始化。5 秒复用窗口的语义写在 {@link setRosterCached} 旁边。
 *
 * @module dsh-palm/mobile/data/workspace-roster
 */
import type { WorkspaceView } from '../../api-proxy-types'

let cached: { at: number; items: WorkspaceView[] } | undefined
let inFlight: Promise<WorkspaceView[]> | undefined

/** 还没有过期的那份花名册（由调用方比较时间戳，窗口常量在 data/limits.ts）。 */
export function rosterCached(): { at: number; items: WorkspaceView[] } | undefined {
  return cached
}

/** 记下刚取到的花名册（`at` 由调用方给，方便测试注入时钟）。 */
export function setRosterCached(value: { at: number; items: WorkspaceView[] } | undefined): void {
  cached = value
}

/** 正在飞的那次请求：并发的 `workspace.list` 共享它。 */
export function rosterInFlight(): Promise<WorkspaceView[]> | undefined {
  return inFlight
}

/** 记下/清掉在飞的请求（成功、失败、取消都要清，否则下次永远复用一个旧 Promise）。 */
export function setRosterInFlight(value: Promise<WorkspaceView[]> | undefined): void {
  inFlight = value
}
