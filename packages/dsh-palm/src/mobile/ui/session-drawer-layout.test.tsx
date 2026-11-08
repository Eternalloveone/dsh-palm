// @vitest-environment jsdom
/**
 * 抽屉版式的渲染契约（2026-11-08 实机投诉：图标撑满整行、文字被压折行）。
 *
 * 现场：抽屉里所有图标被放大成占满行宽，「新建会话」折成两行、「搜索会话和消息」
 * 折行、底部「设置 / 产物与文档 / 用量」被巨型图标覆盖。根因是 SVG 只有 viewBox、
 * 没有 width/height（在 flex 行里按替换元素默认的 300×150 参与布局），外加行内文案
 * 缺 nowrap + ellipsis。尺寸与单行约束在样式表里（`mobile-styles.structure.test.ts`
 * 断言令牌与规则体），这里断言**结构必须允许那些规则生效**：
 *
 * 1. 每个入口都是「一个图标 + 一段包在 span 里的文案」——裸文本节点在 flex 行里是
 *    匿名项，省略号挂不上去，于是它会先被挤到折行；
 * 2. 底部三入口一个不少，右侧小字（本机 / 产物数）单独成节点，不被主文案挤掉；
 * 3. 会话行仍是「标题 + 迷你状态条」，状态条是独立的 flex 项。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDrawer, type SessionDrawerProps } from './session-drawer.tsx'
import type { SessionView } from '../shared/session-view.ts'

afterEach(() => { cleanup() })

function session(overrides: Partial<SessionView> & { sessionId: string }): SessionView {
  return { title: `会话 ${overrides.sessionId}`, updatedAt: Date.now(), running: false, blank: false, ...overrides }
}

function renderDrawer(overrides: Partial<SessionDrawerProps> = {}): HTMLElement {
  const { container } = render(
    <SessionDrawer
      workspace={{ title: 'dsh-palm', path: '/repo/dsh-palm' }}
      rows={[]}
      finishedIds={new Set<string>()}
      onClose={() => {}}
      onNew={() => {}}
      onSearch={() => {}}
      onPick={() => {}}
      onOpenSettings={() => {}}
      onOpenArtifacts={() => {}}
      onOpenUsage={() => {}}
      {...overrides}
    />,
  )
  return container
}

describe('抽屉版式：图标不撑满、行不折行', () => {
  it('新建 / 搜索 / 底部三入口：各自一个图标，文案包在单行 span 里', () => {
    const container = renderDrawer()
    const rows = [...container.querySelectorAll('.palm-drawer-new, .palm-drawer-search, .palm-drawer-entry')]
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      // 一个入口一个图标 —— 图标不是文案的一部分，也不会多出第二个。
      expect(row.querySelectorAll('svg'), row.className).toHaveLength(1)
      const label = row.querySelector('span')
      expect(label, row.className).not.toBeNull()
      expect(label!.textContent!.trim()).not.toBe('')
    }
  })

  it('抽屉里一共 5 个图标（多工作区时身份区多一个切换箭头）', () => {
    const single = renderDrawer()
    expect(single.querySelectorAll('.palm-drawer svg')).toHaveLength(5)
    cleanup()
    const multi = renderDrawer({ workspaceCount: 2, onSwitchWorkspace: () => {} })
    expect(multi.querySelectorAll('.palm-drawer svg')).toHaveLength(6)
  })

  it('底部三入口：主文案单行，右侧小字单独成节点且不被挤掉', () => {
    const container = renderDrawer({ artifactCount: 3 })
    const entries = [...container.querySelectorAll('.palm-drawer-entry')]
    expect(entries.map(entry => entry.querySelector('span')!.textContent)).toEqual(['设置', '产物与文档', '用量'])
    // 有数量才画小字：没有产物数时不留空占位。
    expect(entries[0]!.querySelector('small')).toBeNull()
    expect(entries[1]!.querySelector('small')!.textContent).toBe('3')
    expect(entries[2]!.querySelector('small')!.textContent).toBe('本机')
  })

  it('会话行：标题是独立的 flex 项，迷你状态条单独成项（各自单行）', () => {
    const container = renderDrawer({
      rows: [session({ sessionId: 'running', title: '正在跑的会话', running: true })],
    })
    const row = container.querySelector('.palm-drawer-row') as HTMLElement
    expect(row.querySelector('.palm-drawer-title')!.textContent).toBe('正在跑的会话')
    expect(row.querySelector(".palm-strip[data-size='mini']")).not.toBeNull()
    expect(row.querySelectorAll('.palm-drawer-title, .palm-strip-wrap')).toHaveLength(2)
  })

  it('抬头：头像方块 + 工作区名称 + 路径三件都在（名称与路径各自单行）', () => {
    const container = renderDrawer({ workspace: { title: '示例工作区', path: '/repo/example' } })
    expect(container.querySelector('.palm-drawer-avatar')!.textContent).toBe('示')
    expect(container.querySelector('.palm-drawer-ws > b')!.textContent).toBe('示例工作区')
    expect(container.querySelector('.palm-drawer-ws > small')!.textContent).toBe('/repo/example')
    expect(screen.getByText('示例工作区')).toBeTruthy()
  })
})
