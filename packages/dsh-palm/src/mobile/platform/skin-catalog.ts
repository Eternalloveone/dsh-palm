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
  {
    id: 'matrix',
    label: 'Matrix 骇客帝国',
    hint: '墨绿数字雨，深夜护眼暗色',
    // 移植自 dsh-web 皮肤包（桌面皮肤中心）：作者 seanchen，随仓库 Apache-2.0 分发。
    source: '来自 dsh-web 皮肤包（seanchen）· Apache-2.0',
    builtin: false,
  },
  {
    id: 'xp',
    label: 'Windows XP',
    hint: 'Luna 蓝窗口条 + 绿色开始按钮，全直角',
    // 移植自 dsh-web 皮肤包（桌面皮肤中心）：随仓库 Apache-2.0 分发。
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'deep-current',
    label: '深流',
    hint: '深海墨绿 + 珍珠白，亮暗都克制',
    source: '来自 dsh-web 皮肤包（Twelveeee）· Apache-2.0',
    builtin: false,
  },
  {
    id: 'mint',
    label: '薄荷',
    hint: '官方配色换色版，零脚本最轻',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'pink-sakura',
    label: '粉樱',
    hint: '奶油粉 + 玫瑰强调，克制不腻',
    source: '来自 dsh-web 皮肤包（guomengjia618-dot）· Apache-2.0',
    builtin: false,
  },
  {
    id: 'summer-liquid-glass',
    label: '夏沫琉璃',
    hint: '日系夏祭 + 液态玻璃面板',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'furina',
    label: '芙宁娜',
    hint: '芙宁娜插画背景 + 淡蓝主题',
    source: '来自 dsh-web 皮肤包（zhu1090093659）· BSD-3-Clause',
    builtin: false,
  },
  {
    id: 'minecraft',
    label: 'Minecraft 方块世界',
    hint: '方块栅格 + 直角，像素感',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'trading',
    label: '交易终端',
    hint: '红涨绿跌的行情终端',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'cyber-night',
    label: '赛博夜城',
    hint: '霓虹青品双色，深墨面板',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'wallpaper-exclusive',
    label: '壁纸专属',
    hint: '纯玻璃面板，专配背景图',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'whale-song',
    label: '鲸吟',
    hint: '深海鲸语，冰蓝金线',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'harbor',
    label: '夕港',
    hint: '黄昏港湾，暖橘灯火',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'war-thunder',
    label: '战争雷霆',
    hint: '军绿铁灰，弹药黄',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'blue-fantasy',
    label: '蓝色幻想',
    hint: '深蓝梦境，冰光高光',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'dragon-heir',
    label: '龙的传人',
    hint: '朱砂红 + 长城砖，龙印点缀',
    source: '来自 dsh-web 皮肤包 · Apache-2.0',
    builtin: false,
  },
  {
    id: 'maid-atelier',
    label: '女仆工坊',
    hint: '奶油粉白，蕾丝边',
    source: '来自 @linxin666\dsh-client-ui-skin-center\skins\maid-atelier\skin.css · MIT',
    builtin: false,
  },
  {
    id: 'whale-mom',
    label: '鲸鱼妈妈',
    hint: '冰蓝浅海，温柔奶白',
    source: '来自 @linxin666\dsh-client-ui-skin-center\skins\whale-mom\skin.css · MIT',
    builtin: false,
  },
]

/** 按 id 取一条；查不到返回 undefined（调用方自己决定怎么兜底）。 */
export function skinEntryOf(id: MobileSkin): SkinCatalogEntry | undefined {
  return SKIN_CATALOG.find(entry => entry.id === id)
}
