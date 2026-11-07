/**
 * 布局契约：**排布是数据，组件是插槽**。
 *
 * 目标（见 docs/refactor-master-plan.md 第三/四节）：
 * - 换排布只加一个 layout 数据文件，不动任何业务组件；
 * - 每个必填槽必须被排布恰好使用一次，否则立刻报错；
 * - 排布数据里不允许出现函数（那就是逻辑，不属于排布）。
 *
 * @module dsh-palm/mobile/ui/slot-layout
 */
import type { ReactNode } from 'react'

/** 排布中的一块：引用一个槽位名。 */
export interface LayoutBlock {
  /** 槽位名，需与调用方传入的 slots 键一致。 */
  slot: string
  /** 是否吃掉剩余空间（列表/滚动区）。 */
  grow?: boolean
}

/** 一份排布：有序区块 + 必填槽声明。 */
export interface LayoutSpec {
  /** 版式标识，便于测试与调试输出。 */
  name: string
  blocks: readonly LayoutBlock[]
  /** 必须出现且只出现一次的槽。 */
  required: readonly string[]
}

/** 校验失败时抛出的错误（携带全部问题，便于一次改完）。 */
export class LayoutContractError extends Error {
  constructor(readonly problems: string[]) {
    super(`布局契约不满足：\n- ${problems.join('\n- ')}`)
    this.name = 'LayoutContractError'
  }
}

/**
 * 校验排布与插槽是否对得上。
 * 纯函数，不碰 React，便于在构建期与测试里直接调用。
 */
export function validateLayout(
  spec: LayoutSpec,
  slots: Readonly<Record<string, ReactNode>>,
): string[] {
  const problems: string[] = []
  const used = spec.blocks.map(block => block.slot)

  for (const name of spec.required) {
    const count = used.filter(slot => slot === name).length
    if (count === 0) problems.push(`必填槽 "${name}" 没有被排布使用`)
    if (count > 1) problems.push(`必填槽 "${name}" 被使用了 ${count} 次（必须恰好一次）`)
  }

  const declared = new Set([...spec.required, ...used])
  for (const name of Object.keys(slots)) {
    if (!declared.has(name)) problems.push(`插槽 "${name}" 提供了但没有排布引用（写了不渲染）`)
  }

  for (const block of spec.blocks) {
    if (!(block.slot in slots)) problems.push(`排布引用了不存在的插槽 "${block.slot}"`)
  }

  const seen = new Set<string>()
  for (const block of spec.blocks) {
    if (seen.has(block.slot)) problems.push(`排布重复引用插槽 "${block.slot}"`)
    seen.add(block.slot)
  }

  return problems
}

/** 排布必须是可序列化数据：出现函数即视为把逻辑塞进了版式。 */
export function assertDataOnly(spec: LayoutSpec): string[] {
  const problems: string[] = []
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'function') problems.push(`${path} 是函数（排布必须纯数据）`)
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`))
    else if (value !== null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) walk(nested, `${path}.${key}`)
    }
  }
  walk(spec, spec.name || 'layout')
  return problems
}

/** 按排布渲染插槽；契约不满足时直接抛错（早失败，别默默少渲染）。 */
export function SlotLayout({
  spec,
  slots,
  className,
}: {
  spec: LayoutSpec
  slots: Readonly<Record<string, ReactNode>>
  className?: string
}) {
  const problems = [...assertDataOnly(spec), ...validateLayout(spec, slots)]
  if (problems.length > 0) throw new LayoutContractError(problems)

  return (
    <div className={className} data-layout={spec.name}>
      {spec.blocks.map(block => (
        <div key={block.slot} data-slot={block.slot} data-grow={block.grow ? '' : undefined}>
          {slots[block.slot]}
        </div>
      ))}
    </div>
  )
}
