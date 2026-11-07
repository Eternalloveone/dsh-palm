/**
 * 宿主时钟的 React 接线（把 `host-clock.ts` 的纯逻辑挂到 ChatView 上）。
 *
 * 单独成文件是为了不让 ChatView 再长——那里有"只许变短"的行数预算
 * （architecture.test.ts），而时钟接线本身没有视图逻辑。
 *
 * @module dsh-palm/mobile/views/chat/use-host-clock
 */
import { useMemo, useRef } from 'react'
import { createHostClock, type HostClock } from '../../host-clock.ts'

export interface HostClockHandle {
  /** 用一帧的宿主时间戳校准（每帧一次，turn/start 帧除外）。 */
  sync: (hostMs: number) => void
  /**
   * 渲染时取一次「宿主时间 − 本机墙钟」的瞬时偏移。
   *
   * 行内算式仍是 `Date.now() + 偏移 − 锚点`，但这里两项在**同一刻**取，
   * 手机墙钟的误差当场抵消（等价于 `宿主时间 − 锚点`）。还没校准过时返回 0
   * （此时行内也不会显示秒表，因为拿不到锚点）。
   */
  offsetNow: () => number
  /** 换会话：丢掉基准，等新会话的帧重新校准。 */
  reset: () => void
}

export function useHostClock(): HostClockHandle {
  const ref = useRef<HostClock | undefined>(undefined)
  return useMemo<HostClockHandle>(() => {
    const clock = (): HostClock => {
      if (ref.current === undefined) ref.current = createHostClock()
      return ref.current
    }
    return {
      sync: (hostMs: number) => { clock().sync(hostMs) },
      offsetNow: () => {
        const hostNow = clock().now()
        return hostNow === undefined ? 0 : hostNow - Date.now()
      },
      reset: () => { ref.current = undefined },
    }
  }, [])
}
