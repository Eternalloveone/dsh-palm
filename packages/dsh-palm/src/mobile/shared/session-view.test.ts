/**
 * cwdTail 的契约：任务页用它标「这条在跑/刚跑完的任务属于哪个工作区」——
 * 所以 Windows 反斜杠这条必须钉死（标题已不再拿它兜底，2026-11-13 改）。
 *
 * 背景（2026-11-11 真机）：只按 `/` 拆，`D:\dev\app` 整条会被当成"目录名"，
 * 同一目录下的会话于是全显示成同一个截断路径。
 */
import { describe, expect, it } from 'vitest'
import { cwdTail, toSessionView } from './session-view.ts'

describe('cwdTail', () => {
  it('取 Windows 反斜杠路径的最后一段', () => {
    expect(cwdTail('D:\\proj\\dsh-palm')).toBe('dsh-palm')
  })

  it('取 Unix 正斜杠路径的最后一段', () => {
    expect(cwdTail('/home/me/repo/dsh-palm')).toBe('dsh-palm')
  })

  it('末尾带分隔符也取得到（不会返回空串）', () => {
    expect(cwdTail('D:\\proj\\dsh-palm\\')).toBe('dsh-palm')
    expect(cwdTail('/home/me/dsh-palm/')).toBe('dsh-palm')
  })

  it('没给、给了空串时返回 undefined（调用方据此不画这一格）', () => {
    expect(cwdTail(undefined)).toBeUndefined()
    expect(cwdTail('')).toBeUndefined()
  })
})

describe('toSessionView 的标题兜底', () => {
  const base = { sessionId: 'session-1', updatedAt: 1, running: false, blank: false }

  it('没有 projections.title 时写「新会话」，不拿目录名或会话 id 顶', () => {
    const view = toSessionView({ ...base, cwd: 'D:\\proj\\proj-a\\1.Code' })
    expect(view.title).toBe('新会话')
    expect(view.cwd).toBe('D:\\proj\\proj-a\\1.Code')
  })

  it('title 是空串 / null 时同样落到「新会话」', () => {
    expect(toSessionView({ ...base, projections: { values: { title: '' } } }).title).toBe('新会话')
    expect(toSessionView({ ...base, projections: { values: { title: null } } }).title).toBe('新会话')
  })

  it('给了 title 就用 title（目录只作为 cwd 带下去，供任务页标注）', () => {
    const view = toSessionView({
      ...base,
      cwd: 'D:\\proj\\dsh-palm',
      projections: { values: { title: '目标条排版' } },
    })
    expect(view.title).toBe('目标条排版')
  })
})
