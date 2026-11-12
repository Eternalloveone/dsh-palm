// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatVoice, type ChatVoice } from './use-chat-voice.ts'

vi.mock('../../../api.ts', () => ({ transcribeVoice: vi.fn() }))
vi.mock('../../../platform/voice-input.ts', () => ({ startVoiceRecording: vi.fn(), voiceSupported: () => true }))
vi.mock('../../../platform/voice-services.ts', () => ({ getVoiceServices: () => ({}) }))
vi.mock('../../../platform/live-captions.ts', () => ({
  createLiveCaptions: () => ({ offer: vi.fn(), stop: vi.fn() }),
}))
vi.mock('../../../components/toast.tsx', () => ({ toast: vi.fn() }))

import { transcribeVoice } from '../../../api.ts'
import { startVoiceRecording } from '../../../platform/voice-input.ts'
import { toast } from '../../../components/toast.tsx'

const startMock = vi.mocked(startVoiceRecording)
const transcribeMock = vi.mocked(transcribeVoice)
const toastMock = vi.mocked(toast)

let voice: ChatVoice | undefined

function Harness({ initial = '', sessionId = 's-1' }: { initial?: string; sessionId?: string }) {
  const [input, setInput] = useState(initial)
  const mountedRef = useRef(true)
  voice = useChatVoice({ mountedRef, setInput, sessionId })
  return <div data-testid="state">{`${voice.voiceOpen}|${voice.voicePhase}|${input}`}</div>
}

const recorder = (wav = 'WAV') => ({
  stop: vi.fn(async () => wav),
  cancel: vi.fn(),
  snapshot: vi.fn(async () => wav),
})

beforeEach(() => {
  voice = undefined
  vi.clearAllMocks()
  transcribeMock.mockResolvedValue('你好')
})

afterEach(() => {
  cleanup()
})

describe('useChatVoice', () => {
  it('opens the sheet on record and fills the composer with the transcript', async () => {
    const mic = recorder()
    startMock.mockResolvedValue(mic as never)
    const view = render(<Harness />)
    await act(async () => { voice?.openVoice() })
    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('true|recording|') })
    await act(async () => { voice?.finishVoice() })
    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('false|recording|你好') })
    expect(transcribeMock).toHaveBeenCalledTimes(1)
  })

  it('appends the transcript to an existing draft instead of replacing it', async () => {
    const mic = recorder()
    startMock.mockResolvedValue(mic as never)
    // 先有一段草稿：转写结果要接在后面（真机：说完话原来的字被吞了）。
    const view = render(<Harness initial="已有内容" />)
    await act(async () => { voice?.openVoice() })
    await act(async () => { voice?.finishVoice() })
    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('false|recording|已有内容 你好') })
  })

  it('drops a transcript that lands after the sheet was closed', async () => {
    const mic = recorder()
    startMock.mockResolvedValue(mic as never)
    let release: (text: string) => void = () => {}
    transcribeMock.mockImplementation(() => new Promise((resolve) => { release = resolve }) as never)
    const view = render(<Harness />)
    await act(async () => { voice?.openVoice() })
    await act(async () => { voice?.finishVoice() })
    await act(async () => { voice?.closeVoice() })
    await act(async () => { release('迟到的转写') })
    // 关掉面板之后回来的字绝不能往输入框里塞。
    expect(view.getByTestId('state').textContent).toBe('false|recording|')
  })

  it('releases the microphone when the sheet is closed mid-recording', async () => {
    const mic = recorder()
    startMock.mockResolvedValue(mic as never)
    const view = render(<Harness />)
    await act(async () => { voice?.openVoice() })
    await act(async () => { voice?.closeVoice() })
    expect(mic.cancel).toHaveBeenCalled()
    expect(view.getByTestId('state').textContent).toBe('false|recording|')
  })

  it('surfaces a microphone failure as a toast instead of a dead button', async () => {
    startMock.mockRejectedValue(new Error('麦克风不可用'))
    render(<Harness />)
    await act(async () => { voice?.openVoice() })
    await waitFor(() => { expect(toastMock).toHaveBeenCalledWith('麦克风不可用') })
    expect(voice?.voiceOpen).toBe(false)
  })

  /**
   * P4：聊天页实例跨会话复用之后，"换会话"不再是卸载 —— 麦克风的释放不能再靠
   * 卸载那条兜底，否则人已经切走了、浏览器的录音指示灯还亮着。
   */
  it('换会话：面板归零 + 释放麦克风，在飞的转写不写进新会话的草稿', async () => {
    const mic = recorder()
    startMock.mockResolvedValue(mic as never)
    let release: (text: string) => void = () => {}
    transcribeMock.mockImplementation(() => new Promise((resolve) => { release = resolve }) as never)
    const view = render(<Harness sessionId="s-1" />)
    await act(async () => { voice?.openVoice() })
    expect(view.getByTestId('state').textContent).toBe('true|recording|')

    view.rerender(<Harness sessionId="s-2" />)

    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('false|recording|') })
    expect(mic.cancel).toHaveBeenCalled()
    // 上一场在飞的转写回来时已经对不上代号：不许落进新会话的输入框。
    await act(async () => { release('上一场的转写') })
    expect(view.getByTestId('state').textContent).toBe('false|recording|')
  })
})
