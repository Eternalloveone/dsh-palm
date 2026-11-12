/**
 * host-bridge：全站**唯一的 mux 订阅点**（P3）。
 *
 * 背景：以前 App / ChatView / SessionListView / RunOverviewView 各自 `new MuxClient(...)`
 * 并各自挂 `onFrame`，于是同一帧被解析多次、断线重连时各视图的重置时机还不一致
 * （"队列说还有一条、回合说已经开始了"这类矛盾就是这么来的）。
 *
 * 现在只保留一条链路：`MuxClient` → 本 bridge → 各**模型切片**（kernels/*），
 * 视图只订阅切片，不再直接摸 mux。好处：
 * - 一帧只派发一次，顺序稳定；
 * - 断线重连（新 generation）只需 bridge 通知一次，所有切片同步重置；
 * - 视图层可以完全脱离网络细节（P3 的"视图层去取数"）。
 *
 * @module dsh-palm/mobile/kernels/host-bridge
 */

/** mux 帧的最小形状（结构类型，避免测试里造完整 MuxFrame）。 */
export interface HostFrameLike {
  type: string
}

/** 一个可订阅的帧源（真实实现是 `MuxClient`）。 */
export interface HostFrameSource<Frame extends HostFrameLike = HostFrameLike> {
  start: () => void
  stop: () => void
  onFrame: (listener: (frame: Frame, rpcId?: string) => void) => () => void
}

/** 帧监听器。 */
export type HostFrameListener<Frame extends HostFrameLike = HostFrameLike> = (frame: Frame, rpcId?: string) => void

/** host-bridge 的对外面。 */
export interface HostBridge<Frame extends HostFrameLike = HostFrameLike> {
  /** 启动底层帧源（幂等）。 */
  start: () => void
  /** 停掉底层帧源并清空所有监听（幂等）。 */
  stop: () => void
  /** 订阅全部帧。 */
  onFrame: (listener: HostFrameListener<Frame>) => () => void
  /** 只订阅指定 type 的帧。 */
  onType: (type: string, listener: HostFrameListener<Frame>) => () => void
  /** 重连代数：每次底层源重新开始就 +1，切片据此整体重置。 */
  generation: () => number
  /** 当前监听者数量（诊断/测试用）。 */
  listenerCount: () => number
}

/**
 * 建一个 host-bridge。
 *
 * `source` 只被 `start()` 一次；重复调用是空操作，所以多个入口（App 挂载、
 * 测试）可以安全地各自 start。
 */
export function createHostBridge<Frame extends HostFrameLike>(
  source: HostFrameSource<Frame>,
  onGenerationChange?: (generation: number) => void,
): HostBridge<Frame> {
  const listeners = new Set<HostFrameListener<Frame>>()
  let detach: (() => void) | undefined
  let generation = 0

  const dispatch = (frame: Frame, rpcId?: string): void => {
    // 复制一份再派发：监听者可能在自己的回调里退订，直接遍历会跳过下一个。
    for (const listener of [...listeners]) {
      try {
        listener(frame, rpcId)
      } catch (error) {
        // 一个切片炸掉不能拖垮其它切片（尤其是聊天流）。
        console.error('host-bridge listener failed', error)
      }
    }
  }

  const start = (): void => {
    if (detach !== undefined) return
    detach = source.onFrame(dispatch)
    source.start()
    generation += 1
    onGenerationChange?.(generation)
  }

  const stop = (): void => {
    if (detach === undefined) return
    detach()
    detach = undefined
    source.stop()
    listeners.clear()
  }

  const onFrame = (listener: HostFrameListener<Frame>): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const onType = (type: string, listener: HostFrameListener<Frame>): (() => void) =>
    onFrame((frame, rpcId) => { if (frame.type === type) listener(frame, rpcId) })

  return {
    start,
    stop,
    onFrame,
    onType,
    generation: () => generation,
    listenerCount: () => listeners.size,
  }
}
