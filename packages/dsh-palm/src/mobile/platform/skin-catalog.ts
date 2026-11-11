/**
 * 皮肤目录（展示用元数据）：名字、一句话说明、**来源与许可**、预览色。
 *
 * 为什么要跟 `platform/skin.ts` 分开：那个文件是运行时开关（读写 data-skin、落盘、
 * 广播），这里只描述"商店里怎么摆一张卡片"。以后从 dsh-skin-market 移植皮肤时，
 * 新增一张卡片 = 往这里加一条 + 在 000-tokens.css 加一块色板，运行时逻辑一行不改。
 *
 * 来源必须写清楚（2026-11-11 用户要求「每张卡片显示来源和作者 · 许可」）：手机端
 * 以后会有大量移植自社区的作品，署名和许可是硬要求，不能只在 README 里写。
 *
 * @module dsh-palm/mobile/platform/skin-catalog
 */
import type { MobileSkin } from './skin.ts'

/** 一张皮肤卡片。 */
export interface SkinCatalogEntry {
  id: MobileSkin
  /** 卡片上的名字（中文，界面上一律说人话）。 */
  label: string
  /** 一句话说明这套皮肤的气质（不写形容词堆砌）。 */
  hint: string
  /** 来源署名：「手机端自带」或「来自 <作者/仓库> · <许可>」。 */
  source: string
  /** 是否内置（内置的不用加载，永远可用）。 */
  builtin: boolean
}

/** 全部可选皮肤（顺序即商店里的顺序）。 */
export const SKIN_CATALOG: readonly SkinCatalogEntry[] = [
  {
    id: 'graphite',
    label: '石墨',
    hint: '深灰底 + 靛蓝强调，默认的一套',
    source: '手机端自带 · MIT',
    builtin: true,
  },
  {
    id: 'paper',
    label: '纸',
    hint: '浅色偏暖，白天看得舒服',
    source: '手机端自带 · MIT',
    builtin: true,
  },
  {
    id: 'nocturne',
    label: '夜航',
    hint: '深蓝底 + 青色强调，晚上不刺眼',
    source: '手机端自带 · MIT',
    builtin: true,
  },
  {
    id: 'newsprint',
    label: '报纸',
    hint: '暖白纸面 + 衬线正文，像在读报',
    // 移植自社区作品：署名与许可是硬要求（2026-11-11 用户要求）。
    source: '来自 2754LM/dsh-theme-newsprint · MIT',
    builtin: false,
  },
  {
    id: 'endfield',
    label: '终末地',
    hint: '奶油纸底 + 信号黄，全直角工业感',
    source: '来自 ymh0000123/dsh-theme-endfield · MIT',
    builtin: false,
  },
  {
    id: 'claude',
    label: 'Claude',
    hint: '米白纸面 + 陶土橙，像 Claude 桌面',
    source: '来自 Nwflower/dsh-claude-style · MIT',
    builtin: false,
  },
]

/** 按 id 取一条；查不到返回 undefined（调用方自己决定怎么兜底）。 */
export function skinEntryOf(id: MobileSkin): SkinCatalogEntry | undefined {
  return SKIN_CATALOG.find(entry => entry.id === id)
}
