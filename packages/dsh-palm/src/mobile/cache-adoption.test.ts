/**
 * 缓存内核的**采纳门禁**（W4-5 收口）。
 *
 * W4-5 之前是「11 个模块各写各的缓存」，谁也说不清哪个过期、哪个会互相踩。现在要求：
 * `src/mobile/**` 下每个 `*cache*.ts` 模块，**要么用内核，要么在
 * {@link CACHE_EXCEPTIONS} 里登记并写清为什么**。
 *
 * 这条断言的价值不在"今天全绿"，而在**明天有人新加缓存时不走内核会被立刻拦下**——
 * 靠人记规矩是记不住的（这个仓库已经有 11 个不同写的缓存为证）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CACHE_EXCEPTIONS, isCacheException } from './kernels/cache-exceptions.ts'

const ROOT = join(import.meta.dirname)

/** 递归找出所有 `*cache*.ts`（排除测试与内核自身）。 */
function cacheModules(dir = ROOT, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      cacheModules(path, found)
      continue
    }
    if (!name.endsWith('.ts')) continue
    if (name.endsWith('.test.ts')) continue
    if (!name.includes('cache')) continue
    const relative = path.slice(ROOT.length + 1).replace(/\\/g, '/')
    if (relative.startsWith('kernels/')) continue
    found.push(relative)
  }
  return found
}

/**
 * 用没用内核，看的是**有没有真的用内核本体**（`kernels/cache.ts` 的 createCache），
 * 而不是"路径里出现 kernels/cache"——策略表是 `kernels/cache-policies.ts`，
 * 读策略不等于用内核实现（history-cache 就是只读策略、落盘在 IndexedDB）。
 */
function usesKernel(source: string): boolean {
  return /from '[^']*kernels\/cache\.ts'/.test(source) || /\bcreateCache\s*\(/.test(source)
}

describe('缓存采纳门禁', () => {
  const modules = cacheModules()

  it('找得到缓存模块（否则这条断言会变成空跑）', () => {
    expect(modules.length).toBeGreaterThan(2)
  })

  it('每个缓存模块要么用内核，要么在例外清单里登记', () => {
    const offKernel = modules.filter(module => {
      if (isCacheException(module)) return false
      return !usesKernel(readFileSync(join(ROOT, module), 'utf8'))
    })
    expect(offKernel, `这些缓存既没用内核、也没登记例外：${offKernel.join(', ')}`).toEqual([])
  })

  it('例外清单没有过期条目（模块还在、且确实没用内核）', () => {
    for (const entry of CACHE_EXCEPTIONS) {
      // 按文件名解析真实路径：清单写在搬家前，写死相对路径会被目录整理打破。
      const actual = modules.find(module => module === entry.module || module.endsWith(`/${entry.module}`))
      expect(actual, `例外 ${entry.module} 指向的模块已经不存在了`).toBeDefined()
      const source = readFileSync(join(ROOT, actual as string), 'utf8')
      expect(usesKernel(source), `${entry.module} 已经用上内核了，请从例外清单删掉`).toBe(false)
    }
  })

  it('例外都必须写清为什么（空理由等于没登记）', () => {
    for (const entry of CACHE_EXCEPTIONS) {
      expect(entry.why.length, `${entry.module} 的 why 太短`).toBeGreaterThan(20)
      expect(entry.freshnessFrom.length, `${entry.module} 没写 freshness 来源`).toBeGreaterThan(5)
    }
  })
})
