/**
 * 花名册缓存槽与它的失效出口。
 *
 * 这条链最容易出的错不是报错，而是**写入后旧缓存还在**：5 秒复用窗口里留着刚删掉的
 * 工作区，界面就会把它画回来（真机表现：删了还能看见，退出再进才消失）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { invalidateWorkspaceRoster } from './invalidate-roster.ts'
import {
  rosterCached,
  rosterInFlight,
  setRosterCached,
  setRosterInFlight,
} from './workspace-roster.ts'

const fakeItems = [{ id: 'w-1', title: 'demo', path: '/tmp/demo' }] as never

describe('工作区花名册缓存', () => {
  beforeEach(() => {
    setRosterCached(undefined)
    setRosterInFlight(undefined)
  })

  it('初始状态两个槽都是空的', () => {
    expect(rosterCached()).toBeUndefined()
    expect(rosterInFlight()).toBeUndefined()
  })

  it('写入后能原样读回（时间戳由调用方给，方便注入时钟）', () => {
    setRosterCached({ at: 1000, items: fakeItems })
    expect(rosterCached()).toEqual({ at: 1000, items: fakeItems })
  })

  it('在飞请求也能存取，且清空后不会留下旧 Promise', () => {
    const pending = Promise.resolve(fakeItems)
    setRosterInFlight(pending)
    expect(rosterInFlight()).toBe(pending)
    setRosterInFlight(undefined)
    expect(rosterInFlight()).toBeUndefined()
  })

  it('失效出口只清缓存，不打断在飞的请求（它回来会写一份带新时间戳的）', () => {
    const pending = Promise.resolve(fakeItems)
    setRosterCached({ at: 1000, items: fakeItems })
    setRosterInFlight(pending)

    invalidateWorkspaceRoster()

    expect(rosterCached()).toBeUndefined()
    expect(rosterInFlight()).toBe(pending)
  })
})
