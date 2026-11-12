import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceGroups,
  countRows,
  distinguishingTails,
  highlightMatch,
  matchesQuery,
  parentTail,
  pathSegments,
  projectHint,
  projectKey,
  projectLabel,
  relativeDay,
  workspaceActivityOf,
  titleOf,
} from './workspace-picker-model.ts'

const NOW = Date.parse('2026-11-11T10:00:00+08:00')

const ws = (id: string, path: string, extra: { title?: string; updatedAt?: string; sessions?: number } = {}) => ({
  workspaceId: id,
  path,
  title: extra.title ?? '',
  updatedAt: extra.updatedAt ?? '',
  sessionIds: Array.from({ length: extra.sessions ?? 0 }, (_, i) => `s${i}`),
})

describe('工作区面板：路径整形', () => {
  it('同时吃反斜杠与正斜杠，末尾分隔符不算一段', () => {
    expect(pathSegments('D:\\work\\dsh-palm')).toEqual(['D:', 'work', 'dsh-palm'])
    expect(pathSegments('/home/me/proj/')).toEqual(['home', 'me', 'proj'])
  })

  it('标题优先用宿主给的 name，没有就取末段', () => {
    expect(titleOf(ws('a', 'D:\\work\\dsh-palm', { title: 'dsh-palm' }))).toBe('dsh-palm')
    expect(titleOf(ws('b', 'D:\\work\\dsh-palm'))).toBe('dsh-palm')
  })

  it('唯一名字：副标题是父路径的首段 + 末两段', () => {
    expect(parentTail('D:\\work\\dsh-palm')).toBe('D:\\work')
    expect(parentTail('D:\\steam')).toBe('D:\\steam')
    expect(parentTail('D:\\work\\A\\B\\C\\X')).toBe('D:\\…\\B\\C')
    expect(parentTail('D:\\')).toBe('')
  })

  it('同名：取最短能分开的尾巴，一级不够自动加一级', () => {
    expect(distinguishingTails(['D:\\work\\P\\00.master\\X', 'D:\\work\\P\\06.DP523\\X'])).toEqual(['00.master', '06.DP523'])
    expect(distinguishingTails(['D:\\w\\A\\X', 'D:\\w\\B\\X'])).toEqual(['A', 'B'])
    // 一级相同 → 升到两级
    expect(distinguishingTails(['D:\\w\\P\\A\\X', 'D:\\w\\P\\B\\X'][0].length > 0 ? ['D:\\w\\P\\A\\X', 'D:\\w\\Q\\A\\X'] : [])).toEqual(['P\\A', 'Q\\A'])
  })

  it('相对时间：今天 / 昨天 / N 天前', () => {
    expect(relativeDay('2026-11-11T09:00:00+08:00', NOW)).toBe('今天')
    expect(relativeDay('2026-11-10T22:00:00+08:00', NOW)).toBe('昨天')
    expect(relativeDay('2026-11-08T22:00:00+08:00', NOW)).toBe('3 天前')
    expect(relativeDay(undefined, NOW)).toBe('')
    expect(relativeDay('不是时间', NOW)).toBe('')
  })

  it('搜索同时匹配名称与路径', () => {
    const workspace = ws('a', 'D:\\work\\ICNA3611\\1.FEP\\ICNA3611')
    expect(matchesQuery(workspace, '3611')).toBe(true)
    expect(matchesQuery(workspace, 'fep')).toBe(true)
    expect(matchesQuery(workspace, 'zzz')).toBe(false)
    expect(matchesQuery(workspace, '   ')).toBe(true)
  })
})

describe('工作区面板：分组', () => {
  const list = [
    ws('cur', 'D:\\work\\ICNT9388\\1.Code\\06.DP523\\ICNT9388', { title: 'ICNT9388', updatedAt: '2026-11-11T09:40:00+08:00', sessions: 4 }),
    ws('a1', 'D:\\work\\ICNT9388\\1.Code\\00.master\\ICNT9388', { title: 'ICNT9388', updatedAt: '2026-11-09T09:00:00+08:00', sessions: 2 }),
    ws('b1', 'D:\\work\\ICNA3611\\1.FEP\\ICNA3611', { title: 'ICNA3611', updatedAt: '2026-11-10T09:00:00+08:00', sessions: 1 }),
    ws('b2', 'D:\\work\\ICNA3611\\2.CP\\ICNA3611', { title: 'ICNA3611', updatedAt: '2026-11-08T09:00:00+08:00', sessions: 3 }),
    ws('d', 'D:\\work\\dsh-palm', { title: 'dsh-palm', updatedAt: '2026-11-11T08:00:00+08:00', sessions: 7 }),
    ws('e', 'D:\\steam', { title: 'steam', sessions: 0 }),
  ]

  it('当前项永远第一组，且带完整路径与会话数', () => {
    const groups = buildWorkspaceGroups(list, 'cur', '', NOW)
    expect(groups[0]?.kind).toBe('current')
    expect(groups[0]?.rows[0]?.title).toBe('ICNT9388')
    expect(groups[0]?.rows[0]?.fullPath).toBe('D:\\work\\ICNT9388\\1.Code\\06.DP523\\ICNT9388')
    expect(groups[0]?.rows[0]?.sessionCount).toBe(4)
  })

  it('最近用过按 updatedAt 倒序、不含当前、最多 3 条', () => {
    const groups = buildWorkspaceGroups(list, 'cur', '', NOW)
    const recent = groups.find(group => group.kind === 'recent')
    expect(recent?.rows.map(row => row.id)).toEqual(['d', 'b1', 'a1'])
  })

  it('剩下的按父目录分组，同名项副标题能分开', () => {
    const groups = buildWorkspaceGroups(list, 'cur', '', NOW)
    const projects = groups.filter(group => group.kind === 'project')
    // 剩下的是：ICNA3611 的另一条（父目录 2.CP）+ 盘符下的 steam → 其它
    expect(projects.map(group => group.label).some(label => label.endsWith('2.CP'))).toBe(true)
    expect(projects.map(group => group.label)).toContain('其它')
    const tailRows = groups.flatMap(group => group.rows).filter(row => row.title === 'ICNA3611')
    expect(tailRows.map(row => row.subtitle).sort()).toEqual(['1.FEP', '2.CP'])
  })

  it('搜索时只留命中项，且不再分「当前 / 最近」', () => {
    const groups = buildWorkspaceGroups(list, 'cur', 'dsh', NOW)
    expect(groups.every(group => group.kind === 'project')).toBe(true)
    expect(countRows(groups)).toBe(1)
    expect(groups[0]?.rows[0]?.title).toBe('dsh-palm')
  })

  it('搜不到时返回空数组（面板显示"没有匹配"）', () => {
    expect(buildWorkspaceGroups(list, 'cur', 'zzz', NOW)).toEqual([])
  })

  it('不知道当前工作区时不硬造一个「当前」组', () => {
    const groups = buildWorkspaceGroups(list, '', '', NOW)
    expect(groups.some(group => group.kind === 'current')).toBe(false)
  })
})

describe('分组标题：短标题 + 上一级提示', () => {
  it('组标题只取父目录最后一级，上一级变成提示', () => {
    expect(projectLabel('D:\\work\\ICNT9388\\1.Code\\X')).toBe('1.Code')
    expect(projectHint('D:\\work\\ICNT9388\\1.Code\\X')).toBe('ICNT9388')
    expect(projectLabel('D:\\work\\dsh-palm')).toBe('work')
    expect(projectHint('D:\\work\\dsh-palm')).toBe('')
    expect(projectLabel('D:\\steam')).toBe('其它')
  })

  it('分组键比标题长：不同项目同名的最后一级不会被并成一组', () => {
    expect(projectKey('D:\\a\\1.Code\\X')).not.toBe(projectKey('D:\\b\\1.Code\\Y'))
    expect(projectLabel('D:\\a\\1.Code\\X')).toBe(projectLabel('D:\\b\\1.Code\\Y'))
  })

  it('两个同名的 project 组各自独立（组标题相同、key 不同）', () => {
    const groups = buildWorkspaceGroups([
      { workspaceId: 'a', path: 'D:\\a\\1.Code\\X', title: 'X' },
      { workspaceId: 'b', path: 'D:\\b\\1.Code\\Y', title: 'Y' },
    ], '', '', NOW)
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.label)).toEqual(['1.Code', '1.Code'])
    expect(new Set(groups.map(group => group.key)).size).toBe(2)
  })
})

describe('搜索命中高亮', () => {
  it('多处命中都标出来，大小写不敏感', () => {
    expect(highlightMatch('dsh-palm-dsh', 'dsh')).toEqual([
      { text: 'dsh', hit: true },
      { text: '-palm-', hit: false },
      { text: 'dsh', hit: true },
    ])
    expect(highlightMatch('DSH-Palm', 'dsh')).toEqual([
      { text: 'DSH', hit: true },
      { text: '-Palm', hit: false },
    ])
  })

  it('不命中 / 空搜索词时原样返回一段', () => {
    expect(highlightMatch('ICNT9268', 'zzz')).toEqual([{ text: 'ICNT9268', hit: false }])
    expect(highlightMatch('ICNT9268', '  ')).toEqual([{ text: 'ICNT9268', hit: false }])
  })

  it('路径里的反斜杠不会被吃掉', () => {
    expect(highlightMatch('D:\\work\\dsh-palm', 'work')).toEqual([
      { text: 'D:\\', hit: false },
      { text: 'work', hit: true },
      { text: '\\dsh-palm', hit: false },
    ])
  })
})
describe('「最近用过」按会话活动算（2026-11-11 真机）', () => {
  const NOW = Date.parse('2026-11-11T13:40:00+08:00')

  /**
   * 真机数据：`D:\work\dsh_dev` 的 workspace.updatedAt 停在 11-06，但它今天一直在跑。
   * 只看那个字段，「最近用过」里就没有它 —— 用户直接问「我一直在跑却不在最近使用」。
   */
  it('工作区自己的 updatedAt 很旧、但有会话今天在跑：仍然进最近用过（排第一）', () => {
    const workspaces = [
      { workspaceId: 'w-old', path: 'D:\\work\\ICNT9388\\00.master', title: 'ICNT9388', updatedAt: '2026-11-06T10:09:48.855Z' },
      { workspaceId: 'w-live', path: 'D:\\work\\dsh_dev', title: 'dsh_dev', updatedAt: '2026-11-06T05:29:30.441Z' },
      { workspaceId: 'w-stale', path: 'D:\\steam', title: 'steam', updatedAt: '2026-10-29T10:02:08.992Z' },
    ]
    const activity = workspaceActivityOf(workspaces, [
      { sessionId: 's1', updatedAt: Date.parse('2026-11-11T12:46:18+08:00'), cwd: 'D:\\work\\dsh_dev' },
      { sessionId: 's2', updatedAt: Date.parse('2026-11-10T14:59:41+08:00'), cwd: 'D:\\work\\ICNT9388\\00.master' },
    ])
    const groups = buildWorkspaceGroups(workspaces, '', '', NOW, activity)
    const recent = groups.find(group => group.kind === 'recent')
    // 三个都在最近用过里（上限 3），关键是**顺序**：今天在跑的那个排最前，steam 垫底。
    expect(recent?.rows.map(row => row.id)).toEqual(['w-live', 'w-old', 'w-stale'])
    // 标签也按活动时间说真话：今天是「今天」，不是「5 天前」。
    expect(recent?.rows[0]?.recentLabel).toBe('今天')
  })

  it('会话按 sessionIds 归属优先于 cwd（子代理/散会话不污染）', () => {
    const workspaces = [
      { workspaceId: 'w1', path: 'D:\\a', sessionIds: ['s-child'] },
      { workspaceId: 'w2', path: 'D:\\b', sessionIds: [] },
    ]
    const activity = workspaceActivityOf(workspaces, [
      { sessionId: 's-child', updatedAt: 1000, cwd: 'D:\\b' },
    ])
    expect(activity.get('w1')).toBe(1000)
    expect(activity.get('w2')).toBeUndefined()
  })

  it('没有任何活动信息时退回原行为（按 workspace.updatedAt 排）', () => {
    const workspaces = [
      { workspaceId: 'w1', path: 'D:\\a', updatedAt: '2026-11-01T00:00:00Z' },
      { workspaceId: 'w2', path: 'D:\\b', updatedAt: '2026-11-10T00:00:00Z' },
    ]
    const groups = buildWorkspaceGroups(workspaces, '', '', NOW)
    expect(groups.find(group => group.kind === 'recent')?.rows.map(row => row.id)).toEqual(['w2', 'w1'])
  })
})
