/**
 * **收件箱轮询**（S2-M：从 `ChatView.tsx` 搬出）。
 *
 * 为什么手机上必须轮询：宿主投递排队消息**走的不是帧**，客户端收不到任何事件，
 * 只能问。所以节奏要随状态变：
 *
 * | 状态 | 间隔 | 理由 |
 * |---|---|---|
 * | 队列非空 | 1.5 秒 | 屏幕上正挂着用户刚排的那几条，宿主一投递/一删除，手机必须马上跟上 |
 * | 有回合在跑 | 3 秒 | 在等结果，但队列没东西 |
 * | 空闲 | 8 秒 | 没有卡片要看，问得再勤也只是白烧隧道往返 |
 *
 * 两条容易漏的：
 *
 * 1. **切回前台立刻对一次**——息屏那段时间的帧全丢了，不补这一下会看到过期列表。
 * 2. **页面隐藏时跳过**（`document.hidden`），否则后台标签页在白烧流量。
 *
 * 注意写操作本身已经即时生效（乐观项 + 回执），轮询只负责**收敛**。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-inbox-poll
 */
import { useEffect } from 'react'

/** 依赖。 */
export interface InboxPollDeps {
  /** 有回合在跑。 */
  running: boolean
  /** 有排队项。 */
  hasPendingQueue: boolean
  /** 问一次宿主并更新收件箱。 */
  refreshInbox: () => void
}

/** 按状态变速的收件箱轮询。 */
export function useInboxPoll(deps: InboxPollDeps): void {
  const { running, hasPendingQueue, refreshInbox } = deps
  useEffect(() => {
    refreshInbox()
    const timer = window.setInterval(() => {
      // 页面在后台时不问（前台可见性变化时会立刻补一次）。
      if (!document.hidden) refreshInbox()
    }, hasPendingQueue ? 1500 : running ? 3000 : 8000)
    // 从后台切回来立刻对一次：息屏那段时间的帧全丢了。
    const onVisible = (): void => { if (!document.hidden) refreshInbox() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, refreshInbox, hasPendingQueue])
}
