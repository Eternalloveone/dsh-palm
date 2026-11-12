/**
 * **会话作用域的状态**：换会话即回到初值（P4：换会话不重挂 ChatView 的承载点）。
 *
 * ## 为什么要它
 *
 * 聊天页的渲染容器不再随会话换 key（`App.tsx` 的 `pageKey` 恒为 `chat`），于是
 * `ChatSessionView` 这个实例会**跨会话活着**。卸载重挂时代，"换会话"是靠 React 丢
 * 掉整棵 state 树实现的；现在得自己把「只有本会话才有意义的东西」清干净——
 * 漏一个就是跨会话串味（引用 A 的正文发到 B、A 的附件随 B 发出去、A 的轮号覆盖 B）。
 *
 * 逐个 setter 手写清单的问题不是麻烦，是**漏了没人发现**：清单腐烂是静默的。
 * 所以这里把"作用域"做进状态本身——声明时写清它属于哪个会话，重置就是它的语义，
 * 而不是另一份需要同步维护的名单。
 *
 * ## 怎么做到"换会话不闪 A 的内容"
 *
 * 复位在**读取时**判定：每只 hook 记着自己这份值属于哪一次作用域（代次），代次对不上
 * 就直接返回本场初值。所以换会话的那一次渲染里，组件拿到的已经是新会话的值 ——
 * 不需要 effect 事后补清（`useEffect` 在提交并绘制之后才跑，那样 B 的第一帧会是
 * "B 的标题 + A 的对话行"，下一帧才被换掉）。
 *
 * 也不在渲染期 `setState` 做复位：那会让 React 把 4000 行的组件体再跑一遍，白花开销。
 *
 * ## 不适用
 *
 * 与会话无关的东西**不要**用这两个 hook：显示偏好（`mobileEnterToSend`）、连通性
 * （`offline`）、命令目录这类全局事实，用 `useState` / `useRef` 原样持有。
 *
 * @module dsh-palm/mobile/views/chat/use-session-scope
 */
import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

/** 把初值（或惰性初值函数）解析成值，同时避免把函数本身当成值。 */
function resolve<T>(initial: T | (() => T)): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial
}

/** 状态盒：记住"这份值属于哪一次作用域"。 */
interface Boxed<T> {
  /** 作用域代次：每次换会话 +1。用代次而不是 sid，是因为 A→B→A 也要复位。 */
  epoch: number
  value: T
}

/**
 * 会话作用域的 `useState`：`scope` 一变，值回到 `initial`。
 *
 * 复位是**读的时候判定**的，不是渲染期 `setState`：`setState` 在渲染期会触发
 * React 的 render-phase 更新循环（同一个 fiber 再跑一遍），而这个组件体有 4000 行，
 * 每次换会话多跑一整遍就是白送的开销。这里只在比较代次，代价是两次整数比较。
 *
 * @param scope 作用域键（会话 id）
 * @param initial 初值或惰性初值（每次重置时重新求值）
 * @returns 与 `useState` 同签名的 `[value, setValue]`
 */
export function useSessionState<T>(
  scope: string,
  initial: T | (() => T),
): readonly [T, Dispatch<SetStateAction<T>>] {
  /** 本次作用域的初值与本代次：初值只求一次（滚动/渲染期都不重复算）。 */
  const scoped = useRef<{ epoch: number; scope: string; value: T } | undefined>(undefined)
  if (scoped.current === undefined) {
    scoped.current = { epoch: 0, scope, value: resolve(initial) }
  } else if (scoped.current.scope !== scope) {
    scoped.current = { epoch: scoped.current.epoch + 1, scope, value: resolve(initial) }
  }
  const current = scoped.current
  const [box, setBox] = useState<Boxed<T>>(() => ({ epoch: current.epoch, value: current.value }))
  // 代次不同 = 这份 box 属于上一场：这一帧直接读本场初值（不写 state，也不多渲染一遍）。
  const value = box.epoch === current.epoch ? box.value : current.value
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setBox((previous) => {
      // 函数式更新要从**本场**的当前值算起，不能拿上一场的 box 当底。
      const base = previous.epoch === scoped.current!.epoch ? previous.value : scoped.current!.value
      return {
        epoch: scoped.current!.epoch,
        value: typeof next === 'function' ? (next as (current: T) => T)(base) : next,
      }
    })
  }, [])
  return [value, setValue] as const
}

/**
 * 会话作用域的 `useRef`：`scope` 一变，`current` 回到 `initial`。
 *
 * 引用不像 state 那样会被 React 重置，而聊天页里有十几处「按轮号记账」的引用
 * （见过的收工轮号、过程条快照、锚点、定位意图）。轮号在各会话里独立编号，所以
 * 这些记账跨会话复用会把 A 的 turn N 当成 B 的 turn N——必须随作用域归零。
 *
 * @param scope 作用域键（会话 id）
 * @param initial 初值或惰性初值（每次重置时重新求值）
 * @returns 与 `useRef` 同形的可变引用
 */
export function useSessionRef<T>(scope: string, initial: T | (() => T)): MutableRefObject<T> {
  // 引用对象本身**跨会话不变**（只换它的 `.current`）：`useCallback([])` 里捕获了这些
  // 引用的老闭包（帧分发器、滚动回调）换了对象就会继续写上一场那个，表现为"状态条
  // 换会话后不动了"。
  const holder = useRef<{ scope: string; current: T } | undefined>(undefined)
  if (holder.current === undefined) {
    holder.current = { scope, current: resolve(initial) }
  } else if (holder.current.scope !== scope) {
    // 渲染期换值：这一次渲染就要用新会话的初值（锚点、定位意图不能晚到下一帧）。
    holder.current.scope = scope
    holder.current.current = resolve(initial)
  }
  return holder.current
}
