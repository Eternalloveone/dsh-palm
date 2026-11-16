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
  /**
   * 连接 id → 这条 SSE 连接自述的会话（来自 `?session=`）。
   *
   * 为什么要单独一张表（2026-11-16 真机：「消息发出去了、状态显示运行中，但回复正文
   * 一直不出现」）：宿主有两个消费者读这张登记 —— ①`handleEvents` 的帧过滤（已改成
   * 优先用连接 URL 里的会话）；②`api-proxy-stream` 的助手流翻译（**仍只读登记表**）。
   * 两边依据不同源就会出现"你的消息到了、回复的逐字流没到"：过滤放行了 `user/message`，
   * 翻译器却因为没人登记而把 `assistant/chunk` 扔了。把连接自述的会话也登记进同一张表，
   * 两个消费者就重新同源。
   */
  private readonly byConnection = new Map<string, string>()
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

  /**
   * 登记一条 SSE 连接自述的会话（`?session=`）。
   *
   * 与 `observe` 一样进同一个全局集合，助手流翻译因此也认得它。
   *
   * @param connectionId - 这条连接的唯一 id
   * @param sessionId - 地址里带的会话
   */
  pin(connectionId: string, sessionId: string): void {
    if (connectionId === '' || sessionId === '') return
    if (this.byConnection.get(connectionId) === sessionId) return
    this.byConnection.set(connectionId, sessionId)
    this.notify()
  }

  /** 连接关闭时释放它的登记。 */
  unpin(connectionId: string): void {
    if (!this.byConnection.delete(connectionId)) return
    this.notify()
  }

  /** 当前被观察的会话（去重：设备登记 ∪ 连接自述）。 */
  sessions(): string[] {
    return [...new Set([...this.byDevice.values(), ...this.byConnection.values()])]
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
