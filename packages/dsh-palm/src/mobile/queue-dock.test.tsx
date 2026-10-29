// @vitest-environment jsdom
/** QueueDock: queued-only rendering, plain-text-only editing, in-flight guard. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueueDock, type QueueDockProps } from './queue-dock.tsx'

function baseProps(overrides: Partial<QueueDockProps> = {}): QueueDockProps {
  return {
    items: [],
    running: true,
    onEdit: vi.fn(async () => {}),
    onRemove: vi.fn(async () => {}),
    onSteer: vi.fn(async () => {}),
    ...overrides,
  }
}

const queued = (id: string, text: string): QueueDockProps['items'][number] => ({
  id, placement: 'queued', text, editable: true,
})

describe('QueueDock', () => {
  beforeEach(() => { cleanup() })
  afterEach(() => { cleanup() })

  it('renders nothing for an empty queue', () => {
    const { container } = render(<QueueDock {...baseProps()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows every queued row without a tap, so the order is visible', () => {
    // 排了三条只显示「3 条排队」，用户不知道排了什么、顺序对不对，还要再点一次才看得见。
    render(<QueueDock {...baseProps({ items: [queued('q1', '第一条'), queued('q2', '第二条'), queued('q3', '第三条')] })} />)
    expect(screen.getByText('第一条')).toBeTruthy()
    expect(screen.getByText('第二条')).toBeTruthy()
    expect(screen.getByText('第三条')).toBeTruthy()
  })

  it('renders only queued rows (steering/context are not user-pending)', () => {
    const props = baseProps({
      items: [
        queued('q1', '第一条'),
        { id: 's1', placement: 'steering', text: '插话中', editable: true },
        { id: 'c1', placement: 'context', text: '注入上下文', editable: false },
      ],
    })
    render(<QueueDock {...props} />)
    expect(screen.getByText('第一条')).toBeTruthy()
    expect(screen.queryByText('插话中')).toBeNull()
    expect(screen.queryByText('注入上下文')).toBeNull()
  })

  it('disables edit for non-plain-text rows and keeps remove/steer enabled', () => {
    const props = baseProps({
      items: [
        { id: 'q1', placement: 'queued', text: '[image] 图片消息', editable: false },
      ],
    })
    render(<QueueDock {...props} />)
    const edit = screen.getByRole('button', { name: '编辑排队消息' }) as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    expect((screen.getByRole('button', { name: '删除排队消息' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '立即插入当前回合' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('steer is disabled while the agent is not running', () => {
    render(<QueueDock {...baseProps({ running: false, items: [queued('q1', '排队消息')] })} />)
    expect((screen.getByRole('button', { name: '立即插入当前回合' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists multiple rows up front and still lets the header collapse them', () => {
    // 默认展开：排了几条就该看见几条，否则要再点一次才知道排了什么、顺序对不对。
    render(<QueueDock {...baseProps({ items: [queued('q1', '一'), queued('q2', '二')] })} />)
    const head = screen.getByRole('button', { name: /2 条排队/ })
    expect(head).toBeTruthy()
    expect(screen.getByText('一')).toBeTruthy()
    expect(screen.getByText('二')).toBeTruthy()
    // 收起仍然可用（空间不够时用户能主动折起来）。
    fireEvent.click(head)
    expect(screen.queryByText('一')).toBeNull()
    fireEvent.click(head)
    expect(screen.getByText('一')).toBeTruthy()
  })

  it('edits inline and commits through onEdit', () => {
    const onEdit = vi.fn(async () => {})
    render(<QueueDock {...baseProps({ onEdit, items: [queued('q1', '原文')] })} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑排队消息' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '改后' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onEdit).toHaveBeenCalledWith('q1', '改后')
  })

  it('blocks an emptied edit instead of asking the host', () => {
    // 清空正文后保存：宿主会以 gateway/bad-request 拒绝，而手机把任何拒绝都说成
    // 「消息已开始发送」，用户会以为手慢了。空串在本地就拦住。
    const onEdit = vi.fn(async () => {})
    render(<QueueDock {...baseProps({ onEdit, items: [queued('q1', '原文')] })} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑排队消息' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('guards against a second mutation while one is in flight', async () => {
    let releaseRemove: (() => void) | undefined
    const onRemove = vi.fn((_id: string) => new Promise<void>((resolve) => {
      releaseRemove = () => resolve()
    }))
    render(<QueueDock {...baseProps({ onRemove, items: [queued('q1', '一条'), queued('q2', '两条')] })} />)
    // 两行默认已展开，不用再点表头。
    // Start removing q1 (the RPC is unresolved).
    fireEvent.click(screen.getAllByRole('button', { name: '删除排队消息' })[0]!)
    expect(onRemove).toHaveBeenCalledTimes(1)
    // While q1 is in flight every mutation button is disabled — a second tap
    // cannot even fire.
    const buttons = screen.getAllByRole('button', { name: '删除排队消息' }) as HTMLButtonElement[]
    expect(buttons.every(button => button.disabled)).toBe(true)
    // Release q1; the guard clears and q2 may now be removed.
    releaseRemove?.()
    await vi.waitFor(() => {
      fireEvent.click(screen.getAllByRole('button', { name: '删除排队消息' })[1]!)
      expect(onRemove).toHaveBeenCalledTimes(2)
    })
  })

  it('marks the tapped row in flight, so a slow round trip never looks ignored', async () => {
    // 真机：点「立即发送」后要等宿主回话，这段时间界面毫无变化，用户以为点空了。
    let release: (() => void) | undefined
    const onSteer = vi.fn((_id: string) => new Promise<void>((resolve) => { release = () => resolve() }))
    render(<QueueDock {...baseProps({ onSteer, items: [queued('q1', '排队消息')] })} />)
    fireEvent.click(screen.getByRole('button', { name: '立即插入当前回合' }))
    expect(screen.getByText('发送中…')).toBeTruthy()
    expect(screen.queryByText('立即发送')).toBeNull()
    release?.()
    await vi.waitFor(() => { expect(screen.getByText('立即发送')).toBeTruthy() })
  })
})
