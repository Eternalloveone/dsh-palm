// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySkin, getSkin, setSkin, skinPolarity, SKIN_CHROME, SKIN_HINT, SKIN_LABEL, subscribeSkin } from './skin.ts'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-skin')
})

describe('皮肤（六套 + 落盘 + 广播）', () => {
  it('默认是 Claude（2026-11-11 起，用户指定）', () => {
    expect(getSkin()).toBe('claude')
  })

  it('六套皮肤都有中文名与说明（界面上不出现枚举名）', () => {
    for (const key of ['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'] as const) {
      expect(SKIN_LABEL[key]).not.toBe('')
      expect(SKIN_HINT[key]).not.toBe('')
    }
  })

  it('切皮肤会落盘并写到 html[data-skin]', () => {
    setSkin('paper')
    expect(getSkin()).toBe('paper')
    expect(document.documentElement.dataset.skin).toBe('paper')
  })

  it('脏数据回退到默认，不让界面被搞花', () => {
    localStorage.setItem('dsh.palm.skin', 'neon-404')
    expect(getSkin()).toBe('claude')
  })

  it('applySkin 用当前值（启动时调用一次即可）', () => {
    setSkin('nocturne')
    document.documentElement.removeAttribute('data-skin')
    applySkin()
    expect(document.documentElement.dataset.skin).toBe('nocturne')
  })

  it('订阅者会收到变更，退订后不再收到', () => {
    const spy = vi.fn()
    const off = subscribeSkin(spy)
    setSkin('paper')
    expect(spy).toHaveBeenCalledTimes(1)
    off()
    setSkin('nocturne')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

/**
 * 首帧脚本在 host 半（`mobile-routes.ts`）里，皮肤名单写死在那个字符串中。
 * 两边一旦漂移，表现是「首帧用了不存在的皮肤 → 白屏一瞬」或「新皮肤首帧不生效」，
 * 而且构建不会失败。所以直接对着源码比名单。
 */
describe('首帧脚本与皮肤模块不许漂移', () => {
  const readIds = (source: string, name: string): string[] => {
    const raw = new RegExp(`const ${name} = \\[([^\\]]+)\\]`).exec(source)?.[1] ?? ''
    return raw.split(',').map(part => part.trim().replace(/'/g, '')).filter(Boolean).sort()
  }

  it('boot 脚本的 id 名单 = MobileSkin 全集；浅色名单 = 极性为 light 的那些', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const routes = readFileSync(join(process.cwd(), 'src', 'mobile-routes.ts'), 'utf8')

    const all = Object.keys(SKIN_LABEL).sort()
    const light = (Object.keys(SKIN_LABEL) as Array<keyof typeof SKIN_LABEL>)
      .filter(key => skinPolarity(key) === 'light')
      .sort()

    expect(readIds(routes, 'MOBILE_SKIN_IDS'), 'MOBILE_SKIN_IDS 与 MobileSkin 不一致').toEqual(all)
    expect(readIds(routes, 'MOBILE_LIGHT_SKIN_IDS'), 'MOBILE_LIGHT_SKIN_IDS 与 skinPolarity 不一致').toEqual(light)
  })

  it('boot 脚本里的状态栏颜色与 SKIN_CHROME 一致', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const routes = readFileSync(join(process.cwd(), 'src', 'mobile-routes.ts'), 'utf8')
    // 只取 boot 脚本那一段（整份文件里还有离线页等别的色值）。
    const start = routes.indexOf('function bootSkinScript')
    const boot = routes.slice(start, routes.indexOf('\n}', start))

    for (const [skin, chrome] of Object.entries(SKIN_CHROME)) {
      expect(boot, `boot 脚本缺少 ${skin} 的 chrome 色 ${chrome}`).toContain(chrome)
    }
  })
})
