/**
 * 桌面令牌与移动端的一致性断言（W5-4 / ADR 0006）。
 *
 * 这份测试的价值不在"现在通"，而在**一旦有人只改一端就会红**。
 *
 * @module dsh-palm/mobile/design/desktop-parity.test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DESKTOP_CSS_PATH, DESKTOP_TOKEN_PAIRS, KNOWN_DIVERGENCES,
  comparePalettes, divergencesOf, readDesktopPalms,
} from './desktop-parity.ts'
import { DARK_PALETTE, LIGHT_PALETTE } from './tokens.ts'

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..', '..')
const desktopCss = readFileSync(join(PACKAGE_ROOT, DESKTOP_CSS_PATH), 'utf8')
const comparisons = comparePalettes(LIGHT_PALETTE, DARK_PALETTE, readDesktopPalms(desktopCss))

describe('桌面令牌与移动端同源', () => {
  it('映射表里的每个令牌两端都存在（改名/删除会立刻暴露）', () => {
    const missing = comparisons.filter(entry => entry.missing)
      .map(entry => `${entry.mobile} ↔ ${entry.desktop}`)
    expect(missing, '映射表里有令牌在某一端不存在了').toEqual([])
  })

  it('不一致的集合必须恰好等于已知账本（新漂移会红，修好了不更新账本也会红）', () => {
    expect(divergencesOf(comparisons)).toEqual(Object.keys(KNOWN_DIVERGENCES).sort())
  })

  it('账本里每一条都写了原因（不许留空占位）', () => {
    for (const [pair, reason] of Object.entries(KNOWN_DIVERGENCES)) {
      expect(reason.trim().length, `${pair} 缺少原因`).toBeGreaterThan(8)
    }
  })

  it('已经一致的那几对不需要账本条目（账本只记分歧）', () => {
    const same = comparisons.filter(entry => entry.same).map(entry => entry.mobile)
    for (const pair of same) {
      expect(KNOWN_DIVERGENCES[pair], `${pair} 已经一致，不该还在账本里`).toBeUndefined()
    }
  })

  it('映射表本身没有重复项', () => {
    const mobiles = DESKTOP_TOKEN_PAIRS.map(([mobile]) => mobile)
    const desktops = DESKTOP_TOKEN_PAIRS.map(([, desktop]) => desktop)
    expect(new Set(mobiles).size).toBe(mobiles.length)
    expect(new Set(desktops).size).toBe(desktops.length)
  })
})
