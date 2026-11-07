/**
 * **首屏绘制探针**（S2-J：从 `ChatView.tsx` 搬出）。
 *
 * 每个会话**只跑一次**，等 2.5 秒后把「当时屏幕上到底画出了什么」报给宿主的性能通道：
 * 有几个回合尾卡、几行消息、离底部还有多远。
 *
 * 为什么要有它：卡片消失、行数不对、跳到底部不准这三类问题，**在手机上用眼睛看不出来
 * 是哪一层错了**——是折叠没折出来，还是折出来了没画上去。有了这条探针就能直接对账。
 *
 * 三条实现约束：
 *
 * 1. **只跑一次**（`usedRef`）：每次渲染都报会淹掉通道，而且第二次数值已经不是首屏了。
 * 2. **失败一律吞掉**：老宿主没有这个入口、上报超时——都不能影响聊天。
 * 3. 2.5 秒是经验值：小于它时行还没画完（报出来全是 0），大于它时用户已经滚走了。
 *
 * @module dsh-palm/mobile/views/chat/use-card-dom-probe
 */
import { useEffect, type MutableRefObject } from 'react'

/** 依赖。 */
export interface CardDomProbeDeps {
  /** 当前会话（换会话重新算一次"首屏"）。 */
  sessionId: string
  /** 是否已经报过。 */
  usedRef: MutableRefObject<boolean>
  /** 最近一次渲染决定的绘制窗口与活跃轮次。 */
  probeRef: MutableRefObject<Record<string, unknown> | undefined>
  /** 滚动容器。 */
  scrollRef: MutableRefObject<HTMLElement | undefined>
  /** 上报性能数据（返回值可忽略）。 */
  reportPerf: (payload: Record<string, unknown>, label: string) => Promise<unknown>
  /** 延时，默认 2500ms（小于它时行还没画完，大于它时用户已经滚走）。 */
  delayMs?: number
}

/** 首屏绘制探针：每个会话只报一次。 */
export function useCardDomProbe(deps: CardDomProbeDeps): void {
  const { sessionId, usedRef, probeRef, scrollRef, reportPerf, delayMs = 2_500 } = deps
  useEffect(() => {
    if (usedRef.current) return
    usedRef.current = true
    const timer = window.setTimeout(() => {
      const probe = probeRef.current
      if (probe === undefined) return
      try {
        void reportPerf({
          stamps: [{ at: Date.now(), label: 'carddom' }],
          diagnostic: 'card-dom',
          at: Date.now(),
          ...probe,
          painted: document.querySelectorAll('.chat-turn-tail').length,
          paintedRows: document.querySelectorAll('.chat-msg').length,
          fromBottom: (() => {
            const node = scrollRef.current
            return node === undefined ? null : Math.round(node.scrollHeight - node.scrollTop - node.clientHeight)
          })(),
        }, 'carddom').catch(() => { /* 探针失败不影响聊天 */ })
      } catch {
        // 老宿主没有这个入口：少一条探针而已。
      }
    }, delayMs)
    return () => { window.clearTimeout(timer) }
  }, [sessionId, usedRef, probeRef, scrollRef, reportPerf, delayMs])
}
