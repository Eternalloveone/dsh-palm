/**
 * 手机端"正在看哪个会话"的登记表：一个纯**路由表**（不承载任何流生命周期）。
 *
 * 两个用途：
 * 1. **按设备过滤 SSE**（省移动流量）：隧道另一头是手机流量，本设备没打开的会话
 *    没必要把 `tool/result` 这类大载荷推过去（见 mobile-api 的 `handleEvents`）；
 * 2. **只翻译被观察会话的助手流**：宿主总线上的 chunk 是所有会话的，只翻译手机在看的
 *    那些（见 api-proxy-stream.ts）。
 *
 * 桌面端有会话订阅握手，手机端在 0.1.5 适配后没有（旧的 `session/subscribed` 帧已无
 * 生产者），所以要自己立一条"手机在看哪个会话"的信号。
 *
 * 生命周期按**设备**登记（配对 cookie 的 deviceId）：
 * - 设备切换会话 = 覆盖登记（不需要重开 SSE，所以不会在切换时留下事件空洞）；
 * - 设备的 SSE 流结束 = 释放该设备的登记；
 * - 手机侧在会话页每 30s 重申一次（见 App 的 observe 断言），所以流被隧道掐断后
 *   自动重连也能把登记补回来。
 */
export class SessionObserverRegistry {
  /** deviceId → 该设备正在看的会话。 */
  private readonly byDevice = new Map<string, string>()
  private readonly listeners = new Set<(sessionIds: readonly string[]) => void>()

  /**
   * 登记一台设备正在看的会话。
   * @param deviceId - 配对设备 id（SSE cookie）。
   * @param sessionId - 会话 id；`undefined` 表示该设备离开了会话。
   */
  observe(deviceId: string, sessionId: string | undefined): void {
    if (deviceId === '') return
    const previous = this.byDevice.get(deviceId)
    if (sessionId === undefined) {
      if (previous === undefined) return
      this.byDevice.delete(deviceId)
    } else {
      if (previous === sessionId) return
      this.byDevice.set(deviceId, sessionId)
    }
    this.notify()
  }

  /** 设备断开（SSE 流结束）时释放它的登记。 */
  release(deviceId: string): void {
    if (!this.byDevice.delete(deviceId)) return
    this.notify()
  }

  /** 当前被观察的会话（去重）。 */
  sessions(): string[] {
    return [...new Set(this.byDevice.values())]
  }

  /** 某台设备正在看的会话（0 或 1 个）；SSE 按设备过滤帧时用。 */
  sessionsFor(deviceId: string): string[] {
    const sessionId = this.byDevice.get(deviceId)
    return sessionId === undefined ? [] : [sessionId]
  }

  /** 订阅观察集合的变化；返回退订函数（订阅时立即回调一次当前值）。 */
  onChange(listener: (sessionIds: readonly string[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.sessions())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    const ids = this.sessions()
    for (const listener of [...this.listeners]) listener(ids)
  }
}
