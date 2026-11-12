/**
 * 「切换工作区」面板的折叠状态（哪些项目组是展开的），存 localStorage。
 *
 * 为什么要存：面板默认全折叠能把 34 个工作区压到一屏 10 组，但**每次都从头折叠**很烦 ——
 * 用户天天用的就是那两三个项目，每次打开都得重新点开。记住展开过的组，
 * 下次打开就是上次的样子。
 *
 * 存储格式是 `string[]`（组键，如 `project:D:\work\ICNT9388\1.Code`）；坏数据/配额满都按
 * 「没有记录」处理，绝不因为一个缓存把面板弄崩。
 *
 * @module dsh-palm/mobile/views/chat/components/workspace-picker-store
 */

/** localStorage 键（跟 display-prefs 的 `dsh.palm.*` 一致；`.v1` 便于以后改格式）。 */
export const EXPANDED_GROUPS_KEY = 'dsh.palm.wsExpanded.v1'

/** 最多记多少个组：34 个工作区也就 16 组，留 200 足够，防止越攒越大。 */
const MAX_KEYS = 200

/**
 * 读回展开过的组键。
 *
 * @returns 组键数组（没记录、坏数据、存储不可用时为空数组）
 */
export function readExpandedGroups(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_GROUPS_KEY)
    if (raw === null || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item !== '')
  } catch {
    return []
  }
}

/**
 * 写回展开过的组键（超出 {@link MAX_KEYS} 时保留最后写入的那些）。
 *
 * @param keys - 当前展开的组键
 */
export function writeExpandedGroups(keys: Iterable<string>): void {
  try {
    const list = [...keys].slice(-MAX_KEYS)
    localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式 / 配额满：折叠状态存不住不影响用，不抛。 */
  }
}
