/**
 * 用例登记表。新增用例只要在对应分组文件里加一条，不需要改运行器。
 */
import cards from './cards.mjs'
import composer from './composer.mjs'
import entry from './entry.mjs'
import roster from './roster.mjs'
import runs from './runs.mjs'
import scroll from './scroll.mjs'
import search from './search.mjs'
import settings from './settings.mjs'

export const CASES = [...entry, ...scroll, ...cards, ...composer, ...search, ...roster, ...runs, ...settings]

/** 分组名（用于报告与 --groups 过滤）。 */
export const GROUPS = [...new Set(CASES.map(item => item.group))]
