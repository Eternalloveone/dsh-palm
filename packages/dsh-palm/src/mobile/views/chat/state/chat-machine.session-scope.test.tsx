// @vitest-environment jsdom
/**
 * 界面切片（四个 reducer）的**会话作用域**契约（P4：换会话不重挂 ChatView）。
 *
 * 聊天页实例跨会话活着之后，"上一场的浮层开在新会话上"就是真实 bug：模型面板还开着、
 * 搜索条里还留着 A 的词（切过去会拿 A 的词去搜 B）、"第 N 轮"读数是 A 的轮号。
 * 所以四个切片整片随会话复位 —— 只有真相源在外部的两个字段（连通性、宿主偏好）例外。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useChatComposerState, useChatReading, useChatSearch, useChatUi } from './chat-machine.ts'

interface Handles {
  ui: ReturnType<typeof useChatUi>
  search: ReturnType<typeof useChatSearch>
  reading: ReturnType<typeof useChatReading>
  composer: ReturnType<typeof useChatComposerState>
}

let handles: Handles | undefined

function Harness({ scope }: { scope: string }) {
  const ui = useChatUi(scope)
  const search = useChatSearch(scope)
  const reading = useChatReading(scope)
  const composer = useChatComposerState(scope)
  handles = { ui, search, reading, composer }
  return (
    <div data-testid="state">
      {[
        ui[0].moreOpen,
        search[0].open,
        search[0].term,
        reading[0].currentTurn,
        reading[0].unreadCount,
        composer[0].pickerBusy,
        composer[0].offline,
        composer[0].mobileEnterToSend,
      ].map(String).join('|')}
    </div>
  )
}

afterEach(() => {
  cleanup()
  handles = undefined
})

describe('界面切片的会话作用域', () => {
  it('换会话：浮层关掉、搜索清空、阅读位置归零（上一场的界面状态不许跟过去）', () => {
    const view = render(<Harness scope="s-1" />)
    act(() => {
      handles!.ui[1].moreOpen(true)
      handles!.search[1].open(true)
      handles!.search[1].term('A 的词')
      handles!.reading[1].currentTurn(7)
      handles!.reading[1].unreadCount(3)
      handles!.composer[1].pickerBusy(true)
    })
    expect(view.getByTestId('state').textContent).toBe('true|true|A 的词|7|3|true|false|true')

    view.rerender(<Harness scope="s-2" />)

    expect(view.getByTestId('state').textContent).toBe('false|false||0|0|false|false|true')
  })

  it('换会话时保留外部真相源（离线态、宿主偏好不跟着会话复位）', () => {
    const view = render(<Harness scope="s-1" />)
    act(() => {
      handles!.composer[1].offline(true)
      handles!.composer[1].mobileEnterToSend(false)
    })
    expect(view.getByTestId('state').textContent).toBe('false|false||0|0|false|true|false')

    view.rerender(<Harness scope="s-2" />)

    expect(view.getByTestId('state').textContent).toBe('false|false||0|0|false|true|false')
  })

  it('同会话内照旧：setter 支持函数式更新，值相等不换引用', () => {
    render(<Harness scope="s-1" />)
    const before = handles!.reading[0]
    act(() => { handles!.reading[1].unreadCount(previous => previous + 2) })
    expect(handles!.reading[0].unreadCount).toBe(2)
    const afterFirst = handles!.reading[0]
    act(() => { handles!.reading[1].unreadCount(2) })
    // 值相等 ⇒ 同一个对象（订阅者不被无意义的更新唤醒）
    expect(handles!.reading[0]).toBe(afterFirst)
    expect(afterFirst).not.toBe(before)
  })
})
