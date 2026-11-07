#!/usr/bin/env node
/**
 * 把手机端样式表编译成独立产物（W1-1）。
 *
 * 之前 CSS 是一个 TS 模板串，启动时手建 <style> 注入：9,627 行 / ~210 KB 全在
 * JS bundle 里（冷启动要解析、编辑器没有 CSS 支持、lightningcss 用不上），还逼着
 * CSP 保留 `style-src 'unsafe-inline'`。
 *
 * 现在构建期产出 `lib/mobile/app.css`（+ `.hash`），由 /m/assets/app.css?v=<hash>
 * 以 immutable 提供，页面用 <link> 引入。
 *
 * 真源暂时仍是 src/mobile/mobile-styles.ts；W1-3 把它拆成 src/mobile/styles/*.css
 * 后，本脚本改成读目录即可，交付方式不变。
 */
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'

const OUT_DIR = fileURLToPath(new URL('../lib/mobile/', import.meta.url))
const OUT_CSS = fileURLToPath(new URL('../lib/mobile/app.css', import.meta.url))
const OUT_HASH = OUT_CSS + '.hash'
const SOURCE = new URL('../src/mobile/mobile-styles.ts', import.meta.url)

/**
 * 读样式源。正常走 Node 的类型剥离直接 import；老 Node 不支持时退回文本抽取
 * （源文件里没有 `${`，只有两端定界反引号，抽取是安全的）。
 */
async function loadCss() {
  try {
    const mod = await import(SOURCE.href)
    if (typeof mod.mobileCss === 'string' && mod.mobileCss.length > 0) return mod.mobileCss
  } catch (error) {
    const source = await readFile(SOURCE, 'utf8')
    const match = /export const mobileCss = `([\s\S]*)`\s*$/.exec(source)
    if (match === null) throw error
    return match[1]
  }
  throw new Error('build-css: mobile-styles.ts 没有可用的 mobileCss 导出')
}

const css = await loadCss()
const { code, warnings } = transform({
  filename: 'app.css',
  code: Buffer.from(css, 'utf8'),
  minify: true,
  // 手机端基线：iOS 15+ / Chrome 100+。低于这个线才需要前缀，别为它加体积。
  targets: { chrome: 100 << 16, safari: 15 << 16, firefox: 100 << 16, edge: 100 << 16 },
})

for (const warning of warnings) console.warn('[build-css] ' + warning.message)

const hash = createHash('sha1').update(code).digest('hex').slice(0, 8)
await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_CSS, code)
await writeFile(OUT_HASH, hash + '\n')
console.log(
  '[build-css] lib/mobile/app.css ' + (code.length / 1024).toFixed(2) + ' kB (hash ' + hash + ')',
)
