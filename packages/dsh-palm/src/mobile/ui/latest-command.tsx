/**
 * 折叠态下的「当前命令」：**一条位置与高度都固定的行**。
 *
 * 为什么要有它（2026-11-10 第二次投诉）：过程条在折叠时会把每个活动工具行
 * 直接铺在下面，第 8 条一来列表就长高 18px，状态栏、过程条、正文全被顶下去 ——
 * 用户的原话是"跳来跳去，非常不稳定"。
 *
 * 三条硬规则：
 * 1. **高度锁死**：外层写死一行高，进出都不改布局，超长走省略号；
 * 2. **交叉淡化**：旧命令淡出（上移 3px）、新命令淡入（下移 3px）同时 320ms，
 *    不是"删一个再插一个"；
 * 3. **只在折叠态用**：展开后仍是完整清单；失败/中断的行照旧直接可见（那必须
 *    一眼看见，不能藏在一条"最新命令"里）。
 *
 * @module dsh-palm/mobile/ui/latest-command
 */
import { useEffect, useState } from 'react'

/** 淡入淡出的时长：与样式表里的 animation 时长一致，超时就清掉离场层。 */
const FADE_MS = 320

/** 「当前命令」的 props。 */
export interface LatestCommandProps {
  /** 最新一条命令的文案（标题 + 摘要，单行）。 */
  text: string
  /** 这一行代表的过程状态（落到 `data-state`，给状态点配色）。 */
  state?: string
}

/**
 * 渲染一条固定的「当前命令」。
 *
 * @param props - 文案与状态
 * @returns 固定高度的单行（读屏直接读最新那条）
 */
export function LatestCommand({ text, state }: LatestCommandProps) {
  const [shown, setShown] = useState(text)
  const [leaving, setLeaving] = useState<string | undefined>(undefined)

  // 换文案：把旧的那条交给离场层，新的进主位（两层同时存在 → 真交叉淡化）。
  useEffect(() => {
    if (text === shown) return
    setLeaving(shown)
    setShown(text)
  }, [text, shown])

  // 分离的计时：离场层只活 FADE_MS。放在第二个 effect 里，避免"换文案那次
  // 渲染立刻把刚设的计时器清掉"（第一版就是这么写的，离场层永远不消失）。
  useEffect(() => {
    if (leaving === undefined) return
    const timer = setTimeout(() => { setLeaving(undefined) }, FADE_MS)
    return () => { clearTimeout(timer) }
  }, [leaving])

  return (
    <p className="chat-cmdline" data-state={state ?? 'unknown'} role="status" aria-label={text}>
      <span className="chat-cmdline-mark" aria-hidden="true" />
      <span className="chat-cmdline-text">
        {leaving === undefined ? null : (
          <span className="chat-cmdline-item" data-phase="out" key={`out-${leaving}`}>{leaving}</span>
        )}
        <span className="chat-cmdline-item" data-phase="in" key={`in-${shown}`}>{shown}</span>
      </span>
    </p>
  )
}
