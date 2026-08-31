/**
 * Voice recording for transcription (the Web Speech API path is gone — it
 * needs Google's speech service, which is unavailable on most devices in
 * this network). The recorder captures mono 16 kHz PCM through the WebAudio
 * API, encodes a container-less WAV in place (OpenAI `input_audio` format),
 * and hands the base64 payload to the caller; the host transcribes it
 * through the desktop-configured multimodal model.
 *
 * `voiceSupported()` gates the mic button: getUserMedia in a secure context.
 */

/** Target sample rate (matches the transcription backend's sweet spot). */
const SAMPLE_RATE = 16_000
/** Hard cap on one recording (the host refuses more than ~5 minutes). */
const MAX_DURATION_MS = 60_000

/** Whether the runtime can record audio for transcription. */
export function voiceSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return false
  if (typeof AudioContext !== 'function' && typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'function') return false
  // getUserMedia is secure-context-only; hide the entry point over HTTP.
  return window.isSecureContext === true
}

/** A live recording; stop() resolves with the WAV base64 payload. */
export interface VoiceRecording {
  stop(): Promise<string>
  cancel(): void
}

/** Options for {@link startVoiceRecording}. */
export interface VoiceRecordingOptions {
  /**
   * Abort the recording: while getUserMedia is still authorizing, an aborted
   * signal releases the stream the moment it resolves (the caller left the
   * page mid-prompt); after recording starts, an abort tears the recorder
   * down exactly like cancel(). The caller owns the controller and aborts it
   * on unmount so a pending authorization never leaks the mic.
   */
  signal?: AbortSignal
  /**
   * Called once when the hard duration cap is reached (the recorder has
   * already stopped capturing and released the mic). The caller uses it to
   * auto-finish the recording or surface a "录音已截止" state — without it the
   * sheet would keep showing "正在听..." past the cap.
   */
  onTimeout?: () => void
}

/** Encode interleaved 16-bit PCM as a container-less WAV, base64-wrapped. */
function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  const dataLength = pcm.length * 2
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)
  const bytes = new Uint8Array(44 + dataLength)
  bytes.set(new Uint8Array(header), 0)
  bytes.set(new Uint8Array(pcm.buffer), 44)
  // Chunked base64 (apply at 0x8000 to dodge the call-stack limit).
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Start recording; rejects with a user-readable message when unavailable. */
export async function startVoiceRecording(options?: VoiceRecordingOptions): Promise<VoiceRecording> {
  if (!voiceSupported()) {
    throw new Error('此浏览器不支持录音（需要 HTTPS 访问）')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
  } catch (error) {
    if (options?.signal?.aborted === true) throw new Error('录音已取消')
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError') throw new Error('麦克风权限被拒绝，请在浏览器设置中允许')
    if (name === 'NotFoundError') throw new Error('没有找到可用的麦克风')
    throw new Error('录音启动失败')
  }
  // The caller cancelled while the mic was still authorizing: release the
  // stream immediately instead of handing back a recorder nobody will stop.
  if (options?.signal?.aborted === true) {
    for (const track of stream.getTracks()) track.stop()
    throw new Error('录音已取消')
  }
  const AudioCtor = typeof AudioContext === 'function'
    ? AudioContext
    : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioCtor({ sampleRate: SAMPLE_RATE })
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let total = 0
  let stopped = false
  processor.onaudioprocess = (event) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    total += input.length
    // Hard cap ~ SAMPLE_RATE * seconds; past it, stop processing AND release
    // the mic — a held stream keeps the browser's recording indicator on
    // and the page warm until the user closes the sheet.
    if (total / SAMPLE_RATE * 1000 >= MAX_DURATION_MS) {
      stopped = true
      teardown()
      // Surface the cap so the caller can auto-finish (transcribe what was
      // captured) or show a "录音已截止" state instead of a stuck sheet.
      options?.onTimeout?.()
    }
  }
  source.connect(processor)
  // ScriptProcessor only runs while connected to a destination; route through
  // a zero-gain node so nothing echoes back out of the speaker.
  const sink = context.createGain()
  sink.gain.value = 0
  processor.connect(sink)
  sink.connect(context.destination)

  const teardown = (): void => {
    stopped = true
    try { processor.disconnect() } catch { /* already gone */ }
    try { source.disconnect() } catch { /* already gone */ }
    try { sink.disconnect() } catch { /* already gone */ }
    for (const track of stream.getTracks()) track.stop()
    void context.close().catch(() => { /* already closed */ })
  }

  // A caller-side abort after recording started tears the recorder down the
  // same way cancel() does (the mic is released, no further capture).
  if (options?.signal !== undefined) {
    options.signal.addEventListener('abort', teardown, { once: true })
  }

  return {
    stop(): Promise<string> {
      const merged = new Float32Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      const payload = encodeWavBase64(merged, context.sampleRate)
      teardown()
      if (merged.length / context.sampleRate < 0.4) {
        return Promise.reject(new Error('录音太短，请按住后说话至少 1 秒'))
      }
      return Promise.resolve(payload)
    },
    cancel(): void {
      teardown()
    },
  }
}
