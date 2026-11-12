// @vitest-environment jsdom
/**
 * 提交中的输入框：2026-11-10 实拍发现「正在配对」期间两个输入框仍可编辑，
 * 用户改完以为生效，实际提交的是点击那一刻的值。这里锁住"只读"。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PairRequiredView } from './PairRequiredView.tsx'

vi.mock('../platform/pairing.ts', async () => {
  const actual = await vi.importActual<typeof import('../platform/pairing.ts')>('../platform/pairing.ts')
  return { ...actual, acceptMobilePair: () => new Promise(() => undefined) }
})

describe('配对提交中不再让人白改', () => {
  it('提交期间两个输入框都是只读', async () => {
    const { container } = render(
      <PairRequiredView initialError={undefined} onPaired={() => undefined} navigate={() => undefined} />,
    )
    const link = container.querySelector('#mobile-pair-link') as HTMLInputElement
    const server = container.querySelector('#mobile-pair-server') as HTMLInputElement
    expect(link.readOnly, '提交前可编辑').toBe(false)

    fireEvent.change(link, { target: { value: 'abcdef123456' } })
    fireEvent.click(screen.getByRole('button', { name: /配对/ }))
    await waitFor(() => { expect(screen.getByRole('button').textContent).toContain('正在配对') })

    expect(link.readOnly, '提交中配对的链接只读').toBe(true)
    expect(server.readOnly, '提交中服务器地址只读').toBe(true)
  })
})
