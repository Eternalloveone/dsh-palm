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
import { getSkin, SKIN_LABEL } from '../platform/skin.ts'

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
      onOpenUsage={() => {}}
      {...overrides}
    />,
  )
  return container
}

describe('抽屉版式：图标不撑满、行不折行', () => {
  it('搜索 / 底部两入口：图标 + 文案 + 右侧箭头；「新建会话」按用户要求只留文字', () => {
    const container = renderDrawer()
    const rows = [...container.querySelectorAll('.palm-drawer-search, .palm-drawer-tool')]
    // 搜索 1 + 底部两行（设置 / 用量）：2026-11-11 删掉「产物与文档」。
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      // 搜索行只有一个放大镜；底部两行各两个图形（功能图标 + 「能进去」的箭头，2026-11-11 C 版）。
      const expected = row.classList.contains('palm-drawer-search') ? 1 : 2
      expect(row.querySelectorAll('svg'), row.className).toHaveLength(expected)
      const label = row.querySelector('span')
      expect(label, row.className).not.toBeNull()
      expect(label!.textContent!.trim()).not.toBe('')
    }
    // 2026-11-11 用户要求：新建会话按钮去掉「+」号，只剩文字（版式约束不变：文案仍在 span 里）。
    const create = container.querySelector('.palm-drawer-new')!
    expect(create.querySelectorAll('svg')).toHaveLength(0)
    expect(create.querySelector('span')!.textContent!.trim()).toBe('新建会话')
  })

  it('抽屉里一共 6 个图标（新建会话不带图标；底部两行各 图标+箭头）', () => {
    const single = renderDrawer()
    // 搜索 1 + 底部两行（2 图标 + 2 箭头）= 5；「切换工作区」在单工作区时不画。
    // 2026-11-11 删掉「产物与文档」后从 7 变 5。
    expect(single.querySelectorAll('.palm-drawer svg')).toHaveLength(5)
    cleanup()
    const multi = renderDrawer({ workspaceCount: 2, onSwitchWorkspace: () => {} })
    // 多工作区时身份区多一个切换箭头（16px）。
    expect(multi.querySelectorAll('.palm-drawer svg')).toHaveLength(6)
  })

  it('底部两入口：主文案单行，右侧小字单独成节点且不被挤掉', () => {
    const container = renderDrawer()
    const entries = [...container.querySelectorAll('.palm-drawer-tool')]
    // 2026-11-11 用户要求删掉「产物与文档」：右上角「⋯ → 这一轮的产物」就是同一个入口。
    expect(entries.map(entry => entry.querySelector('span')!.textContent)).toEqual(['用量', '设置'])
    // 顺序是「用量 → 设置」：用量右侧是「余额」（2026-11-12 改的文案，宿主那几张卡
    // 其实是各家账户余额，写「本机」会被读成手机自己的用量）；设置右侧是当前皮肤名
    // （2026-11-11：抽屉里一眼看到自己在用什么皮肤）。
    expect(entries[0]!.querySelector('small')!.textContent).toBe('余额')
    expect(entries[1]!.querySelector('small')!.textContent).toBe(SKIN_LABEL[getSkin()])
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
