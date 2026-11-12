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
    onWithdraw: vi.fn(async () => {}),
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

  it('撤回 在动作表里（撤回把原文放回输入框，删除是丢弃）', () => {
    const onWithdraw = vi.fn(async () => {})
    render(<QueueDock {...baseProps({ items: [queued('q-1', '改一下这句')], onWithdraw })} />)
    // 方案 A：一行只留正文 + ×，其余动作收进这张卡的动作表。
    fireEvent.click(screen.getByRole('button', { name: '排队消息：改一下这句' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /撤回并放回输入框/ }))
    expect(onWithdraw).toHaveBeenCalledWith('q-1')
  })

  it('超过 1 条默认收起，点「N 条排队」才摊开（2026-11-10 用户：面板太高）', () => {
    render(<QueueDock {...baseProps({ items: [queued('q1', '第一条'), queued('q2', '第二条'), queued('q3', '第三条')] })} />)
    // 默认只留头行：一行正文都不占。
    expect(screen.queryByText('第一条')).toBeNull()
    const toggle = screen.getByRole('button', { name: '3 条排队，展开列表' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByText('第一条')).toBeTruthy()
    expect(screen.getByText('第二条')).toBeTruthy()
    expect(screen.getByText('第三条')).toBeTruthy()
    // 再点一次收回去，开关状态跟着翻。
    fireEvent.click(screen.getByRole('button', { name: '3 条排队，收起列表' }))
    expect(screen.queryByText('第一条')).toBeNull()
  })

  it('steering 项不在这里画：它归 InsertBar（默认折叠成一条摘要，避免两行）', () => {
    render(<QueueDock {...baseProps({
      items: [
        queued('q1', '第一条'),
        { id: 's1', placement: 'steering', text: '插话中', editable: true },
        { id: 'c1', placement: 'context', text: '注入上下文', editable: false },
      ],
    })} />)
    expect(screen.getByText('第一条')).toBeTruthy()
    expect(screen.queryByText(/插话中/)).toBeNull()
    expect(screen.queryByText('已插入本轮')).toBeNull()
    // context（宿主的上下文注入）仍然不画
    expect(screen.queryByText('注入上下文')).toBeNull()
  })

  it('只有 steering 项时排队条不出现（插入条会挂载自己的槽位）', () => {
    const { container } = render(<QueueDock {...baseProps({ items: [{ id: 's1', placement: 'steering', text: '插话中', editable: true }] })} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(/插话中/)).toBeNull()
  })

  it('非纯文本只能删/插队，编辑在动作表里是灰的', () => {
    const props = baseProps({
      items: [
        { id: 'q1', placement: 'queued', text: '[image] 图片消息', editable: false },
      ],
    })
    render(<QueueDock {...props} />)
    expect((screen.getByRole('button', { name: '删除排队消息' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '立即插入当前回合' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '这条消息的更多操作' }))
    expect((screen.getByRole('menuitem', { name: '编辑' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('steer is disabled while the agent is not running', () => {
    render(<QueueDock {...baseProps({ running: false, items: [queued('q1', '排队消息')] })} />)
    expect((screen.getByRole('button', { name: '立即插入当前回合' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('头行常显计数与说明；只有 1 条时不折叠（不必多点一次）', () => {
    render(<QueueDock {...baseProps({ items: [queued('q1', '唯一的')] })} />)
    expect(screen.getByText('1 条排队')).toBeTruthy()
    expect(screen.getByText('当前任务结束后执行')).toBeTruthy()
    expect(screen.getByText('唯一的')).toBeTruthy()
  })

  it('edits inline and commits through onEdit', () => {
    const onEdit = vi.fn(async () => {})
    render(<QueueDock {...baseProps({ onEdit, items: [queued('q1', '原文')] })} />)
    fireEvent.click(screen.getByRole('button', { name: '排队消息：原文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
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
    fireEvent.click(screen.getByRole('button', { name: '排队消息：原文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
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
    // 两条默认收起，先摊开才点得到行内的删除。
    fireEvent.click(screen.getByRole('button', { name: '2 条排队，展开列表' }))
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

/**
 * 2026-11-10 真机：「动作表打开后，过一会儿它自己关了」。
 * 根因：浮层只存了 id，然后在**当帧队列**里 `find`；队列每几秒被刷新一次，
 * 宿主接管乐观项时 id 从 `local-…` 换成宿主 id，`find` 落空 ⇒ 整块不渲染。
 * 现在浮层记的是「打开那一刻的快照」，队列怎么变都不影响它。
 */
describe('QueueDock 动作表不会自己消失', () => {
  beforeEach(() => { cleanup() })
  afterEach(() => { cleanup() })

  it('宿主接管后 id 变了：浮层还在，操作落到新 id', () => {
    const onRemove = vi.fn(async () => {})
    const { rerender } = render(<QueueDock {...baseProps({ items: [queued('local-1', '改一下这句')], onRemove })} />)
    fireEvent.click(screen.getByRole('button', { name: '排队消息：改一下这句' }))
    expect(screen.getByRole('menu', { name: '排队消息操作' })).toBeTruthy()

    // 队列刷新：乐观项被宿主接管，id 换掉、正文不变。
    rerender(<QueueDock {...baseProps({ items: [queued('host-9', '改一下这句')], onRemove })} />)
    expect(screen.getByRole('menu', { name: '排队消息操作' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /删除/ }))
    expect(onRemove).toHaveBeenCalledWith('host-9')
  })

  it('这一轮把最后一条取走了：浮层留在原地，选项禁用并说明原因', () => {
    const { rerender } = render(<QueueDock {...baseProps({ items: [queued('q1', '改一下这句')] })} />)
    fireEvent.click(screen.getByRole('button', { name: '排队消息：改一下这句' }))
    rerender(<QueueDock {...baseProps({ items: [] })} />)

    expect(screen.getByRole('menu', { name: '排队消息操作' })).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    for (const name of [/编辑/, /撤回并放回输入框/, /立即发送/, /删除/]) {
      const item = screen.getByRole('menuitem', { name }) as HTMLButtonElement
      expect(item.disabled, name.source).toBe(true)
    }
  })
})
