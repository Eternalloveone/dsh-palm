/**
 * 样式表「源文件 ↔ 生成物」一致性的自检（W1-3）。
 *
 * mobile-styles.ts 现在是生成物：真源是 styles/*.css，`pnpm gen:css` 负责拼接。
 * 两道口子都要堵：
 * 1. 有人改了 styles/*.css 却忘了跑生成 → 页面拿到的是旧样式（改了没效果，最迷惑）；
 * 2. 有人直接改 mobile-styles.ts → 下次生成就被覆盖（改了个寂寞）。
 *
 * 判据比对的是**磁盘上的生成文件**（不是运行时拿到的字符串）：生成文件必须以
 * 「按文件名排序拼接后的全部区块 + 收尾反引号」结束。这样不受打包器对模板串做
 * 的换行归一影响。
 *
 * @module dsh-palm/mobile/mobile-styles.freshness.test
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = import.meta.dirname
const STYLES_DIR = join(HERE, 'styles')
const GENERATED = join(HERE, 'mobile-styles.ts')
const FILES = readdirSync(STYLES_DIR).filter(name => name.endsWith('.css')).sort()

describe('样式表生成物与源文件一致', () => {
  it('styles/ 下是按名字排序的一组区块文件', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(30)
    for (const name of FILES) {
      expect(name, `${name} 应以三位数字前缀开头`).toMatch(/^\d{3}-[a-z0-9-]+\.css$/)
      const text = readFileSync(join(STYLES_DIR, name), 'utf8')
      expect(text.startsWith('/* ── '), `${name} 应以区块横幅开头`).toBe(true)
    }
  })

  it('生成文件以「全部区块拼接 + 收尾反引号」结束（改了没重新生成会在这里红）', () => {
    const body = FILES
      .map(name => readFileSync(join(STYLES_DIR, name), 'utf8'))
      .join('')
      .replace(/\r\n/g, '\n')
      // 生成器要把正文转义成模板字符串的内容（反斜杠 / 反引号 / `${` 各加一层）。
      // 这里不跟着转义，注释里写一个带反引号的类名就会让这条假红（2026-11-10）。
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${')
    const generated = readFileSync(GENERATED, 'utf8').replace(/\r\n/g, '\n')
    expect(generated.endsWith(body + '`;\n')).toBe(true)
  })
})
