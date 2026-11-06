/**
 * 语音输入（录音面板 + 实时字幕 + 转写回填）。
 *
 * 从 `ChatView` 搬出来的（S4b）。唯一的外部耦合是两件事：
 * - 录音结果是**往输入框里补字**（`setInput`），所以草稿状态仍归调用方；
 * - 卸载守卫 `mountedRef` 是调用方的（发送失败核实也在用），这里只负责在卸载时
 *   置假并释放麦克风。
 *
 * 行为与原实现逐行一致，包括几个真机坑（都别"优化"掉）：
 * - 60 秒上限由录音器触发 `onTimeout` → 自动收尾，不然面板会一直停在"正在听…"；
 * - 关面板要**换代号**（`voiceRunRef`），迟到的转写结果按代号丢弃，否则关掉之后
 *   还会往输入框里塞字；
 * - 卸载必须 `cancel()` 麦克风，否则浏览器的录音指示一直亮着。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { transcribeVoice } from '../../api.ts'
import { createLiveCaptions, type LiveCaptions } from '../../live-captions.ts'
import { toast } from '../../toast.tsx'
import { startVoiceRecording, type VoiceRecording } from '../../voice-input.ts'
import { voiceStatusText, type VoiceStatus } from '../../voice-status.ts'
import { getVoiceServices } from '../../voice-services.ts'

export interface ChatVoice {
  /** 录音面板是否打开。 */
  voiceOpen: boolean
  /** 实时字幕 / 转写中的占位文字。 */
  voicePartial: string
  voicePhase: 'recording' | 'transcribing'
  /** 已录秒数（面板上的秒表）。 */
  voiceElapsed: number
  /** 面板上的状态行（文案 + 警示色/实时态，由 phase/partial/elapsed 合成）。 */
  voiceStatus: VoiceStatus
  /** 波形元素：响度直接写进它的 CSS 变量，免得每 85ms 触发一次整页重渲染。 */
  voiceWaveRef: MutableRefObject<HTMLDivElement | null>
  /** 「完成」按钮：面板打开把焦点送进来，关掉还回原处。 */
  voiceDoneRef: MutableRefObject<HTMLButtonElement | null>
  openVoice: () => void
  finishVoice: () => void
  closeVoice: () => void
}

export function useChatVoice(options: {
  /** 卸载守卫（归调用方所有，这里在卸载时置假）。 */
  mountedRef: MutableRefObject<boolean>
  /** 转写结果往输入框里补字。 */
  setInput: Dispatch<SetStateAction<string>>
}): ChatVoice {
  const { mountedRef, setInput } = options
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voicePartial, setVoicePartial] = useState('')
  const [voicePhase, setVoicePhase] = useState<'recording' | 'transcribing'>('recording')
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const voiceRef = useRef<VoiceRecording | undefined>(undefined)
  const voiceWaveRef = useRef<HTMLDivElement | null>(null)
  const voiceDoneRef = useRef<HTMLButtonElement | null>(null)
  const voiceReturnFocusRef = useRef<HTMLElement | null>(null)
  /** 每次打开/关闭都换一个代号：面板关掉之后回来的转写结果按代号丢弃。 */
  const voiceRunRef = useRef(0)
  const voicePartialRef = useRef('')
  /** 实时字幕机与它的取样定时器（录音中才存在）。 */
  const voiceCaptionsRef = useRef<LiveCaptions | undefined>(undefined)
  const voiceCaptionTimerRef = useRef<number | undefined>(undefined)

  const voiceStatus = voiceStatusText(voicePhase, voicePartial, voiceElapsed)

  /** 收掉实时字幕：停掉取样定时器，并丢弃在飞的结果。 */
  const stopCaptions = useCallback((): void => {
    voiceCaptionsRef.current?.stop()
    voiceCaptionsRef.current = undefined
    if (voiceCaptionTimerRef.current !== undefined) {
      window.clearInterval(voiceCaptionTimerRef.current)
      voiceCaptionTimerRef.current = undefined
    }
  }, [])

  // Release the mic when the chat unmounts (session switch / back): a pending
  // getUserMedia authorization or a live recorder must never leak the
  // MediaStream (the browser's recording indicator would stay on). The
  // mountedRef guard also stops the async openVoice callback from setting
  // state on an unmounted component.
  useEffect(() => () => {
    mountedRef.current = false
    stopCaptions()
    voiceRef.current?.cancel()
    voiceRef.current = undefined
  }, [stopCaptions])

  // 录音面板上的秒表：只在真的在录的时候走，转写中停住。
  useEffect(() => {
    if (!voiceOpen || voicePhase !== 'recording') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      setVoiceElapsed(Math.min(60, Math.floor((Date.now() - started) / 1000)))
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [voiceOpen, voicePhase])

  /**
   * 面板的焦点管理：打开时记住是谁打开的（语音按钮），关上还给它。
   * 不做这件事的话，面板一关焦点落回 body，接着按空格会滚动页面而不是再按一次语音。
   */
  useEffect(() => {
    if (!voiceOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    voiceReturnFocusRef.current = previous
    voiceDoneRef.current?.focus()
    return () => {
      const target = voiceReturnFocusRef.current
      voiceReturnFocusRef.current = null
      if (target !== null && target.isConnected) target.focus()
    }
  }, [voiceOpen])

  /** Discard the current recording and close the sheet. */
  const closeVoice = useCallback((): void => {
    // 换代号：正在跑的转写回来时对不上号，就不再往输入框里塞字。
    voiceRunRef.current += 1
    stopCaptions()
    voiceRef.current?.cancel()
    voiceRef.current = undefined
    setVoiceElapsed(0)
    voicePartialRef.current = ''
    setVoicePartial('')
    setVoiceOpen(false)
    setVoicePhase('recording')
  }, [])

  /** Finish recording → upload the WAV → transcribe → fill the composer. */
  const finishVoice = useCallback((): void => {
    const recorder = voiceRef.current
    if (recorder === undefined) {
      setVoiceOpen(false)
      return
    }
    voiceRef.current = undefined
    // 松手之后由最终转写说话，字幕立刻收掉（否则迟到的字幕会让面板闪一下）。
    stopCaptions()
    const run = voiceRunRef.current
    setVoicePhase('transcribing')
    setVoiceElapsed(0)
    void recorder.stop().then(
      (wavBase64) => {
        voicePartialRef.current = '转写中...'
        setVoicePartial('转写中...')
        void transcribeVoice(wavBase64, getVoiceServices()).then(
          (text) => {
            // 用户已经关掉面板（取消了这次录音）：结果直接丢弃。
            if (run !== voiceRunRef.current) return
            voicePartialRef.current = ''
            setVoicePartial('')
            setVoiceOpen(false)
            setVoicePhase('recording')
            if (text.trim() !== '') {
              setInput(previous => (previous.trim() === '' ? text.trim() : `${previous.replace(/\s+$/, '')} ${text.trim()}`))
            }
          },
          (reason: unknown) => {
            setVoiceOpen(false)
            setVoicePhase('recording')
            toast(reason instanceof Error ? reason.message : String(reason))
          },
        )
      },
      (message: unknown) => {
        setVoiceOpen(false)
        setVoicePhase('recording')
        toast(message instanceof Error ? message.message : String(message))
      },
    )
  }, [])

  /** Open the recording sheet and start capturing audio. */
  const openVoice = useCallback((): void => {
    voicePartialRef.current = ''
    voiceRunRef.current += 1
    setVoiceElapsed(0)
    setVoicePhase('recording')
    void startVoiceRecording({
      // The 60 s hard cap is reached: auto-finish so the sheet transcribes
      // what was captured instead of sitting on "正在听..." forever.
      onTimeout: () => { finishVoice() },
      // 波形跟着真实响度起伏：麦克风被静音、戴耳机、被别的应用抢占时，用户能自己看出来。
      onLevel: (level) => { voiceWaveRef.current?.style.setProperty('--voice-level', String(level)) },
    }).then(
      (recorder) => {
        // The chat unmounted while the mic was still authorizing: release
        // the stream instead of opening a sheet on a dead component.
        if (!mountedRef.current) {
          recorder.cancel()
          return
        }
        voiceRef.current = recorder
        setVoiceOpen(true)
        // 实时字幕：边录边把已录到的音频送去转写。宿主没有流式 ASR，这里是
        // 「滚动整段重转」——节流与并发由 live-captions 把关，失败静默。
        const captions = createLiveCaptions({
          transcribe: (audio) => transcribeVoice(audio, getVoiceServices()),
          onText: (text) => {
            voicePartialRef.current = text
            setVoicePartial(text)
          },
        })
        voiceCaptionsRef.current = captions
        // 每 700ms 看一次：真正发不发由字幕机按 2s 节奏与在飞状态决定。
        voiceCaptionTimerRef.current = window.setInterval(() => {
          // 传函数而不是值：被节流挡下的那一半就不用编码整段 WAV。
          captions.offer(() => voiceRef.current?.snapshot())
        }, 700)
      },
      (message: unknown) => {
        if (mountedRef.current) toast(message instanceof Error ? message.message : String(message))
      },
    )
  }, [finishVoice])

  return {
    voiceOpen,
    voicePartial,
    voicePhase,
    voiceElapsed,
    voiceStatus,
    voiceWaveRef,
    voiceDoneRef,
    openVoice,
    finishVoice,
    closeVoice,
  }
}
