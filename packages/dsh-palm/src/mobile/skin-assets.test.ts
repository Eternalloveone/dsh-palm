// @vitest-environment node
/**
 * 皮肤素材清单的守卫（L2 素材转接层）。
 *
 * 素材和代码的许可是两件事：代码随仓库 Apache-2.0，插画/图标/徽章往往另有出处。
 * 所以清单是**三层闸门**，每层都要有测试拦着：
 *   ① 皮肤级：`license` + `source` 缺一个，服务端就不对外提供（fail-closed）；
 *   ② 素材级：每条要 `role`（illustration/texture/icon/badge/border）+ `credit`；
 *   ③ 体量级：一套皮肤素材合计 ≤ 300 KB —— 图标和九宫格边框一上，包体会涨得比想象快。
 *
 * 另外防三种「静默变差」：目录里丢图忘登记、登记的 id 不是真皮肤、装饰层写了个
 * 清单里没有的素材 URL（拼错一个字母，效果会静默消失）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveSkinAsset, type SkinArtRole, type SkinAssetManifest } from '../skin-assets.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MANIFEST = join(ROOT, 'assets/skins/manifest.json')
const SKINS_DIR = join(ROOT, 'assets/skins')
const STYLES_DIR = join(ROOT, 'src/mobile/styles')

/** 每套皮肤素材的体量上限（字节）。300 KB 是「插画一张 + 图标若干」的合理天花板。 */
const PER_SKIN_BUDGET = 300 * 1024

const ROLES: readonly SkinArtRole[] = ['illustration', 'texture', 'icon', 'badge', 'border']

const readManifest = (): SkinAssetManifest => JSON.parse(readFileSync(MANIFEST, 'utf8')) as SkinAssetManifest
const entries = () => Object.entries(readManifest().skins ?? {})

describe('皮肤素材清单', () => {
  it('清单存在且能解析', () => {
    expect(existsSync(MANIFEST)).toBe(true)
    expect(() => readManifest()).not.toThrow()
  })

  it('① 皮肤级：每条都写了 license 与 source', () => {
    const missing: string[] = []
    for (const [id, entry] of entries()) {
      if (!entry.license) missing.push(`${id}: license`)
      if (!entry.source) missing.push(`${id}: source`)
    }
    expect(missing).toEqual([])
  })

  it('② 素材级：每条都写了合法的 role 与 credit', () => {
    const bad: string[] = []
    for (const [id, entry] of entries()) {
      for (const art of entry.art ?? []) {
        const label = `${id}/${art.file ?? '(no file)'}`
        if (!art.file) bad.push(`${label}: file`)
        if (!ROLES.includes(art.role as SkinArtRole)) bad.push(`${label}: role=${String(art.role)}`)
        if (!art.credit || art.credit.trim() === '') bad.push(`${label}: credit`)
      }
    }
    expect(bad).toEqual([])
  })

  it('③ 体量级：每套皮肤素材合计 ≤ 300 KB', () => {
    const over: string[] = []
    for (const [id, entry] of entries()) {
      const bytes = (entry.art ?? []).reduce((sum, art) => {
        const abs = join(SKINS_DIR, id, art.file ?? '')
        return sum + (existsSync(abs) ? statSync(abs).size : 0)
      }, 0)
      if (bytes > PER_SKIN_BUDGET) over.push(`${id}: ${Math.round(bytes / 1024)} KB`)
    }
    expect(over).toEqual([])
  })

  it('登记的皮肤 id 都是真实存在的皮肤', () => {
    const skinSource = readFileSync(join(ROOT, 'src/mobile/platform/skin.ts'), 'utf8')
    const ids = Object.keys(readManifest().skins ?? {})
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(skinSource.includes(`'${id}'`), `${id} 不在 MobileSkin 里`).toBe(true)
    }
  })

  it('文件名安全（无路径分隔符、无 ..）且文件真实存在', () => {
    for (const [id, entry] of entries()) {
      for (const art of entry.art ?? []) {
        const file = art.file ?? ''
        expect(/^[a-z0-9][a-z0-9._-]*$/i.test(file), `${id}/${file} 名字不合法`).toBe(true)
        expect(file.includes('..'), `${id}/${file} 含 ..`).toBe(false)
        expect(existsSync(join(SKINS_DIR, id, file)), `${id}/${file} 文件不存在`).toBe(true)
      }
    }
  })

  it('目录里没有未登记的孤儿素材', () => {
    const declared = new Set<string>()
    for (const [id, entry] of entries()) {
      for (const art of entry.art ?? []) declared.add(`${id}/${art.file}`)
    }
    const orphans: string[] = []
    for (const dir of readdirSync(SKINS_DIR)) {
      const abs = join(SKINS_DIR, dir)
      if (!statSync(abs).isDirectory()) continue
      for (const file of readdirSync(abs)) {
        if (!declared.has(`${dir}/${file}`)) orphans.push(`${dir}/${file}`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('装饰层引用的每个素材 URL 都在清单里（拼错一个字母也不会静默失效）', () => {
    const manifest = readManifest()
    const broken: string[] = []
    for (const name of readdirSync(STYLES_DIR).filter(n => n.endsWith('.css'))) {
      const css = readFileSync(join(STYLES_DIR, name), 'utf8')
      for (const match of css.matchAll(/\/m\/skin-assets\/[^\s'")]+/g)) {
        if (resolveSkinAsset(match[0], manifest) === null) broken.push(`${name}: ${match[0]}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('边框素材在清单里写明九宫格参数，且装饰层的数字与它一致', () => {
    const manifest = readManifest()
    const problems: string[] = []
    for (const [id, entry] of entries()) {
      for (const art of entry.art ?? []) {
        if (art.role !== 'border') continue
        const frame = art.frame
        const label = `${id}/${art.file ?? ''}`
        if (!frame || typeof frame.slice !== 'number' || typeof frame.width !== 'number') {
          problems.push(`${label}: 缺 frame.slice / frame.width`)
          continue
        }
        if (frame.slice < 2 || frame.slice > 40) problems.push(`${label}: slice=${frame.slice} 越界`)
        if (frame.width < 1 || frame.width > 16) problems.push(`${label}: width=${frame.width} 越界`)
        // 装饰层用这张图时，border-image 的数字必须和清单一致，否则边会糊/被切
        const url = `/m/skin-assets/${id}/${art.file ?? ''}`
        for (const name of readdirSync(STYLES_DIR).filter(n => n.endsWith('.css'))) {
          const css = readFileSync(join(STYLES_DIR, name), 'utf8')
          if (!css.includes(url)) continue
          const expected = `${frame.slice} / ${frame.width}px`
          if (!css.includes(expected)) problems.push(`${name}: border-image 应写 ${expected}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
