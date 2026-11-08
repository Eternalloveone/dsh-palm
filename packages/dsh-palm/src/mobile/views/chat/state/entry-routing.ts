/**
 * 对话页的两个入口该往哪走（P6 ⑥ ⑦）。
 *
 * 为什么单独成文件：这两个入口曾经「页面写好了、App 也传了回调，但 ChatView 里
 * 仍然走旧的浮层分支」——用户在手机上点到的还是气泡/选择面板，页面永远打不开，
 * 而所有单测都是绿的（没人断言"点下去去了哪"）。
 *
 * 这条规则只有一句话：**接了页面就走页面，没接页面才退回浮层**。
 * 把它抽成纯函数，就能被单测钉死，不必渲染整个 ChatView。
 *
 * @module dsh-palm/mobile/views/chat/state/entry-routing
 */

/** 入口的归属：独立页面 / 就地浮层 / 什么都不做。 */
export type EntryTarget = 'page' | 'popover' | 'none'

/**
 * 上下文占用入口。
 *
 * @param hasUsage - 宿主是否报了上下文用量（没有就无从展示，什么都不做）
 * @param pageWired - 上层是否接了 ⑦ 上下文页
 * @returns 该走页面、就地气泡，还是不动
 */
export function contextEntryTarget(hasUsage: boolean, pageWired: boolean): EntryTarget {
  if (!hasUsage) return 'none'
  return pageWired ? 'page' : 'popover'
}

/**
 * 权限入口（⑥ 批准方式）。
 *
 * @param pageWired - 上层是否接了 ⑥ 批准方式页
 * @returns 该走页面还是就地选择面板
 */
export function permissionEntryTarget(pageWired: boolean): 'page' | 'sheet' {
  return pageWired ? 'page' : 'sheet'
}
