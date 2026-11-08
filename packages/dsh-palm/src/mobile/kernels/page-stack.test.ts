import { describe, expect, it } from 'vitest'
import {
  canGoBack,
  createPageStack,
  currentOf,
  depthOf,
  historyOf,
  popPage,
  pushPage,
  replacePage,
  resetToRoot,
} from './page-stack.ts'

type Route = { kind: string; sessionId?: string }

const root = (): ReturnType<typeof createPageStack<Route>> =>
  createPageStack<Route>('list', { kind: 'list' })

describe('page-stack（P6 地基）', () => {
  it('根页栈深为 1，且不能返回', () => {
    const stack = root()
    expect(depthOf(stack)).toBe(1)
    expect(canGoBack(stack)).toBe(false)
    expect(currentOf(stack)?.key).toBe('list')
  })

  it('压栈后当前页与栈深都跟着变', () => {
    const stack = pushPage(root(), 'chat:s-1', { kind: 'chat', sessionId: 's-1' })
    expect(depthOf(stack)).toBe(2)
    expect(canGoBack(stack)).toBe(true)
    expect(currentOf(stack)?.value.sessionId).toBe('s-1')
  })

  it('弹栈回到上一页', () => {
    const two = pushPage(root(), 'chat:s-1', { kind: 'chat', sessionId: 's-1' })
    const one = popPage(two)
    expect(depthOf(one)).toBe(1)
    expect(currentOf(one)?.key).toBe('list')
  })

  it('在根页弹栈是空操作，且返回同一个对象（可据此放行系统退出）', () => {
    const stack = root()
    expect(popPage(stack)).toBe(stack)
  })

  it('push 不改原栈（不可变）', () => {
    const stack = root()
    pushPage(stack, 'chat:s-1', { kind: 'chat', sessionId: 's-1' })
    expect(depthOf(stack)).toBe(1)
  })

  it('replace 换页但不留返回痕迹', () => {
    const two = pushPage(root(), 'chat:s-1', { kind: 'chat', sessionId: 's-1' })
    const replaced = replacePage(two, 'chat:s-2', { kind: 'chat', sessionId: 's-2' })
    expect(depthOf(replaced)).toBe(2)
    expect(currentOf(replaced)?.key).toBe('chat:s-2')
    // 返回仍然回到根页，而不是 s-1
    expect(currentOf(popPage(replaced))?.key).toBe('list')
  })

  it('同一页可以重复压入（用户确实进了两次）', () => {
    const stack = pushPage(
      pushPage(root(), 'chat:s-1', { kind: 'chat', sessionId: 's-1' }),
      'chat:s-1',
      { kind: 'chat', sessionId: 's-1' },
    )
    expect(depthOf(stack)).toBe(3)
  })

  it('resetToRoot 一次退回列表，且保留根页数据', () => {
    const deep = pushPage(pushPage(root(), 'chat:s-1', { kind: 'chat' }), 'settings', { kind: 'settings' })
    const back = resetToRoot(deep)
    expect(depthOf(back)).toBe(1)
    expect(currentOf(back)?.value.kind).toBe('list')
  })

  it('空栈的 replace 会补一个根页（防御：不该发生但别崩）', () => {
    const empty = { entries: [] as Array<{ key: string; value: Route }> }
    const fixed = replacePage(empty, 'list', { kind: 'list' })
    expect(depthOf(fixed)).toBe(1)
  })

  it('historyOf 给每一步的 URL 与深度，顺序与栈一致', () => {
    const stack = pushPage(pushPage(root(), 'chat:s-1', { kind: 'chat' }), 'settings', { kind: 'settings' })
    const history = historyOf(stack, key => `/m/${key}`)
    expect(history.map(item => item.path)).toEqual(['/m/list', '/m/chat:s-1', '/m/settings'])
    expect(history.map(item => item.depth)).toEqual([1, 2, 3])
  })
})
