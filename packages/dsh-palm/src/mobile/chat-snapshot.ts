/**
 * 进会话第一帧用的内存快照。
 *
 * 真机：「一进会话就会刷新闪烁一下」。原因是进会话那一帧什么都还没有 —— 缓存页要走
 * IndexedDB（异步，哪怕只要十几毫秒，也够先画出一帧空列表），网络页再晚一个往返，
 * 于是屏幕上先空、再内容、再整份换掉。
 *
 * 这里把**上一次画过的行**按会话存进内存（同步读，零延迟）：只要这一场本次运行里
 * 打开过，再进来第一帧就是内容，之后网络页到了照旧覆盖 —— 看得见的只有"新消息"，没有
 * "空 → 有"的闪。跨刷新/关页仍由 IndexedDB 那份缓存兜底。
 *
 * 刻意做小：只留最近几场、每场只留尾部若干行。这里存的是一份渲染快照，不参与任何
 * 判定（卡片补读、活跃轮次都另有来源），所以过时也只是"短暂显示旧内容"。
 */
import type { RenderMessage } from './messages.ts'

/** 最多留几场会话（手机上同时翻的会话不会多）。 */
const MAX_SESSIONS = 4
/** 每场最多留多少行：够铺满首屏并留出上翻余量，再多就交给分页。 */
const MAX_ROWS = 240

interface ChatSnapshot {
  rows: RenderMessage[]
  hasOlder: boolean
}

const snapshots = new Map<string, ChatSnapshot>()

/** 记下这一场当前画出来的样子（每次提交后调用）。 */
export function rememberChatSnapshot(sessionId: string, rows: RenderMessage[], hasOlder: boolean): void {
  // 空表不记：否则二次挂载会把「还没有内容」当成快照，加载中状态被误跳过。
  if (sessionId === '' || rows.length === 0) return
  const kept = rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : [...rows]
  // 重新插入把它挪到最近使用的位置（Map 保持插入顺序）。
  snapshots.delete(sessionId)
  snapshots.set(sessionId, { rows: kept, hasOlder })
  while (snapshots.size > MAX_SESSIONS) {
    const oldest = snapshots.keys().next()
    if (oldest.done === true) break
    snapshots.delete(oldest.value)
  }
}

/** 取这一场上一次画出来的样子；没打开过就是 undefined。 */
export function recallChatSnapshot(sessionId: string): ChatSnapshot | undefined {
  const found = snapshots.get(sessionId)
  return found !== undefined && found.rows.length > 0 ? found : undefined
}

/** 丢掉这一场的快照（例如用户把它删了，或宿主说这一场已不存在）。 */
export function forgetChatSnapshot(sessionId: string): void {
  snapshots.delete(sessionId)
}

/** 测试用：清空全部快照。 */
export function clearChatSnapshots(): void {
  snapshots.clear()
}
