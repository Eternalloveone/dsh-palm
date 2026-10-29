/**
 * 录音时的「实时字幕」：一边说，一边把已经录到的音频送去转写，把结果当预览显示。
 *
 * 这条链路上没有真正的流式 ASR —— 宿主只提供 `mobile.transcribe`（整段音频进、
 * 文本出），所以字幕是用「滚动整段重转」模拟出来的：每 2 秒把到目前为止的音频重新
 * 转一次，后一次的结果覆盖前一次。它有四个必须守住的口径：
 *
 * ① **同一时刻只有一个请求在飞**。慢网下堆积请求没有意义（后一个必然包含前一个的
 *   音频），只会让界面显示越来越旧的结果；也正因为不重叠，结果到达顺序天然单调，
 *   不需要再额外排序。
 * ② **按节奏发**。两次请求至少隔 2 秒，否则慢转写会把手机带宽和转写额度全吃掉。
 * ③ **停止后不再回写**。用户松手后走的是最终转写，字幕再跳一下就是闪烁。
 * ④ **失败静默**。字幕只是预览，服务不可用/额度用完时不应弹错，最终转写会给出
 *   真实结果（那也是真正决定输入框内容的那一次）。
 *
 * 音频从 {@link VoiceRecording.snapshot} 取（同一段录音的最新 WAV），这里不碰麦克风，
 * 因此可以纯粹按「逻辑 + 注入的转写函数」测试。
 *
 * @module dsh-palm/mobile/live-captions
 */

/** 两次字幕请求之间的最小间隔。 */
export const LIVE_CAPTION_INTERVAL_MS = 2_000

/** 音频短于这个长度就别送了：转出来只有一个字，白花一次请求。 */
export interface LiveCaptionOptions {
  /** 把一段 base64 WAV 转成文字（生产环境是 mobile.transcribe）。 */
  transcribe(audio: string): Promise<string>
  /** 收到新字幕（已被序号校验过滤）。 */
  onText(text: string): void
  /** 时间源（测试注入）。 */
  now?(): number
}

/** 字幕机：`offer()` 喂音频，`stop()` 收工。 */
export interface LiveCaptions {
  /**
   * 尝试用这段音频刷新字幕（内部按节奏与并发自行取舍）。
   *
   * 参数可以是音频本身，也可以是**取音频的函数**：录音每喂一片都要合并分片并编码
   * 成近 2 MB 的 WAV base64，而界面 700 ms 喂一次、真正允许发送的是 2 秒一次。
   * 传函数时只在真的要用时才调用，被节流/并发挡下的那一半不会白编一遍。
   */
  offer(audio: string | undefined | (() => string | undefined)): void
  /** 停止：之后到达的结果一律丢弃。 */
  stop(): void
}

export function createLiveCaptions(options: LiveCaptionOptions): LiveCaptions {
  const now = options.now ?? (() => Date.now())
  let lastAt = -Infinity
  let inFlight = false
  let stopped = false

  return {
    offer(source: string | undefined | (() => string | undefined)): void {
      if (stopped) return
      if (inFlight) return
      const at = now()
      if (at - lastAt < LIVE_CAPTION_INTERVAL_MS) return
      // 先过完节流与并发这两关，再取音频：取一次要合并分片并编码整段 WAV。
      const audio = typeof source === 'function' ? source() : source
      if (audio === undefined || audio === '') return
      lastAt = at
      inFlight = true
      void options.transcribe(audio).then(
        (text) => {
          inFlight = false
          if (stopped) return
          const trimmed = text.trim()
          if (trimmed === '') return
          options.onText(trimmed)
        },
        () => {
          inFlight = false
          // 失败静默：最终转写仍然会给出真实结果。
        },
      )
    },
    stop(): void {
      stopped = true
    },
  }
}
