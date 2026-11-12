// @vitest-environment jsdom
/**
 * 「切换工作区」面板（2026-11-11 重做）：分组、搜索、当前项、新建。
 *
 * 这里只测**面板自己**的行为；短路径/分组规则由 `workspace-picker-model.test.ts` 直接覆盖。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspacePicker } from './workspace-picker.tsx'

/**
 * 只有 `listDirectory` 被换掉：面板还会走 `useWorkspaceActivity` 等其它 RPC，
 * 整模块 mock 会把它们连带打断（请求失败虽被吞掉，但行为就不真实了）。
 */
vi.mock('../../../api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api.ts')>()
  return {
    ...actual,
    listDirectory: vi.fn(async (path?: string) => ({
      path: path ?? 'D:\\work',
      home: 'D:\\work',
      crumbs: [
        { name: 'D:', path: 'D:\\', hidden: false },
        { name: 'work', path: 'D:\\work', hidden: false },
      ],
      entries: [
        { name: 'dsh-palm', path: 'D:\\work\\dsh-palm', hidden: false, kind: 'dir' as const },
        { name: 'proj', path: 'D:\\work\\proj', hidden: false, kind: 'dir' as const },
      ],
      truncated: false,
    })),
  }
})

const NOW = '2026-11-11T09:40:00+08:00'

const row = (id: string, path: string, extra: { title?: string; updatedAt?: string; sessions?: number } = {}) => ({
  workspaceId: id,
  path,
  title: extra.title ?? '',
  updatedAt: extra.updatedAt ?? '',
  sessionIds: Array.from({ length: extra.sessions ?? 0 }, (_, i) => `s${i}`),
})

const LIST = [
  row('cur', 'D:\\work\\ICNT9388\\1.Code\\06.DP523\\ICNT9388', { title: 'ICNT9388', updatedAt: NOW, sessions: 4 }),
  row('a1', 'D:\\work\\ICNT9388\\1.Code\\00.master\\ICNT9388', { title: 'ICNT9388', updatedAt: '2026-11-09T09:00:00+08:00', sessions: 2 }),
  row('d', 'D:\\work\\dsh-palm', { title: 'dsh-palm', updatedAt: '2026-11-11T08:00:00+08:00', sessions: 7 }),
]

const renderPicker = (props: Partial<Parameters<typeof WorkspacePicker>[0]> = {}) => {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onRename = vi.fn().mockResolvedValue(undefined)
  const onDelete = vi.fn().mockResolvedValue(undefined)
  render(
    <WorkspacePicker
      workspaces={LIST}
      currentWorkspaceId="cur"
      onPick={onPick}
      onClose={onClose}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      {...props}
    />,
  )
  return { onPick, onClose, onCreate, onRename, onDelete }
}

/** 当前列表里画出来的标题（顺序 = DOM 顺序）。 */
const titles = (): (string | null)[] => [...document.querySelectorAll('.sheet-option-title')].map(node => node.textContent)

beforeEach(() => { cleanup(); localStorage.clear() })

describe('切换工作区面板', () => {
  it('当前工作区在第一组，显示完整路径和会话数', () => {
    renderPicker()
    expect(screen.getByText('当前')).toBeTruthy()
    // ICNT9388 有两条（当前 + 最近用过），第一行才是当前
    const current = screen.getAllByRole('menuitem')[0] as HTMLElement
    expect(current.textContent).toContain('D:\\work\\ICNT9388\\1.Code\\06.DP523\\ICNT9388')
    expect(current.textContent).toContain('4 个会话')
  })

  it('最近用过按时间倒序，且不重复当前项', () => {
    renderPicker()
    expect(screen.getByText('最近用过')).toBeTruthy()
    const items = screen.getAllByRole('menuitem').map(node => node.textContent ?? '')
    // 第 1 条是当前；最近用过里只剩 dsh-palm(a1 也在，但 cur 已在当前组)
    expect(items[1]).toContain('dsh-palm')
    expect(items.filter(text => text.includes('D:\\work\\ICNT9388\\1.Code\\06.DP523'))).toHaveLength(1)
  })

  it('点一行把工作区原样交给调用方', () => {
    const { onPick } = renderPicker()
    fireEvent.click(screen.getByRole('menuitem', { name: /dsh-palm/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'd' }))
  })

  it('搜索按名称/路径过滤，搜不到给空态', () => {
    renderPicker()
    const input = screen.getByLabelText('搜索工作区')
    fireEvent.change(input, { target: { value: 'dsh' } })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('dsh-palm')
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的工作区')).toBeTruthy()
  })

  it('清除按钮把搜索词清空', () => {
    renderPicker()
    const input = screen.getByLabelText('搜索工作区') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'dsh' } })
    fireEvent.click(screen.getByLabelText('清除搜索'))
    expect(input.value).toBe('')
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(1)
  })

  it('底部显示总数，点「＋ 新建」打开表单并提交路径', async () => {
    const { onCreate } = renderPicker()
    expect(screen.getByText('共 3 个工作区')).toBeTruthy()
    // 搜索时底部换成「找到 N 个」：面板里写着「共 34 个」但只列 3 行会让人以为漏了。
    fireEvent.change(screen.getByLabelText('搜索工作区'), { target: { value: 'dsh' } })
    expect(screen.getByText('找到 1 个工作区')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('新建工作区'))
    const input = screen.getByLabelText('新建工作区') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'D:\\work\\新项目' } })
    fireEvent.click(screen.getByText('创建并切换'))
    await waitFor(() => { expect(onCreate).toHaveBeenCalledWith('D:\\work\\新项目') })
  })

  it('新建失败时错误贴在表单里，不回到列表', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('目录不存在'))
    renderPicker({ onCreate })
    fireEvent.click(screen.getByLabelText('新建工作区'))
    fireEvent.change(screen.getByLabelText('新建工作区'), { target: { value: 'D:\\nope' } })
    fireEvent.click(screen.getByText('创建并切换'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('目录不存在') })
    expect(screen.getByLabelText('新建工作区')).toBeTruthy()
  })

  /**
   * 真机 2026-11-11：「当前没法新建新的工作区」。
   *
   * 宿主的校验其实是对的（只登记已存在的目录），但界面把
   * `ENOENT: no such file or directory, realpath 'D:\work\x'` 原样甩给用户，
   * 看起来就是「坏了」。改成一句中文 + 下一步。
   */
  it('目录不存在时，把宿主的 ENOENT 翻成一句人话', async () => {
    const onCreate = vi.fn().mockRejectedValue(
      new Error('cannot create a Workspace at "D:\\work\\x": ENOENT: no such file or directory, realpath \'D:\\work\\x\''),
    )
    renderPicker({ onCreate })
    fireEvent.click(screen.getByLabelText('新建工作区'))
    fireEvent.change(screen.getByLabelText('新建工作区'), { target: { value: 'D:\\work\\x' } })
    fireEvent.click(screen.getByText('创建并切换'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('电脑上没有这个目录')
    expect(alert.textContent).toContain('D:\\work\\x')
    expect(alert.textContent).toContain('先在电脑上把目录建好')
    expect(alert.textContent).not.toContain('ENOENT')
  })

  it('新建表单里能把当前目录一键填进去', () => {
    renderPicker({ currentPath: 'D:\\work\\dsh-palm' })
    fireEvent.click(screen.getByLabelText('新建工作区'))
    const input = screen.getByLabelText('新建工作区') as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.click(screen.getByText(/用当前目录/))
    expect(input.value).toBe('D:\\work\\dsh-palm')
  })
})

describe('切换工作区面板：密度', () => {
  it('单条项目组不重复写一遍父目录（省掉副标题）', () => {
    renderPicker({
      workspaces: [
        row('cur', 'D:\\work\\dsh-palm', { title: 'dsh-palm', updatedAt: '2026-11-11T09:40:00+08:00', sessions: 7 }),
        row('solo', 'D:\\work\\ICNT9388\\1.Code\\00.master\\ICNT9388', { title: 'ICNT9388', sessions: 1 }),
      ],
    })
    // 项目组默认折叠，先点组头展开
    fireEvent.click(screen.getByLabelText(/00\.master/))
    const solo = screen.getByRole('menuitem', { name: /ICNT9388/ })
    // 组标题已经是 `00.master`（上一级 `1.Code` 在右侧浅色提示里），行里不再重复
    expect(solo.querySelector('.sheet-option-desc')).toBeNull()
  })

  it('项目组默认折叠：只画组头，点开才画行', () => {
    renderPicker()
    // 三行数据里当前 + 最近用过已经占两条，项目组只剩 0 条 —— 换一组数据更直观
    cleanup()
    renderPicker({
      workspaces: [
        row('cur', 'D:\\work\\dsh-palm', { title: 'dsh-palm', updatedAt: '2026-11-11T09:40:00+08:00' }),
        row('x', 'D:\\work\\ICNT9388\\1.Code\\00.master\\X', { title: 'X' }),
        row('y', 'D:\\work\\ICNT9388\\1.Code\\06.DP523\\Y', { title: 'Y' }),
      ],
    })
    const heads = screen.getAllByRole('button', { name: /个工作区$/ })
    expect(heads.length).toBe(2)
    expect(titles()).not.toContain('X')
    fireEvent.click(heads[0] as HTMLElement)
    expect(titles()).toContain('X')
    fireEvent.click(heads[0] as HTMLElement)
    expect(titles()).not.toContain('X')
  })

  it('搜索时不折叠：命中的行直接铺出来', () => {
    renderPicker({
      workspaces: [
        row('cur', 'D:\\work\\dsh-palm', { title: 'dsh-palm' }),
        row('x', 'D:\\work\\ICNT9388\\1.Code\\00.master\\X', { title: 'X' }),
      ],
    })
    fireEvent.change(screen.getByLabelText('搜索工作区'), { target: { value: 'x' } })
    expect(titles()).toContain('X')
  })

  it('搜索命中处加底色', () => {
    renderPicker()
    fireEvent.change(screen.getByLabelText('搜索工作区'), { target: { value: 'palm' } })
    const mark = document.querySelector('.ws-mark')
    expect(mark?.textContent).toBe('palm')
  })

  it('搜索时每一行仍带路径（知道命中的是哪条）', () => {
    renderPicker()
    fireEvent.change(screen.getByLabelText('搜索工作区'), { target: { value: 'dsh' } })
    const only = screen.getAllByRole('menuitem')[0] as HTMLElement
    // 搜索命中时副标题给的是它的父路径 `D:\work`（不是干巴巴的 `work`，也不是整条绝对路径）
    expect(only.querySelector('.sheet-option-desc')?.textContent).toBe('D:\\work')
  })
})
describe('切换工作区面板：每行的重命名 / 删除', () => {
  it('点「⋯」打开菜单，选「重命名」进表单，保存后把新名字交出去', async () => {
    const { onRename } = renderPicker()
    fireEvent.click(screen.getByLabelText('更多操作：dsh-palm'))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByLabelText('重命名「dsh-palm」') as HTMLInputElement
    expect(input.value).toBe('dsh-palm')
    fireEvent.change(input, { target: { value: '掌上 DSH' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => { expect(onRename).toHaveBeenCalledWith('d', '掌上 DSH') })
  })

  it('名字没改就不提交（省一次宿主往返）', () => {
    const { onRename } = renderPicker()
    fireEvent.click(screen.getByLabelText('更多操作：dsh-palm'))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const save = screen.getByText('保存') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('删除要走一步确认，确认页说明目录本身不会被删', async () => {
    const { onDelete } = renderPicker()
    fireEvent.click(screen.getByLabelText('更多操作：dsh-palm'))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    expect(screen.getByText('删除「dsh-palm」？')).toBeTruthy()
    expect(screen.getByText(/磁盘上的目录不会被删/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(onDelete).toHaveBeenCalledWith('d') })
  })

  it('删除失败时错误留在确认页，不悄悄回到列表', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('工作区不存在'))
    renderPicker({ onDelete })
    fireEvent.click(screen.getByLabelText('更多操作：dsh-palm'))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('工作区不存在') })
    expect(screen.getByText('删除「dsh-palm」？')).toBeTruthy()
  })

  it('菜单里对当前工作区的删除项有明确标注', () => {
    renderPicker()
    fireEvent.click(screen.getAllByLabelText('更多操作：ICNT9388')[0] as HTMLElement)
    expect(screen.getByRole('menuitem', { name: '删除（当前工作区）' })).toBeTruthy()
  })
})

describe('切换工作区面板：折叠状态记住', () => {
  it('展开一次后重新挂载，还是展开的', () => {
    const data = {
      workspaces: [
        row('cur', 'D:\\work\\dsh-palm', { title: 'dsh-palm' }),
        row('x', 'D:\\work\\ICNT9388\\1.Code\\00.master\\X', { title: 'X' }),
      ],
    }
    renderPicker(data)
    fireEvent.click(screen.getAllByRole('button', { name: /个工作区$/ })[0] as HTMLElement)
    expect(titles()).toContain('X')
    cleanup()
    renderPicker(data)
    expect(titles()).toContain('X')
  })

  it('收起来也会记住（下次打开还是收着的）', () => {
    const data = {
      workspaces: [
        row('cur', 'D:\\work\\dsh-palm', { title: 'dsh-palm' }),
        row('x', 'D:\\work\\ICNT9388\\1.Code\\00.master\\X', { title: 'X' }),
      ],
    }
    renderPicker(data)
    const head = () => screen.getAllByRole('button', { name: /个工作区$/ })[0] as HTMLElement
    fireEvent.click(head())
    fireEvent.click(head())
    cleanup()
    renderPicker(data)
    expect(titles()).not.toContain('X')
  })

  it('新建里可以点选电脑上的目录：点进去、选下来、填回输入框', async () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: '新建工作区' }))
    // 2026-11-11 用户：「这个路径要能点选远程电脑端路径」。
    fireEvent.click(screen.getByRole('button', { name: /浏览电脑上的目录/ }))
    await waitFor(() => { expect(screen.getByText('dsh-palm')).toBeTruthy() })
    fireEvent.click(screen.getByText('dsh-palm'))
    await waitFor(() => { expect(screen.getByRole('button', { name: '用这个目录' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '用这个目录' }))
    // 选完回到表单，输入框里就是刚点的那个绝对路径（用户还能改）。
    await waitFor(() => {
      const input = screen.getByLabelText('新建工作区') as HTMLInputElement
      expect(input.value).toBe('D:\\work\\dsh-palm')
    })
  })

  it('点选时按「← 手动填」回到表单，不会把路径塞进去', async () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: '新建工作区' }))
    fireEvent.click(screen.getByRole('button', { name: /浏览电脑上的目录/ }))
    await waitFor(() => { expect(screen.getByRole('button', { name: '← 手动填' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '← 手动填' }))
    await waitFor(() => {
      const input = screen.getByLabelText('新建工作区') as HTMLInputElement
      expect(input.value).toBe('')
    })
  })
})