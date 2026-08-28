// @vitest-environment jsdom
/**
 * QuestionPanel selection stability: the weak-network poll (mobile.pending)
 * returns a freshly parsed questions array every tick, so a rerender with an
 * equal batch must keep the user's in-progress selections. Regression: the
 * reset effect keyed on the array reference wiped the selected option and the
 * typed custom answer ~2s after every tap/keystroke (1.5s fast poll + RTT).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuestionPanel } from './sheets.tsx'
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
