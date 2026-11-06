// @vitest-environment jsdom
/**
 * 发送 / 队列 / 插话的行为契约（S8a）。
 *
 * 四条路径就是这块的全部对外语义：
 * ① 普通发送 → prompt(mode=queue)，清空草稿；
 * ② 回合在跑时发送 → 仍是 queue，但先画乐观排队项 + 留底稿 + 提示「已排队」；
 * ③ 插话（steer） → prompt(mode=steer)，不排队、不留底稿；
 * ④ 离线 → 只进 IndexedDB outbox，一个请求都不发。
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatComposer, type ChatComposer, type SendIntent } from './use-chat-composer.ts'

vi.mock('../../api.ts', () => ({
  prompt: vi.fn(() => Promise.resolve()),
  cancelSession: vi.fn(() => Promise.resolve()),
  inboxOf: vi.fn(() => Promise.resolve({})),
  logTail: vi.fn(() => Promise.resolve({ rows: [] })),
  newRequestId: vi.fn(() => 'req-1'),
}))
vi.mock('../../session-store.ts', () => ({
  addOptimisticQueueItem: vi.fn(() => 'local-1'),
  dropOptimisticQueueItem: vi.fn(),
}))
vi.mock('../../offline.ts', () => ({
  enqueuePrompt: vi.fn(() => Promise.resolve()),
  flushOutbox: vi.fn(() => Promise.resolve({ sent: 0, failed: 0 })),
  removeFromOutbox: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../queued-echo.ts', () => ({ rememberQueuedEcho: vi.fn() }))
vi.mock('../../toast.tsx', () => ({ toast: vi.fn() }))

import { prompt } from '../../api.ts'
import { addOptimisticQueueItem } from '../../session-store.ts'
import { enqueuePrompt } from '../../offline.ts'
import { rememberQueuedEcho } from '../../queued-echo.ts'
import { toast } from '../../toast.tsx'

const promptMock = vi.mocked(prompt)
const optimisticMock = vi.mocked(addOptimisticQueueItem)
const enqueueMock = vi.mocked(enqueuePrompt)
const echoMock = vi.mocked(rememberQueuedEcho)
const toastMock = vi.mocked(toast)

let composer: ChatComposer | undefined
let setInputExternal: ((next: string) => void) | undefined

function Harness(props: { offline?: boolean; running?: boolean; initialInput?: string }) {
  const [input, setInput] = useState(props.initialInput ?? '')
  const [sending, setSending] = useState(false)
  const runningRef = useRef(props.running === true)
  runningRef.current = props.running === true
  setInputExternal = setInput
  const handle = useChatComposer({
    sessionId: 's-1',
    mux: undefined,
    offline: props.offline === true,
    running: props.running === true,
    runningRef,
    input,
    setInput,
    attachImages: [],
    setAttachImages: () => {},
    attachFiles: [],
    setAttachFiles: () => {},
    uploadingFiles: 0,
    quoted: undefined,
    setQuoted: () => {},
    claimedCommand: undefined,
    setClaimedCommand: () => {},
    sending,
    setSending,
    commands: undefined,
    shadowEvent: () => {},
    refreshInbox: () => {},
    refreshGoal: () => {},
    runCommand: () => Promise.resolve(),
    removeDraft: () => {},
    setError: () => {},
    mountedRef: { current: true },
    refreshOutbox: () => {},
    focusComposer: () => {},
    clearEditMessage: () => {},
  })
  composer = handle
  return <div data-testid="draft">{input}</div>
}

beforeEach(() => {
  composer = undefined
  setInputExternal = undefined
  vi.clearAllMocks()
  promptMock.mockResolvedValue(undefined as never)
})
afterEach(() => { cleanup() })

describe('useChatComposer.send', () => {
  it('普通发送：prompt(mode=queue) + 清空草稿，不画排队项', async () => {
    const view = render(<Harness initialInput="你好" />)
    act(() => { composer?.send() })
    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1))
    const [sessionId, , requestId, mode] = promptMock.mock.calls[0] ?? []
    expect(sessionId).toBe('s-1')
    expect(requestId).toBe('req-1')
    expect(mode).toBe('queue')
    // 没在跑：不该有乐观排队项，也不该留底稿。
    expect(optimisticMock).not.toHaveBeenCalled()
    expect(echoMock).not.toHaveBeenCalled()
    await waitFor(() => expect(view.getByTestId('draft').textContent).toBe(''))
  })

  it('回合在跑时发送：仍是 queue，但先画乐观排队项 + 留底稿 + 提示已排队', async () => {
    render(<Harness initialInput="排队这条" running={true} />)
    act(() => { composer?.send() })
    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1))
    expect(promptMock.mock.calls[0]?.[3]).toBe('queue')
    // 弱网下"点了发送、排队条半天不出来"：请求发出前就要有乐观项。
    expect(optimisticMock).toHaveBeenCalledWith('s-1', expect.objectContaining({
      text: '排队这条',
      placement: 'queued',
      requestId: 'req-1',
    }))
    // 宿主重启会无声丢掉队列：本地留一份原文用于对账交还。
    expect(echoMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-1', text: '排队这条' }))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('已排队，本轮结束后自动发送'))
  })

  it('插话：prompt(mode=steer)，不排队、不留底稿', async () => {
    render(<Harness initialInput="插一句" running={true} />)
    act(() => { composer?.send('steer' satisfies SendIntent) })
    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1))
    expect(promptMock.mock.calls[0]?.[3]).toBe('steer')
    expect(optimisticMock).not.toHaveBeenCalled()
    expect(echoMock).not.toHaveBeenCalled()
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('已插入当前回合'))
  })

  it('离线：只进 outbox，不发任何请求', async () => {
    render(<Harness initialInput="离线这句" offline={true} />)
    act(() => { composer?.send() })
    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1))
    expect(enqueueMock.mock.calls[0]?.[0]).toMatchObject({ sessionId: 's-1', text: '离线这句' })
    expect(promptMock).not.toHaveBeenCalled()
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('已离线保存，恢复网络后自动发送'))
  })
})
