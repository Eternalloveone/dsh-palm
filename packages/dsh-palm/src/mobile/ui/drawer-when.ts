/**
 * 抽屉一行右侧那句「什么时候」。
 *
 * 位置说明（2026-11-11）：这个函数原来住在 `views/drawer-rows.ts`，但它是
 * **纯展示格式化**、被 `ui/session-drawer.tsx` 直接调用 —— 于是 ui 内核反过来
 * import 了 views，踩了架构测试的红线（`ui 内核只向下依赖`）。
 * 挪到 ui 层后，ui 自己用、views 若将来要用也仍然是向下依赖。
 *
 * @module dsh-palm/mobile/ui/drawer-when
 */

/** 一天的毫秒数：今天/昨天分界（与抽屉分桶用同一个口径）。 */
const DAY_MS = 86_400_000

/**
 * 会话行右侧那句「什么时候」。
 *
 * 2026-11-11 用户：「侧边栏的右边有点空」—— 指的是一行里标题在左、状态条在右，
 * 中间到右边一大条空白，没有任何信息。时间是最省地方又真有用的一种填充：
 * 今天给时刻（`09:05`）、昨天给「昨天」、更早给月-日（跨年补年份）。
 *
 * @param updatedAt - 会话更新时间（毫秒）
 * @param now - 当前时间（毫秒），默认取此刻
 * @returns 一行能直接放进 `<small>` 的短文本；时间戳不可用时返回空串（那一行就不画）
 */
export function drawerWhenLabel(updatedAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const when = new Date(updatedAt)
  if (Number.isNaN(when.getTime())) return ''
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const clock = `${`${when.getHours()}`.padStart(2, '0')}:${`${when.getMinutes()}`.padStart(2, '0')}`
  if (updatedAt >= midnight) return clock
  if (updatedAt >= midnight - DAY_MS) return '昨天'
  const month = `${when.getMonth() + 1}`.padStart(2, '0')
  const day = `${when.getDate()}`.padStart(2, '0')
  return when.getFullYear() === new Date(now).getFullYear()
    ? `${month}-${day}`
    : `${when.getFullYear()}-${month}-${day}`
}
