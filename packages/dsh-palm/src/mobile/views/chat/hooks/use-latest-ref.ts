/**
 * **把最新值装进 ref**（S2-K）。
 *
 * 常见写法是：
 *
 * ```ts
 * const ref = useRef(value)
 * useEffect(() => { ref.current = value }, [value])   // ← 一个 effect 只干这件事
 * ```
 *
 * 这个 effect **没有任何副作用**，它只是"让 ref 追上 value"。改成在渲染期赋值即可：
 * ref 不是渲染输出，赋值不会造成不一致，却少了一次提交后的额外渲染周期。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-latest-ref
 */
import { useRef, type MutableRefObject } from 'react'

/** @returns 一个始终等于最新 `value` 的 ref。 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value
  return ref
}
