/**
 * mobile-styles: every `var(--x)` the sheet uses must actually be defined.
 *
 * A shorthand that references an undefined custom property is silently dropped
 * by the browser, so the element renders with no border, no background and no
 * colour — which is exactly what happened to the voice sheet's 取消 button (its
 * only way out looked like plain text). Nothing catches that at build time, so
 * this test does.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Custom properties the sheet reads without a fallback.
 *
 * `var(--x, #fff)` degrades gracefully when `--x` is missing, so it is not a
 * defect; `var(--x)` alone drops the whole declaration.
 */
function usedVars(css: string): Set<string> {
  const used = new Set<string>()
  for (const match of css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*\)/g)) {
    if (match[1] !== undefined) used.add(match[1])
  }
  return used
}

/** Custom properties the sheet declares. */
function definedVars(css: string): Set<string> {
  const defined = new Set<string>()
  for (const match of css.matchAll(/(^|[\s;{(])(--[A-Za-z0-9-]+)\s*:/g)) {
    if (match[2] !== undefined) defined.add(match[2])
  }
  return defined
}

describe('mobile-styles custom properties', () => {
  it('never references a custom property it does not define', () => {
    const css = readFileSync(new URL('./mobile-styles.ts', import.meta.url), 'utf8')
    const missing = [...usedVars(css)].filter(name => !definedVars(css).has(name)).sort()
    expect(missing).toEqual([])
  })
})
