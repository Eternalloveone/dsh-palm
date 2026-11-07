/**
 * **连通性与离线探测**（W3：从 \`ChatView.tsx\` 组件体内抽出的第五个 hook）。
 *
 * 一条铁律：**连通性的真值来自真实请求，不是 \`navigator.onLine\`**。后者只当"可能断了"的提示——
 * 安卓换网、锁屏回来最常见的就是 \`online\` 事件根本不来了，只靠事件横幅会一直挂着，
 * 用户发出去的话也会一直进离线队列。
 *
 * 所以这里做两件事：
 * 1. 事件（offline/online/focus/pageshow/visibilitychange）都只触发**主动探一次**；
 * 2. 断着的时候自己每 5 秒探一次，通了就撤横幅并立刻冲刷离线队列。
 *
 * 探测**自带 4 秒短超时**：默认 60 秒的请求超时会让探测本身卡住，横幅既不撤也不重探。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-connectivity
 */
import { useCallback, useEffect } from 'react'

import { history } from '../../../data/session.ts'
import { onConnectivityChange } from '../../../rpc.ts'

/** 离线横幅的探测间隔与超时（真机取值，改之前先量）。 */
export const OFFLINE_PROBE_MS = 5_000
export const OFFLINE_PROBE_TIMEOUT_MS = 4_000

/** hook 依赖。 */
export interface ChatConnectivityDeps {
  sessionId: string
  offline: boolean
  setOffline: (value: boolean) => void
  /** 通了之后要立刻冲刷离线队列。 */
  refreshOutbox: () => void
}

/** @returns 手动探一次宿主（发消息前也可以用它确认在线）。 */
export function useChatConnectivity(deps: ChatConnectivityDeps): { probeHost: () => Promise<boolean> } {
  const { sessionId, offline, setOffline, refreshOutbox } = deps

  /**
   * 探一次宿主：成功即在线，失败/超时即仍断。
   *
   * 自带短超时：默认 60 秒的请求超时在"弱网挂着"的场景下会让探测本身卡住。
   * 4 秒没答话就当这次没通。
   */
  const probeHost = useCallback((): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => { resolve(false) }, OFFLINE_PROBE_TIMEOUT_MS)
    })
    const call = Promise.resolve()
      .then(() => history(sessionId, undefined, 1))
      .then(() => true, () => false)
    return Promise.race([call, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }, [sessionId])

  useEffect(() => {
    const unsubscribe = onConnectivityChange(online => { setOffline(!online) })
    const onOfflineHint = (): void => { setOffline(true) }
    const onOnlineHint = (): void => { void probeHost().then(reachable => { setOffline(!reachable) }) }
    window.addEventListener('offline', onOfflineHint)
    window.addEventListener('online', onOnlineHint)
    window.addEventListener('focus', onOnlineHint)
    window.addEventListener('pageshow', onOnlineHint)
    document.addEventListener('visibilitychange', onOnlineHint)
    return () => {
      unsubscribe()
      window.removeEventListener('offline', onOfflineHint)
      window.removeEventListener('online', onOnlineHint)
      window.removeEventListener('focus', onOnlineHint)
      window.removeEventListener('pageshow', onOnlineHint)
      document.removeEventListener('visibilitychange', onOnlineHint)
    }
  }, [probeHost, setOffline])

  // 断开期间自己恢复：每 5 秒探一次宿主（通了就撤横幅，队列随即自动发出去）。
  useEffect(() => {
    refreshOutbox()
  }, [refreshOutbox])

  useEffect(() => {
    if (!offline) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (cancelled) return
      void probeHost().then((reachable) => {
        if (cancelled) return
        if (reachable) {
          setOffline(false)
          refreshOutbox()
        } else {
          timer = setTimeout(tick, OFFLINE_PROBE_MS)
        }
      })
    }
    // 注意：**不要**在这里立刻 tick()——首次探测要等 5 秒。断网瞬间横幅已经由
    // `offline` 事件给出，立刻再探一次只会让测试与真机都多一次无谓请求。
    timer = setTimeout(tick, OFFLINE_PROBE_MS)
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [offline, probeHost, setOffline, refreshOutbox])

  return { probeHost }
}
