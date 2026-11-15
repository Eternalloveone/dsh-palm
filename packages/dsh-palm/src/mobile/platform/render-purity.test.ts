// @vitest-environment node
/**
 * **渲染纯度**：`useMemo` 里不许写 ref（`.current = …`），也不许写模块级缓存。
 *
 * 为什么要有这条闸：React 允许把一次渲染的结果丢掉（被打断、并发、切页、StrictMode
 * 双取）。被丢掉的渲染，DOM 不生效，**但对 ref/模块级单例的写入会留下来**。所以
 * "渲染期顺手把结果写进 ref"这种写法一旦跟"按会话分槽"混在一起，就会出现
 * 「这一帧画的是 A，写进去的却进了 B 的槽」——真机 2026-11-14 19:52 那张挂在
 * 新建会话上的交付卡就是这么来的（账本按 turn 号记，turn 号每场都从 1 起，
 * 串过来之后完全看不出异常）。
 *
 * 允许的写法：`useEffect` / 事件回调 / commit 之后写 ref；`useState(() => …)` 惰性初值。
 * 需要"渲染期算、但只写自己那一场"的数据，用 `session/chat-snapshot.ts` 的
 * `createScopedStore(scope => …)` 语义：写入必须带上**算它时的那个会话 id**。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOBILE = join(import.meta.dirname, '..')

/** 收 src/mobile 下所有源文件（测试不算：它们会故意破坏约定来钉用例）。 */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) { out.push(...sources(abs)); continue }
    if (!/\.tsx?$/.test(name)) continue
    if (/\.test\.tsx?$/.test(name) || name.endsWith('.d.ts')) continue
    out.push(abs)
  }
  return out
}

/**
 * 切出一个调用的实参区间：从 `name(` 的 `(` 开始按括号配平，返回闭区间文本。
 *
 * @param text - 源码
 * @param from - `name(` 里 `(` 的下标
 * @returns 括号内的文本；配平失败返回空串
 */
function callBody(text: string, from: number): string {
  let depth = 0
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(from, index + 1)
    }
  }
  return ''
}

/** 一行号（1-based），给报错定位用。 */
function lineOf(text: string, at: number): number {
  return text.slice(0, at).split('\n').length
}

describe('渲染纯度', () => {
  it('useMemo 里不写 ref.current', () => {
    const offenders: string[] = []
    for (const file of sources(MOBILE)) {
      const text = readFileSync(file, 'utf8')
      let cursor = 0
      for (;;) {
        const hit = text.indexOf('useMemo(', cursor)
        if (hit < 0) break
        const body = callBody(text, hit + 'useMemo'.length)
        cursor = hit + 'useMemo('.length
        if (body === '') continue
        if (!/\.current\s*=[^=]/.test(body)) continue
        offenders.push(`${file.replace(MOBILE, 'src/mobile')}:${lineOf(text, hit)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
