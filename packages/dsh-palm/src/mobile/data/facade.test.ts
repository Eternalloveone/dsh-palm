/**
 * data 门面的护栏（W4-3）：**转出的名字必须真实存在**。
 *
 * 门面最危险的退化不是报错，而是某天 `api.ts` 把函数改名了、门面还转出一个
 * `undefined`——调用点 `fn(...)` 直接 TypeError，而 typecheck 因为两边都用 `export {}`
 * 也不会报（转出的名字不存在时 TS 会报，但**运行时**的值来源仍值得钉一次）。
 *
 * 这里还守另一条更重要的规矩：**每个域只转出自己那批**。门面一旦退化成
 * `export *`，域边界就没了，视图又会开始随机从某个域拿不相干的东西。
 */
import { describe, expect, it } from 'vitest'
import * as api from '../api.ts'
import * as diag from './diag.ts'
import * as fs from './fs.ts'
import * as notify from './notify.ts'
import * as session from './session.ts'
import * as settings from './settings.ts'
import * as usage from './usage.ts'
import * as voice from './voice.ts'
import * as workspace from './workspace.ts'

const DOMAINS: Record<string, Record<string, unknown>> = {
  session: session as unknown as Record<string, unknown>,
  workspace: workspace as unknown as Record<string, unknown>,
  settings: settings as unknown as Record<string, unknown>,
  notify: notify as unknown as Record<string, unknown>,
  fs: fs as unknown as Record<string, unknown>,
  voice: voice as unknown as Record<string, unknown>,
  usage: usage as unknown as Record<string, unknown>,
  diag: diag as unknown as Record<string, unknown>,
}

describe('data 门面', () => {
  it('每个转出的名字在 api.ts 里都真实存在且是函数', () => {
    for (const [domain, facade] of Object.entries(DOMAINS)) {
      for (const [name, value] of Object.entries(facade)) {
        expect(typeof value, `${domain}.${name}`).toBe('function')
        expect((api as unknown as Record<string, unknown>)[name], `${domain}.${name} 不在 api.ts 里`).toBe(value)
      }
    }
  })

  it('没有域偷偷改成 `export *`（否则每个域都会暴露 api.ts 的全集）', () => {
    const apiCount = Object.keys(api).length
    for (const [domain, facade] of Object.entries(DOMAINS)) {
      expect(Object.keys(facade).length, `${domain} 域转出了全部 api`).toBeLessThan(apiCount)
    }
  })

  it('同一个函数可以出现在两个域里（视角重叠是允许的），但不能两个域给出不同的东西', () => {
    const seen = new Map<string, string>()
    for (const [domain, facade] of Object.entries(DOMAINS)) {
      for (const name of Object.keys(facade)) {
        const previous = seen.get(name)
        if (previous !== undefined) {
          expect(facade[name], `${name} 在 ${previous} 与 ${domain} 里不一致`).toBe(DOMAINS[previous]?.[name])
        } else {
          seen.set(name, domain)
        }
      }
    }
  })

  it('八域齐全（W4-3 的"8 个域文件"）', () => {
    expect(Object.keys(DOMAINS).sort()).toEqual(['diag', 'fs', 'notify', 'session', 'settings', 'usage', 'voice', 'workspace'])
  })
})
