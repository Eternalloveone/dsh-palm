// @vitest-environment jsdom
/**
 * C 案输入区：底部三行（队列 / 输入 / 元信息）的组件级契约。
 *
 * 这里只造 props、不碰会话层：胶囊与面板是纯展示 + 回调，队列行只看 count，
 * 状态位只看 statusText。集成链路（宿主投影、发送）另有 ChatView 用例。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionModels } from '../../../../api-proxy-types'
import { ComposerMeta } from './composer-meta.tsx'
import { ComposerSection, type ComposerSectionProps } from './composer-section.tsx'
import { formatClock, formatContextPercent } from '../lib/tool-labels.ts'

afterEach(cleanup)

const catalog: SessionModels = {
  current: { provider: 'fx', model: 'fx-2' },
  routable: true,
  groups: [{ id: 'fx', name: 'FX', models: [{ id: 'fx-2', name: 'FX 深度' }] }],
  failures: [],
}

function sectionProps(running: boolean, queue: ComposerSectionProps['queue']): ComposerSectionProps {
  return {
    draft: { input: '', setInput: () => {}, quoted: undefined, setQuoted: () => {} },
    attachments: {
      attachImages: [], setAttachImages: () => {}, attachFiles: [], setAttachFiles: () => {},
      retryStaged: () => {}, addImage: () => {},
    },
    commands: {
      commands: [], claimedCommand: undefined, claimCommand: () => {}, releaseCommand: () => {}, setPlusOpen: () => {},
    },
    turn: {
      running, primaryStops: false, stopArmed: false, setStopArmed: () => {}, stopping: false,
      stopTurn: () => {}, sending: false, draftEmpty: true, send: () => {},
    },
    inputBox: { composerRef: { current: null }, mobileEnterToSend: true },
    queue,
  }
}

function metaProps(overrides: Partial<Parameters<typeof ComposerMeta>[0]> = {}): Parameters<typeof ComposerMeta>[0] {
  return {
    currentModel: { provider: 'fx', model: 'fx-2' },
    permissions: {
      currentValue: 'workspace-write',
      options: [
        { value: 'readonly', name: '只读' },
        { value: 'workspace-write', name: '工作区写入', description: '改文件需授权' },
        { value: 'danger-full-access', name: '完全权限', description: '全部操作' },
      ],
    },
    modelCatalog: { status: 'ready', data: catalog },
    contextUsage: { pct: 44, window: 100_000, pressure: 44_000 },
    panelOpen: false,
    statusText: '空闲',
    pickerBusy: false,
    togglePanel: vi.fn(),
    closePanel: vi.fn(),
    loadModelCatalog: vi.fn(),
    applyModel: vi.fn(),
    applyPermission: vi.fn(),
    staleHint: () => undefined,
    ...overrides,
  }
}

describe('ComposerSection（C 案三行）', () => {
  it('switches the placeholder between idle and running', () => {
    const { rerender } = render(<ComposerSection {...sectionProps(false, { count: 0, detail: null })} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('说点什么...')
    rerender(<ComposerSection {...sectionProps(true, { count: 0, detail: null })} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('说点什么...（会打断当前任务）')
  })

  it('renders the queue strip only when something is queued', () => {
    const { rerender } = render(<ComposerSection {...sectionProps(false, { count: 0, detail: null })} />)
    expect(screen.queryByText(/条排队/)).toBeNull()
    rerender(<ComposerSection {...sectionProps(true, { count: 2, detail: <div data-testid="queue-detail" /> })} />)
    expect(screen.getByText('2 条排队 · 当前任务结束后执行')).toBeTruthy()
    expect(screen.getByTestId('queue-detail')).toBeTruthy()
  })
})

describe('ComposerMeta（胶囊 + 状态 + 面板）', () => {
  it('shows model and permission in one capsule', () => {
    render(<ComposerMeta {...metaProps()} />)
    const chip = screen.getByRole('button', { name: /模型与权限/ })
    expect(chip.textContent).toContain('fx-2')
    expect(chip.textContent).toContain('可写')
    expect(chip.getAttribute('aria-label')).toBe('模型与权限：fx-2 · 工作区写入')
  })

  it('calls togglePanel when the capsule is tapped', () => {
    const togglePanel = vi.fn()
    render(<ComposerMeta {...metaProps({ togglePanel })} />)
    fireEvent.click(screen.getByRole('button', { name: /模型与权限/ }))
    expect(togglePanel).toHaveBeenCalledTimes(1)
  })

  it('opens one model-and-permission panel, not separate model/permission pills', () => {
    render(<ComposerMeta {...metaProps({ panelOpen: true })} />)
    expect(screen.getByRole('menu', { name: '模型与权限' })).toBeTruthy()
    expect(screen.getByText('权限')).toBeTruthy()
    expect(screen.getByText('工作区写入')).toBeTruthy()
  })

  it('keeps context percent and clock formatting in the display-only group', () => {
    const { container } = render(<ComposerMeta {...metaProps({ statusText: '00:42' })} />)
    expect(container.querySelector('.chat-meta-right')?.textContent).toContain('00:42')
    expect(container.querySelector('.chat-meta-right')?.textContent).toContain('44%')
    expect(formatContextPercent(44)).toBe('44%')
    expect(formatContextPercent(0)).toBe('0%')
    expect(formatContextPercent(undefined)).toBe('--')
    expect(formatClock(42_000)).toBe('00:42')
    expect(formatClock(65_000)).toBe('01:05')
    expect(formatClock(-1)).toBe('00:00')
  })

  it('regresses the old multi-pill row: no arrow, no chat-pill/chat-context', () => {
    const { container } = render(<ComposerMeta {...metaProps()} />)
    const chip = screen.getByRole('button', { name: /模型与权限/ })
    expect(chip.textContent).not.toContain('▾')
    expect(container.querySelector('.chat-pill')).toBeNull()
    expect(container.querySelector('.chat-pill-chevron')).toBeNull()
    expect(container.querySelector('.chat-context')).toBeNull()
    expect(container.querySelectorAll('.chat-meta-chip')).toHaveLength(1)
  })
})
