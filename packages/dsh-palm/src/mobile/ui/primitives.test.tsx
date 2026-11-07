// @vitest-environment jsdom
/**
 * 原语（W1-5）的语义与无障碍契约。
 *
 * 这些断言不测样式，只测「不该忘的东西」：
 * 按钮不会误提交、图标按钮一定有名字、输入项一定和 label/说明/错误关联、
 * 可点区域一定能用键盘触发、状态点不是只有颜色。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, Field, IconButton, ListRow, Skeleton, StatusDot,
} from './primitives.tsx'

afterEach(() => { cleanup() })

describe('Button / IconButton', () => {
  it('默认 type=button，显式 submit 时保留', () => {
    const { container } = render(
      <>
        <Button>普通</Button>
        <Button type="submit">提交</Button>
      </>,
    )
    const [plain, submit] = Array.from(container.querySelectorAll('button'))
    expect(plain?.getAttribute('type')).toBe('button')
    expect(submit?.getAttribute('type')).toBe('submit')
  })

  it('图标按钮自带无障碍名称', () => {
    render(<IconButton label="关闭"><svg /></IconButton>)
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy()
  })
})

describe('Field', () => {
  it('label、说明、错误与输入框自动关联', () => {
    const { container } = render(
      <Field label="工作区名" hint="最多 40 字" error="不能为空" defaultValue="" />,
    )
    const input = container.querySelector('input') as HTMLInputElement
    const label = container.querySelector('label') as HTMLLabelElement
    expect(label.htmlFor).toBe(input.id)
    expect(input.id).not.toBe('')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    expect(describedBy).toHaveLength(2)
    for (const id of describedBy) expect(container.querySelector('#' + id)).toBeTruthy()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('不能为空')
  })

  it('两个输入项的 id 不会撞', () => {
    const { container } = render(
      <>
        <Field label="A" />
        <Field label="B" />
      </>,
    )
    const [a, b] = Array.from(container.querySelectorAll('input'))
    expect(a?.id).toBeTruthy()
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('Chip / Badge / StatusDot / Skeleton', () => {
  it('选中状态用 aria-pressed 表达', () => {
    render(<><Chip selected>已选</Chip><Chip>未选</Chip></>)
    expect(screen.getByRole('button', { name: '已选' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '未选' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('标签带色调属性', () => {
    const { container } = render(<Badge tone="danger">失败</Badge>)
    expect(container.querySelector('[data-badge]')?.getAttribute('data-tone')).toBe('danger')
  })

  it('状态点不是只有颜色：有 role 与文本', () => {
    render(<StatusDot status="running" label="正在运行" />)
    expect(screen.getByRole('img', { name: '正在运行' }).getAttribute('data-status')).toBe('running')
  })

  it('骨架对读屏隐藏', () => {
    const { container } = render(<Skeleton lines={3} />)
    expect(container.querySelector('[data-skeleton]')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ListRow / Card', () => {
  it('可点行是键盘可达的按钮', () => {
    const onClick = vi.fn()
    render(<ListRow onClick={onClick}>会话一</ListRow>)
    const row = screen.getByRole('button', { name: '会话一' })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(row, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('不可点的卡片保持容器语义', () => {
    const { container } = render(<Card>只是容器</Card>)
    expect(container.querySelector('[role="button"]')).toBeNull()
  })
})

describe('EmptyState / ErrorState', () => {
  it('空态不播报，错误态播报', () => {
    const { container } = render(
      <>
        <EmptyState title="还没有会话" description="新建一个开始" />
        <ErrorState title="加载失败" reason="网络不可用" />
      </>,
    )
    expect(container.querySelector('[data-empty-state]')?.getAttribute('role')).toBeNull()
    expect(container.querySelector('[data-error-state]')?.getAttribute('role')).toBe('alert')
  })
})
