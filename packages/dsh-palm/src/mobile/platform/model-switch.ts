/**
 * 「刚换了模型」这一件事的广播口（2026-11-14）。
 *
 * ## 为什么需要它
 *
 * 用户：「我在输入框下方切换完模型之后，侧边栏的『用量』也要同时切换成当前模型的
 * 本周或者本月已用用量值」。抽屉里那行小字由 `views/use-usage-chip.ts` 算，而模型是
 * 在对话页（`ChatView`）换的 —— 两个 React 子树没有共同的父状态可传（抽屉是 App 的
 * 兄弟节点，ChatView 的模型状态在它自己里面）。
 *
 * 与其把「当前模型」提升成全局状态（那会把 ChatView 的模型目录也拖成全局的），不如只
 * 广播**一次事实**：谁换了模型、换成哪家。订阅方自己决定要不要重算。
 *
 * ## 为什么挂在 data 层而不是 ChatView
 *
 * 手机端换模型只有一条路：`data/impl/settings.ts` 的 `selectModel()`。在那里广播等于
 * 「所有换模型的入口都算数」，ChatView 一行都不用改（它的行数预算已经顶到上限）。
 *
 * 零依赖、不做错误上报：一个订阅者抛错不该拖垮换模型本身。
 *
 * @module dsh-palm/mobile/platform/model-switch
 */

/** 一次模型切换：哪个会话、切到了哪家提供方。 */
export interface ModelSwitch {
  sessionId: string
  /** 提供方路由键（`opencode-go` / `deepseek` …），与用量行的 `route` 同一套叫法。 */
  provider: string
  /** 模型 id（只在日志/调试里有用，界面不显示）。 */
  model: string
}

type Listener = (change: ModelSwitch) => void

const listeners = new Set<Listener>()
let last: ModelSwitch | undefined

/** 广播一次模型切换（`selectModel` 成功后调用）。 */
export function announceModelSwitch(change: ModelSwitch): void {
  last = change
  // 快照再遍历：订阅者在回调里退订也不会打乱这一次派发。
  for (const listener of [...listeners]) {
    try {
      listener(change)
    } catch {
      // 一个订阅者出错不影响别的订阅者，更不影响这次换模型。
    }
  }
}

/**
 * 订阅模型切换。
 *
 * @param listener - 收到切换后要做的事
 * @returns 退订函数
 */
export function subscribeModelSwitch(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 最近一次切换。
 *
 * 抽屉是后打开的：它需要在挂载时就知道"现在这个会话的模型是哪家"，而不必等下一次
 * 广播，也不必为此多打一次 `session.models`。
 */
export function lastModelSwitch(): ModelSwitch | undefined {
  return last
}

/** 只给测试用：清掉广播历史与订阅者。 */
export function resetModelSwitchForTests(): void {
  listeners.clear()
  last = undefined
}
