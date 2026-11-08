/**
 * 交付详情页的分组与汇总（纯投影）。
 *
 * 页面只负责画：把「这一轮交付了什么」折成三组清单和顶部汇总的事放在这里，
 * 与 `ui/delivery-card` 的归属口径一致（交付物优先，已在第一组列过的路径
 * 不再进改动组）。不碰 React、不碰数据层。
 *
 * @module dsh-palm/mobile/render/delivery-groups
 */
import { baseName, type DeliveryDeliverable, type DeliveryFileChange } from '../ui/delivery-card.tsx'

/** 一行文件：路径 + 图标 + 可选增删统计 + 可选标签。 */
export type DeliveryRow = {
  key: string; path: string; name: string; icon: 'folder' | 'plus' | 'pencil'
  adds?: number; dels?: number; badge?: string
}

/** 三个分组的稳定 key（默认展开第一组）。 */
export type GroupKind = 'deliverables' | 'added' | 'modified'

/** 一个分组：标题里带条数，空组已被过滤掉。 */
export interface DeliveryGroup { key: GroupKind; title: string; rows: readonly DeliveryRow[] }

/** 顶部汇总：文件数 / 增删合计 / 是否有 tally（拿不到就不画增删）。 */
export interface DeliveryTotals { files: number; adds: number; dels: number; hasTally: boolean }

/** 新增 = 有增删统计且删除为 0；其余（含拿不到统计的）都归「修改」。 */
function isAdded(change: DeliveryFileChange): boolean {
  return change.adds !== undefined && change.dels === 0
}

/**
 * 折出三组清单（空组不返回）。
 *
 * @param facts - 交付物与带 tally 的改动
 * @returns 交付物 / 新增 / 修改三组，按此顺序
 */
export function deliveryGroups(facts: {
  deliverables: readonly DeliveryDeliverable[]
  changes: readonly DeliveryFileChange[]
}): DeliveryGroup[] {
  const declared = new Set(facts.deliverables.map(file => file.path))
  const changed = facts.changes.filter(change => !declared.has(change.path))
  const added = changed.filter(isAdded)
  const modified = changed.filter(change => !isAdded(change))
  const groups: DeliveryGroup[] = [
    {
      key: 'deliverables',
      title: `交付物 · ${facts.deliverables.length}`,
      rows: facts.deliverables.map(file => ({
        key: `d:${file.path}`, path: file.path, icon: 'folder', badge: '交付物',
        name: file.description ?? baseName(file.path),
      })),
    },
    {
      key: 'added',
      title: `新增 · ${added.length}`,
      rows: added.map(change => ({
        key: `a:${change.path}`, path: change.path, name: change.path, icon: 'plus',
        ...(change.adds === undefined ? {} : { adds: change.adds }),
      })),
    },
    {
      key: 'modified',
      title: `修改 · ${modified.length}`,
      rows: modified.map(change => ({
        key: `m:${change.path}`, path: change.path, name: change.path, icon: 'pencil',
        ...(change.adds === undefined ? {} : { adds: change.adds }),
        ...(change.dels === undefined ? {} : { dels: change.dels }),
      })),
    },
  ]
  return groups.filter(group => group.rows.length > 0)
}

/**
 * 顶部汇总：文件数 = 交付物 ∪ 改动；增删只累加改动组（交付物没有 tally）。
 *
 * @param facts - 交付物与带 tally 的改动
 * @returns 汇总数字
 */
export function deliveryTotals(facts: {
  deliverables: readonly DeliveryDeliverable[]
  changes: readonly DeliveryFileChange[]
}): DeliveryTotals {
  const declared = new Set(facts.deliverables.map(file => file.path))
  const changed = facts.changes.filter(change => !declared.has(change.path))
  return {
    files: new Set([...declared, ...facts.changes.map(change => change.path)]).size,
    adds: changed.reduce((sum, change) => sum + (change.adds ?? 0), 0),
    dels: changed.reduce((sum, change) => sum + (change.dels ?? 0), 0),
    hasTally: changed.some(change => change.adds !== undefined || change.dels !== undefined),
  }
}
