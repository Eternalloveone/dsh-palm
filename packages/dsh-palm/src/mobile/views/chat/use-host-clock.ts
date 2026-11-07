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
   * 渲染时取一次**宿主时间**（毫秒）。
   *
   * 以前这里返回的是「宿主时间 − 本机墙钟」的偏移，行内再算
   * `Date.now() + 偏移 − 锚点` —— 两次读墙钟之间手机校时就会把误差带回来。
   * 现在直接把宿主时间交给渲染层做减法（W3-5）。
   *
   * **没校准过时退回本机墙钟**：那时锚点也只可能来自本机推算，退回墙钟至少能给出
   * 一个读数（老行为）；一旦收到第一帧宿主时间，之后读数完全由单调时钟推进，
   * 墙钟再怎么跳都不再参与。
   */
  hostNow: () => number
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
      hostNow: () => clock().now() ?? Date.now(),
      reset: () => { ref.current = undefined },
    }
  }, [])
}
