// @vitest-environment jsdom
/**
 * QuestionPanel selection stability: the weak-network poll (mobile.pending)
 * returns a freshly parsed questions array every tick, so a rerender with an
 * equal batch must keep the user's in-progress selections. Regression: the
 * reset effect keyed on the array reference wiped the selected option and the
 * typed custom answer ~2s after every tap/keystroke (1.5s fast poll + RTT).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QuestionPanel } from './sheets.tsx'
import { respondQuestion } from './api.ts'
import type { PendingQuestionItem } from './api.ts'

vi.mock('./api.ts', () => ({
  respondQuestion: vi.fn(),
  respondApproval: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
}))
// Keep the pure helpers (errorText / staleHostHint) real.
vi.mock('./views/App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./views/App.tsx')>()
  return { ...actual }
})

const questions: PendingQuestionItem[] = [
  {
    rpcId: 'r-1',
    id: 'q-1',
    question: '继续执行吗？',
    options: [{ label: '继续' }, { label: '停止' }],
  },
]

/** The poll's fresh JSON parse: same content, brand-new object graph. */
function freshParse(): PendingQuestionItem[] {
  return questions.map(q => ({ ...q, options: q.options?.map(o => ({ ...o })) }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('QuestionPanel selection stability', () => {
  it('keeps the selected option when the same batch arrives as a fresh array', () => {
    const { rerender } = render(
      <QuestionPanel questions={questions} sessionId="s-1" onResolved={() => {}} />,
    )
    fireEvent.click(screen.getByRole('radio', { name: '继续' }))
    expect((screen.getByRole('radio', { name: '继续' }) as HTMLInputElement).checked).toBe(true)

    rerender(<QuestionPanel questions={freshParse()} sessionId="s-1" onResolved={() => {}} />)

    expect((screen.getByRole('radio', { name: '继续' }) as HTMLInputElement).checked).toBe(true)
  })

  it('keeps the typed custom answer across poll ticks', () => {
    const { rerender } = render(
      <QuestionPanel questions={questions} sessionId="s-1" onResolved={() => {}} />,
    )
    const textarea = screen.getByPlaceholderText('自定义回答（可选）') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '先查日志再继续' } })

    rerender(<QuestionPanel questions={freshParse()} sessionId="s-1" onResolved={() => {}} />)

    expect((screen.getByPlaceholderText('自定义回答（可选）') as HTMLTextAreaElement).value)
      .toBe('先查日志再继续')
  })

  it('resets selections when a genuinely new batch arrives (new rpcId)', () => {
    const { rerender } = render(
      <QuestionPanel questions={questions} sessionId="s-1" onResolved={() => {}} />,
    )
    fireEvent.click(screen.getByRole('radio', { name: '继续' }))

    const nextBatch: PendingQuestionItem[] = [
      { rpcId: 'r-2', id: 'q-2', question: '换一批？', options: [{ label: '是' }, { label: '否' }] },
    ]
    rerender(<QuestionPanel questions={nextBatch} sessionId="s-1" onResolved={() => {}} />)

    expect((screen.getByRole('radio', { name: '是' }) as HTMLInputElement).checked).toBe(false)
  })
})

/**
 * Regression: a stale batch left in the poll result (its question/resolved
 * frame was missed while the page was hidden) used to render as a second,
 * identical-looking question group under the same single submit button — which
 * only echoed the first batch's rpcId, so the other batch stayed pending and
 * the panel came straight back.
 */
describe('QuestionPanel batch identity', () => {
  const staleAndLive: PendingQuestionItem[] = [
    { rpcId: 'r-old', id: 'q-old', question: '旧的一批？', options: [{ label: '旧的' }] },
    { rpcId: 'r-new', id: 'q-new', question: '新的一批？', options: [{ label: '新的' }] },
  ]

  it('renders only the newest batch when a stale one is still in the array', () => {
    render(<QuestionPanel questions={staleAndLive} sessionId="s-1" onResolved={() => {}} />)

    expect(screen.getByText('新的一批？')).toBeTruthy()
    expect(screen.queryByText('旧的一批？')).toBeNull()
    expect(screen.queryByRole('radio', { name: '旧的' })).toBeNull()
  })

  it('answers the batch it is actually showing', async () => {
    const onResolved = vi.fn()
    vi.mocked(respondQuestion).mockResolvedValue(undefined)

    render(<QuestionPanel questions={staleAndLive} sessionId="s-1" onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('radio', { name: '新的' }))
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))

    await waitFor(() => { expect(onResolved).toHaveBeenCalledWith('r-new') })
    expect(vi.mocked(respondQuestion)).toHaveBeenCalledWith('r-new', 's-1', {
      answers: [{ id: 'q-new', selected: ['新的'] }],
    })
  })

  it('keeps every question of one ask in the same panel', () => {
    const oneAsk: PendingQuestionItem[] = [
      { rpcId: 'r-1', id: 'q-a', question: '第一个问题？', options: [{ label: 'A' }] },
      { rpcId: 'r-1', id: 'q-b', question: '第二个问题？', options: [{ label: 'B' }] },
    ]
    render(<QuestionPanel questions={oneAsk} sessionId="s-1" onResolved={() => {}} />)

    expect(screen.getByText('第一个问题？')).toBeTruthy()
    expect(screen.getByText('第二个问题？')).toBeTruthy()
  })
})
