// @vitest-environment jsdom
/**
 * `useSessionState` / `useSessionRef` 的行为契约（P4：换会话不重挂 ChatView 的底座）。
 *
 * 这两只 hook 的价值全在"重置是语义、不是另一份要同步维护的名单"，所以这里的用例
 * 只钉三件事：换作用域就回初值、同作用域不动、复位之后 setter 写的是新作用域。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { useSessionRef, useSessionState } from './use-session-scope.ts'
import { clearViewSnapshots } from '../state/session-view-snapshot.ts'

interface StateHandle {
  value: number
  set: Dispatch<SetStateAction<number>>
  renders: number
}

interface RefHandle {
  current: number
}

let stateHandle: StateHandle | undefined
let refHandle: RefHandle | undefined

function Harness({ scope, initial = 0 }: { scope: string; initial?: number }) {
  const [value, set] = useSessionState(scope, initial)
  refHandle = useSessionRef(scope, () => initial)
  stateHandle = { value, set, renders: (stateHandle?.renders ?? 0) + 1 }
  return <div data-testid="state">{String(value)}</div>
}

afterEach(() => {
  cleanup()
  // 模块级快照会跨用例存活，不清会让下一条用例读到上一条写进去的值。
  clearViewSnapshots()
  stateHandle = undefined
  refHandle = undefined
})

/** 带快照键的 harness：验证"切回来还是上次的样子"。 */
function SnapshotHarness({ scope, initial = 0 }: { scope: string; initial?: number }) {
  const [value, set] = useSessionState(scope, initial, { snapshotKey: 'probe' })
  stateHandle = { value, set, renders: (stateHandle?.renders ?? 0) + 1 }
  return <div data-testid="state">{String(value)}</div>
}

describe('useSessionState', () => {
  it('同作用域内与 useState 一样：值保留，函数式更新拿到最新值', () => {
    const view = render(<Harness scope="s-1" />)
    act(() => { stateHandle!.set(1) })
    act(() => { stateHandle!.set(previous => previous + 1) })
    expect(view.getByTestId('state').textContent).toBe('2')
  })

  it('换作用域：值回到初值（渲染期复位，不靠 effect 事后补）', () => {
    const view = render(<Harness scope="s-1" initial={7} />)
    act(() => { stateHandle!.set(99) })
    expect(view.getByTestId('state').textContent).toBe('99')

    view.rerender(<Harness scope="s-2" initial={7} />)
    expect(view.getByTestId('state').textContent).toBe('7')
  })

  it('复位之后 setter 写的是新作用域（不会把上一场的值带回来）', () => {
    const view = render(<Harness scope="s-1" initial={0} />)
    act(() => { stateHandle!.set(5) })
    view.rerender(<Harness scope="s-2" initial={0} />)
    act(() => { stateHandle!.set(3) })
    expect(view.getByTestId('state').textContent).toBe('3')
    // 再回到 s-1：按作用域语义回到初值，不是"记住上次的 5"
    view.rerender(<Harness scope="s-1" initial={0} />)
    expect(view.getByTestId('state').textContent).toBe('0')
  })

  it('惰性初值在每次复位时重新求值（快照行、缓存这类随时间变的东西）', () => {
    let calls = 0
    function Lazy({ scope }: { scope: string }) {
      const [value] = useSessionState(scope, () => { calls += 1; return calls })
      return <div data-testid="lazy">{String(value)}</div>
    }
    const view = render(<Lazy scope="s-1" />)
    expect(view.getByTestId('lazy').textContent).toBe('1')
    view.rerender(<Lazy scope="s-2" />)
    expect(view.getByTestId('lazy').textContent).toBe('2')
  })
})

describe('useSessionRef', () => {
  it('同作用域：引用保持同一个对象', () => {
    const view = render(<Harness scope="s-1" initial={1} />)
    const first = refHandle
    view.rerender(<Harness scope="s-1" initial={1} />)
    expect(refHandle).toBe(first)
    expect(refHandle!.current).toBe(1)
  })

  it('换作用域：current 回到初值（上一场按轮号记的账不能留给下一场）', () => {
    const view = render(<Harness scope="s-1" initial={0} />)
    refHandle!.current = 42
    expect(refHandle!.current).toBe(42)

    view.rerender(<Harness scope="s-2" initial={0} />)
    expect(refHandle!.current).toBe(0)
  })
})

describe('与会话无关的状态不要用作用域 hook', () => {
  it('普通 useState 在同一实例里跨会话保留（显示偏好这类全局事实）', () => {
    let read: number | undefined
    let set: Dispatch<SetStateAction<number>> | undefined
    function Plain({ scope }: { scope: string }) {
      const [value, write] = useState(0)
      read = value
      set = write
      return <div data-testid="plain">{`${scope}:${value}`}</div>
    }
    const view = render(<Plain scope="s-1" />)
    act(() => { set!(3) })
    view.rerender(<Plain scope="s-2" />)
    expect(read).toBe(3)
  })
  it('给了 snapshotKey：切回原来那场，第一帧就是上次的值（不再回到初值）', () => {
    const view = render(<SnapshotHarness scope="s-a" initial={0} />)
    act(() => { stateHandle!.set(42) })
    expect(view.getByTestId('state').textContent).toBe('42')

    // 切到没打开过的 s-b：那边没有快照，仍然是初值。
    view.rerender(<SnapshotHarness scope="s-b" initial={0} />)
    expect(view.getByTestId('state').textContent).toBe('0')

    // 切回 s-a：快照优先，直接是 42 —— 这就是"目标条/待办条不再消失一帧"的底座。
    view.rerender(<SnapshotHarness scope="s-a" initial={0} />)
    expect(view.getByTestId('state').textContent).toBe('42')
  })

  it('没给 snapshotKey 的 state 不受影响：切回来仍是初值（记账类不该被快照复活）', () => {
    const view = render(<Harness scope="s-a" initial={7} />)
    act(() => { stateHandle!.set(99) })
    view.rerender(<Harness scope="s-b" initial={7} />)
    view.rerender(<Harness scope="s-a" initial={7} />)
    expect(view.getByTestId('state').textContent).toBe('7')
  })

})
