/**
 * 块注册表（W2-2）：kind → 渲染组件。
 *
 * 这里刻意**不 import 任何具体渲染器**：注册表只是"字典 + 派发"，谁用谁把表传进来。
 * 这样既没有 process ↔ registry 的环，也让插件/实验块能用自己的表扩展（{@link mergeRegistry}），
 * 不必改这个文件。
 *
 * @module dsh-palm/mobile/message-row/block-registry
 */
import type { ComponentType, ReactNode } from 'react'
import type { MessageBlock } from './types.ts'

/** 一个块渲染器：拿到块本身与上下文（消息、高亮词、会话 id 等）。 */
export type BlockRenderer<C> = ComponentType<{ block: MessageBlock; ctx: C }>

/** kind → 渲染器。 */
export type BlockRegistry<C> = Readonly<Record<string, BlockRenderer<C>>>

/** 合并两张表（后者覆盖前者）；用于插件追加自己的块类型。 */
export function mergeRegistry<C>(base: BlockRegistry<C>, extra: BlockRegistry<C>): BlockRegistry<C> {
  return { ...base, ...extra }
}

/**
 * 按顺序渲染块列表。
 *
 * 遇到没注册的 kind 就跳过（**不抛错**）：块来自网络，旧客户端见到新块应该是
 * "少画一块"，不是整条消息白屏。
 */
export function BlockList<C>({ blocks, registry, ctx }: {
  blocks: readonly MessageBlock[]
  registry: BlockRegistry<C>
  ctx: C
}): ReactNode {
  return (
    <>
      {blocks.map((block) => {
        const Renderer = registry[block.kind]
        if (Renderer === undefined) return null
        return <Renderer key={block.key} block={block} ctx={ctx} />
      })}
    </>
  )
}
