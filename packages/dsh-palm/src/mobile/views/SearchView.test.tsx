// @vitest-environment jsdom
/**
 * 搜索独立页（P6 ② 屏）的行为：输入过滤、空结果空态、点结果跳会话。
 * 数据源用注入的假函数，不碰 api.ts / mux.ts。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SearchView, type SearchHit, type SearchPage } from './SearchView.tsx'
import { formatFullTime } from '../shared/time.ts'

const hitA: SearchHit = {
  kind: 'message',
  sessionId: 's-1',
  title: '发布计划',
  snippet: '下周的发布计划先发灰度，再全量。',
  seq: 12,
  messageId: 'm-12',
  workspaceTitle: '手机端',
  updatedAt: 1_700_000_000_000,
}

const hitB: SearchHit = {
  kind: 'title',
  sessionId: 's-2',
  title: '发布日志',
  seq: 3,
}

const page = (items: readonly SearchHit[], partial = false): SearchPage => ({ items, partial })

/** 按关键词返回预置结果的检索替身。 */
function fakeSearch(table: Record<string, readonly SearchHit[]>): (term: string, signal?: AbortSignal) => Promise<SearchPage> {
  return async (term: string) => page(table[term.trim()] ?? [])
}

function type(value: string): void {
  fireEvent.change(screen.getByLabelText('搜索会话和消息'), { target: { value } })
}

afterEach(() => { cleanup() })

describe('搜索独立页（P6 ② 屏）', () => {
  it('进页面自动聚焦，并给出「输入即搜」的空态解释', () => {
    render(<SearchView search={fakeSearch({})} onBack={() => {}} onPick={() => {}} />)
    expect(document.activeElement).toBe(screen.getByLabelText('搜索会话和消息'))
    expect(screen.getByText('搜索会话和消息')).toBeDefined()
    expect(screen.getByText(/输入关键词/)).toBeDefined()
  })

  it('输入关键词只显示该词的命中（换词即换结果）', async () => {
    const search = vi.fn(fakeSearch({ 发布: [hitA, hitB], 日志: [hitB] }))
    render(<SearchView search={search} onBack={() => {}} onPick={() => {}} />)

    type('发布')
    await waitFor(() => expect(screen.getByText('发布计划')).toBeDefined())
    expect(screen.getByText('发布日志')).toBeDefined()
    expect(search).toHaveBeenLastCalledWith('发布', expect.anything())

    type('日志')
    await waitFor(() => {
      expect(screen.queryByText('发布计划')).toBeNull()
      expect(screen.getByText('发布日志')).toBeDefined()
    })
    expect(search).toHaveBeenLastCalledWith('日志', expect.anything())
  })

  it('没有命中时是空态（带搜索图标），不是一块空白', async () => {
    render(<SearchView search={fakeSearch({})} onBack={() => {}} onPick={() => {}} />)
    type('不存在')
    await waitFor(() => expect(screen.getByText('没有找到「不存在」')).toBeDefined())
    expect(screen.getByText(/换个关键词/)).toBeDefined()
    expect(document.querySelector('.empty-state-icon svg')).not.toBeNull()
  })

  it('点一条结果把命中和关键词交给调用方（跳会话）', async () => {
    const onPick = vi.fn()
    render(<SearchView search={fakeSearch({ 发布: [hitA] })} onBack={() => {}} onPick={onPick} />)
    type('发布')
    await waitFor(() => expect(screen.getByText('发布计划')).toBeDefined())
    screen.getByText('发布计划').closest('button')!.click()
    expect(onPick).toHaveBeenCalledTimes(1)
    const [picked, term] = onPick.mock.calls[0] as [SearchHit, string]
    expect(picked.sessionId).toBe('s-1')
    expect(picked.seq).toBe(12)
    expect(term).toBe('发布')
  })

  it('标题命中没有正文片段时不编造片段，只显示标题', async () => {
    render(<SearchView search={fakeSearch({ 日志: [hitB] })} onBack={() => {}} onPick={() => {}} />)
    type('日志')
    await waitFor(() => expect(screen.getByText('发布日志')).toBeDefined())
    expect(document.querySelectorAll('.palm-spec-row-sub')).toHaveLength(0)
    expect(screen.getByText(/标题命中/)).toBeDefined()
  })

  it('拿得到会话时间才显示时间', async () => {
    render(<SearchView search={fakeSearch({ 发布: [hitA] })} onBack={() => {}} onPick={() => {}} />)
    type('发布')
    await waitFor(() => expect(screen.getByText(formatFullTime(1_700_000_000_000))).toBeDefined())
    expect(document.querySelectorAll('.palm-spec-row-value')).toHaveLength(1)
  })

  it('返回按钮交给调用方（弹栈回会话列表）', () => {
    const onBack = vi.fn()
    render(<SearchView search={fakeSearch({})} onBack={onBack} onPick={() => {}} />)
    screen.getByRole('button', { name: '返回' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('检索失败时错误留住，点「重新搜索」能再来一次', async () => {
    let calls = 0
    const search = vi.fn(async (): Promise<SearchPage> => {
      calls += 1
      if (calls === 1) throw new Error('宿主暂时连不上')
      return page([hitA])
    })
    render(<SearchView search={search} onBack={() => {}} onPick={() => {}} />)
    type('发布')
    await waitFor(() => expect(screen.getByText('宿主暂时连不上')).toBeDefined())
    screen.getByRole('button', { name: '重新搜索' }).click()
    await waitFor(() => expect(screen.getByText('发布计划')).toBeDefined())
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('中文输入法组词期间不发请求，选完词才搜', async () => {
    const search = vi.fn(fakeSearch({ 发布: [hitA] }))
    render(<SearchView search={search} onBack={() => {}} onPick={() => {}} />)
    const input = screen.getByLabelText('搜索会话和消息')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'fabu' } })
    await new Promise(resolve => setTimeout(resolve, 260))
    expect(search).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input, { target: { value: '发布' } })
    await waitFor(() => expect(search).toHaveBeenCalledWith('发布', expect.anything()))
  })
})
