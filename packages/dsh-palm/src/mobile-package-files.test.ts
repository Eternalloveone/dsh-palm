// @vitest-environment node
/**
 * 发布包完整性：**路由会从磁盘读的每个产物，必须都在 `package.json` 的 `files` 里**。
 *
 * 由来（issue #12，2026-11-25）：2.0.0 把手机端样式表改成独立产物
 * `lib/mobile/app.css`，而 `files` 只白名单了 `lib/**\/*.js` 与 `lib/**\/*.d.ts` ——
 * 样式表没被打进 tarball。装上 npm 包的人打开 `/m/`：`ensureCss()` 读不到文件 →
 * `pageHtml()` 连 `<link rel=stylesheet>` 都不输出 → 整页没有样式，且不报错。
 *
 * 这类 bug 的共同形状是"构建产物有了新后缀，打包白名单没跟上"，所以判据不写成
 * "assert app.css 在 files 里"，而是把**取文件的代码**抄成一张清单，逐条核对。
 *
 * @module dsh-palm/mobile-package-files.test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PKG = join(import.meta.dirname, '..')
const files: string[] = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).files

/** 极简 glob → 正则：只支持 `**`（含 `**\/` 吃零到多级目录）与 `*`。 */
function toRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    if (glob[i] === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        out += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else {
        out += '[^/]*'
      }
      continue
    }
    out += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** npm `files` 语义：后出现的 `!` 规则可以再排除掉。 */
function covered(rel: string): boolean {
  let hit = false
  for (const entry of files) {
    const negated = entry.startsWith('!')
    const pattern = negated ? entry.slice(1) : entry
    const matched = pattern.includes('*')
      ? toRegExp(pattern).test(rel)
      : rel === pattern || rel.startsWith(pattern + '/')
    if (matched) hit = !negated
  }
  return hit
}

/**
 * 路由从磁盘读的产物 → 取它的代码。
 * 新增任何"运行时读文件"的分支，这张表要跟着长一行。
 */
const RUNTIME_ARTIFACTS: [path: string, reader: string][] = [
  ['lib/mobile.js', 'mobileBundlePath()'],
  ['lib/mobile/ChatView-7jfN0WGd.js', 'mobileChunkPath()'],
  ['lib/mobile/app.css', 'mobileCssPath()'],
  ['assets/apple-touch-icon.png', 'mobileAssetPath()'],
  ['assets/skins/manifest.json', 'skin-assets.ts 的 MANIFEST_URL'],
  ['assets/skins/nocturne/sky.jpg', 'skin-assets.ts 的 SKIN_DIR_URL'],
]

describe('发布包完整性：运行时读的产物都要打进包', () => {
  it.each(RUNTIME_ARTIFACTS)('%s（%s）在白名单里', (rel) => {
    expect(covered(rel), `package.json 的 files 没有覆盖 ${rel}，装包后会 404 / 静默降级`).toBe(true)
  })

  it('白名单确实在过滤（不然上面几条是假通过）', () => {
    expect(covered('src/mobile-routes.ts')).toBe(false)
    expect(covered('lib/mobile/app.css.map')).toBe(false)
  })
})
