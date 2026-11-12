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
import { IDLE_PLACEHOLDERS } from './composer-placeholder.ts'
import { formatContextPercent } from '../lib/tool-labels.ts'
import { createChatStore } from '../../../runtime/chat/store.ts'

afterEach(cleanup)

/** 发送/停在途由作曲区自己订阅（ChatView 不再透传），这里给一个空 store 即可。 */
const turnStore = createChatStore()

const catalog: SessionModels = {
  current: { provider: 'fx', model: 'fx-2' },
  routable: true,
  groups: [{ id: 'fx', name: 'FX', models: [{ id: 'fx-2', name: 'FX 深度' }] }],
  failures: [],
}

function sectionProps(running: boolean, queue: ComposerSectionProps['queue']): ComposerSectionProps {
  return {
    draft: { sessionId: 's-test', quoted: undefined, setQuoted: () => {} },
    attachments: {
      attachImages: [], setAttachImages: () => {}, attachFiles: [], setAttachFiles: () => {},
      retryStaged: () => {}, addImage: () => {},
    },
    commands: {
      commands: [], claimedCommand: undefined, claimCommand: () => {}, releaseCommand: () => {}, setPlusOpen: () => {},
    },
    turn: {
      running, stopArmed: false, setStopArmed: () => {}, stopTurn: () => {}, send: () => {}, store: turnStore,
    },
    inputBox: { composerRef: { current: null }, mobileEnterToSend: true },
    voice: {
      open: false, phase: 'recording', partial: '', elapsed: 0, statusText: '正在听…',
      waveRef: { current: null }, start: () => {}, finish: () => {}, cancel: () => {},
    },
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
    panel: null,
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
    // 2026-11-12 用户：「都改成说点什么会不会单调，要不要上词池」——空闲走词池，
    // 运行中固定一条中性文案（"会打断当前任务"由右侧红色停止键表达）。
    const { rerender } = render(<ComposerSection {...sectionProps(false, { detail: null })} />)
    const idle = (screen.getByRole('textbox') as HTMLTextAreaElement).placeholder
    expect(IDLE_PLACEHOLDERS).toContain(idle)
    rerender(<ComposerSection {...sectionProps(true, { detail: null })} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('说点什么...')
  })

  it('renders the queue strip only when something is queued', () => {
    const { rerender } = render(<ComposerSection {...sectionProps(false, { detail: null })} />)
    expect(screen.queryByText(/条排队/)).toBeNull()
    rerender(<ComposerSection {...sectionProps(true, { detail: <div data-testid="queue-detail" /> })} />)
    // 2026-11-10 方案 A：那条「N 条排队 · 当前任务结束后执行」横条下线 ——
    // 同一句话已经在排队卡的头行里，说两遍只是多占一屏。
    expect(screen.queryByText(/条排队/)).toBeNull()
    expect(screen.getByTestId('queue-detail')).toBeTruthy()
  })

  it('附件横排溢出时给右缘渐隐（390px 三件附件实拍：第二件被切掉一半）', () => {
    // 附件条是 overflow-x:auto 的横排，三件时右侧直接切在屏幕上，看不出还能滑。
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')
    const client = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 520 })
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 390 })
    const props = sectionProps(false, { detail: null })
    props.attachments.attachFiles = [
      { localId: 'f1', name: 'ChatView.test.tsx', bytes: 84_200, status: 'ready', receiptId: 'r1' },
      { localId: 'f2', name: 'budget.json', bytes: 12_000, status: 'uploading' },
    ]
    const { container } = render(<ComposerSection {...props} />)
    expect(container.querySelector('.chat-file-bar')!.getAttribute('data-fade')).toBe('end')
    if (width !== undefined) Object.defineProperty(Element.prototype, 'scrollWidth', width)
    if (client !== undefined) Object.defineProperty(Element.prototype, 'clientWidth', client)
  })
})

describe('ComposerMeta（两颗 chip + 状态 + 两块面板）', () => {
  it('模型和权限各占一颗 chip，不再挤在一个胶囊里', () => {
    // 2026-11-12 用户：「模型配置入口和权限入口分开单独配置，不要混在一起」。
    render(<ComposerMeta {...metaProps()} />)
    const modelChip = screen.getByRole('button', { name: /^模型：/ })
    const permChip = screen.getByRole('button', { name: /^权限：/ })
    expect(modelChip.textContent).toBe('fx-2')
    expect(permChip.textContent).toBe('可写')
    expect(modelChip.getAttribute('aria-label')).toBe('模型：fx-2')
    expect(permChip.getAttribute('aria-label')).toBe('权限：工作区写入')
    // 两颗是并列按钮，谁也不是谁的一部分。
    expect(modelChip).not.toBe(permChip)
    expect(modelChip.contains(permChip)).toBe(false)
  })

  it('点哪颗就说要开哪一块', () => {
    const togglePanel = vi.fn()
    render(<ComposerMeta {...metaProps({ togglePanel })} />)
    fireEvent.click(screen.getByRole('button', { name: /^模型：/ }))
    fireEvent.click(screen.getByRole('button', { name: /^权限：/ }))
    expect(togglePanel.mock.calls).toEqual([['model'], ['permission']])
  })

  it('模型面板里不出现权限，权限面板里不出现模型', () => {
    render(<ComposerMeta {...metaProps({ panelOpen: true, panel: 'model' })} />)
    expect(screen.getByRole('menu', { name: '模型' })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: '权限' })).toBeNull()
    expect(screen.queryByText('工作区写入')).toBeNull()
    cleanup()
    render(<ComposerMeta {...metaProps({ panelOpen: true, panel: 'permission' })} />)
    expect(screen.getByRole('menu', { name: '权限' })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: '模型' })).toBeNull()
    expect(screen.getByText('工作区写入')).toBeTruthy()
  })

  it('keeps the status word and context percent in the display-only group, with no clock', () => {
    const { container } = render(<ComposerMeta {...metaProps({ statusText: '运行中' })} />)
    const right = container.querySelector('.chat-meta-right')?.textContent ?? ''
    expect(right).toContain('运行中')
    expect(right).toContain('44%')
    // 元信息行不再报秒：一屏只留状态条那一个计时（运行态由红色停止键表达）。
    expect(right).not.toMatch(/\d{1,2}:\d{2}/)
    expect(container.querySelector('.chat-meta-status')!.textContent).toBe('运行中')
    expect(formatContextPercent(44)).toBe('44%')
    expect(formatContextPercent(0)).toBe('0%')
    expect(formatContextPercent(undefined)).toBe('--')
  })

  it('regresses the old multi-pill row: no arrow, no chat-pill/chat-context', () => {
    const { container } = render(<ComposerMeta {...metaProps()} />)
    const modelChip = screen.getByRole('button', { name: /^模型：/ })
    expect(modelChip.textContent).not.toContain('▾')
    expect(container.querySelector('.chat-pill')).toBeNull()
    expect(container.querySelector('.chat-pill-chevron')).toBeNull()
    expect(container.querySelector('.chat-context')).toBeNull()
    // 两颗：模型 + 权限（2026-11-12 拆开），不再是原来那一颗「模型与权限」。
    expect(container.querySelectorAll('.chat-meta-chip')).toHaveLength(2)
  })
})
