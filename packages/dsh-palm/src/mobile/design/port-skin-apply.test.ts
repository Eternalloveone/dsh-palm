/**
 * `scripts/port-skin.mjs --apply` 的行为测试（2026-11-11 补，用户选 B）。
 *
 * 为什么要有这套：`--apply` 会**直接改三个源码文件**，而它已经连着出过两次事故——
 * ① 联合类型被贪婪正则写坏成 `'endfield | 'claude''`；
 * ② 商店目录的 `hint` / `source` 是猜出来的，`source` 还会被截断成 `来自 …（c49419e`。
 * 这两处都不会让 `--apply` 自己报错，只能靠人肉看；所以这里把「改完之后的源码长什么样」
 * 变成断言：在**临时目录**里复刻一份最小仓库，跑真的 CLI，再读回三个文件逐条检查。
 *
 * 铁律：测试只碰临时目录，绝不写真实源码。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, '../../../scripts/port-skin.mjs')

/** 一份"八个核心角色全有"的桌面皮肤源码（写成 CSS 变量，与 newsprint 同形态）。 */
const FULL_PALETTE = `:root {
  --demo-bg-base: #f7f4ef;
  --demo-bg-layer-1: #fffdf9;
  --demo-bg-layer-2: #efe9e0;
  --demo-border-l1: #e2d9cc;
  --demo-text-primary: #201a15;
  --demo-text-secondary: #5d5348;
  --demo-text-tertiary: #7d7266;
  --demo-brand-primary: #8a4b2a;
  --demo-state-success: #2f6b45;
  --demo-state-warning: #8a5f10;
  --demo-state-error: #a03b4f;
}
`

/** 只有强调色：用来验证"抽不到核心角色时退出码 2"。 */
const THIN_PALETTE = `:root {
  --demo-brand-primary: #8a4b2a;
}
`

const TOKENS_FIXTURE = `:root {
  --palm-bg: #101015;
  --palm-skin-nocturne-bg: #0f1520;
  --palm-skin-nocturne-ink: #22d3ee;
}

html[data-skin='nocturne'] {
  --palm-bg: #0f1520;
}
`

const SKIN_FIXTURE = `export type MobileSkin = 'graphite' | 'nocturne'

export const SKIN_LABEL: Record<MobileSkin, string> = {
  graphite: '石墨',
  nocturne: '夜航',
}

export const SKIN_HINT: Record<MobileSkin, string> = {
  graphite: '深色底，默认',
  nocturne: '深色底，偏蓝',
}

const SKIN_CHROME: Record<MobileSkin, string> = {
  graphite: '#101015',
  nocturne: '#080c14',
}

export function getSkin(): MobileSkin {
  const value = localStorage.getItem('dsh.palm.skin')
  return value === 'graphite' || value === 'nocturne' ? value : 'graphite'
}

export function skinPolarity(skin: MobileSkin): 'light' | 'dark' {
  return skin === 'nocturne' ? 'light' : 'dark'
}
`

const CATALOG_FIXTURE = `export const SKIN_CATALOG: SkinCatalogEntry[] = [
  {
    id: 'graphite',
    label: '石墨',
    hint: '深色底，默认',
    source: '手机端自带 · MIT',
    builtin: true,
  },
]

/** 按 id 取一条；查不到返回 undefined（调用方自己决定怎么兜底）。 */
export function skinEntryOf(id: MobileSkin): SkinCatalogEntry | undefined {
  return SKIN_CATALOG.find(entry => entry.id === id)
}
`

let workdir = ''

/** 在临时目录里搭一份最小仓库：三份被 `--apply` 改写的文件 + 一份皮肤源码。 */
function makeRepo(): { palette: string; paletteThin: string } {
  const root = mkdtempSync(join(tmpdir(), 'port-skin-test-'))
  workdir = root
  mkdirSync(join(root, 'src/mobile/styles'), { recursive: true })
  mkdirSync(join(root, 'src/mobile/platform'), { recursive: true })
  writeFileSync(join(root, 'src/mobile/styles/000-tokens.css'), TOKENS_FIXTURE)
  writeFileSync(join(root, 'src/mobile/platform/skin.ts'), SKIN_FIXTURE)
  writeFileSync(join(root, 'src/mobile/platform/skin-catalog.ts'), CATALOG_FIXTURE)
  const palette = join(root, 'fixture-theme.css')
  writeFileSync(palette, FULL_PALETTE)
  const paletteThin = join(root, 'fixture-thin.css')
  writeFileSync(paletteThin, THIN_PALETTE)
  return { palette, paletteThin }
}

const read = (relative: string) => readFileSync(join(workdir, relative), 'utf8')

/** 跑真的 CLI（cwd 指到临时仓库，脚本本体在被测包内）。 */
function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: workdir, encoding: 'utf8' })
}

const applyArgs = (palette: string, extra: string[] = []) => [
  '--file',
  palette,
  '--id',
  'demo',
  '--label',
  '演示',
  '--hint',
  '暖白底色，用来测试',
  '--license',
  'MIT',
  '--apply',
  ...extra,
]

const unionLineOf = (text: string) => /^export type MobileSkin = .*$/m.exec(text)?.[0] ?? ''

beforeEach(() => {
  workdir = ''
})

afterEach(() => {
  if (workdir !== '') rmSync(workdir, { recursive: true, force: true })
})

describe('port-skin --apply：把皮肤写进三个文件', () => {
  it('写色板块、注册运行时皮肤、登记商店目录', () => {
    const { palette } = makeRepo()
    const result = run(applyArgs(palette))

    expect(result.status, result.stderr).toBe(0)

    // ① 令牌块：圆角默认 soft、7 个语法色、商店卡色板
    const tokens = read('src/mobile/styles/000-tokens.css')
    expect(tokens).toContain("html[data-skin='demo'] {")
    expect(tokens).toContain('--palm-r-m: 12px;')
    expect(tokens).toMatch(/--palm-skin-demo-bg: #[0-9a-f]{6};/)
    for (const role of ['keyword', 'string', 'comment', 'number', 'type', 'func', 'prop']) {
      expect(tokens).toMatch(new RegExp(`--tok-${role}: #[0-9a-f]{6};`))
    }

    // ② 运行时：类型 + 三个 Record + 两处判断都带上新皮肤
    const skin = read('src/mobile/platform/skin.ts')
    expect(unionLineOf(skin)).toBe("export type MobileSkin = 'graphite' | 'nocturne' | 'demo'")
    expect(skin).toMatch(/SKIN_LABEL[\s\S]*?\n {2}demo: '演示',/)
    expect(skin).toMatch(/SKIN_HINT[\s\S]*?\n {2}demo: '暖白底色，用来测试',/)
    expect(skin).toMatch(/SKIN_CHROME[\s\S]*?\n {2}demo: '#[0-9a-f]{6}',/)
    expect(skin).toContain("value === 'demo'")
    expect(skin).toContain("skin === 'demo'")

    // ③ 商店目录：说明与署名都是传进来的，不是猜的
    const catalog = read('src/mobile/platform/skin-catalog.ts')
    expect(catalog).toContain("id: 'demo',")
    expect(catalog).toContain("hint: '暖白底色，用来测试',")
    expect(catalog).toContain(`source: '来自 ${palette} · MIT',`)
    expect(catalog).toContain('builtin: false,')
  })

  it('联合类型不会被写坏：竖线分隔、每一段都带引号', () => {
    const { palette } = makeRepo()
    run(applyArgs(palette))

    const line = unionLineOf(read('src/mobile/platform/skin.ts'))
    const members = line.replace('export type MobileSkin = ', '').split(' | ')
    // 每一段都必须严格是 'x' 形态：`'endfield` 或 `'claude''` 这类残缺值会被这里拦住
    for (const member of members) expect(member).toMatch(/^'[a-z0-9-]+'$/)
    expect(members).toContain("'demo'")
  })

  it('同一条命令跑两次不会重复写入', () => {
    const { palette } = makeRepo()
    run(applyArgs(palette))
    const second = run(applyArgs(palette))
    expect(second.status, second.stderr).toBe(0)

    const tokens = read('src/mobile/styles/000-tokens.css')
    expect(tokens.match(/html\[data-skin='demo'\] \{/g) ?? []).toHaveLength(1)
    expect(tokens.match(/--palm-skin-demo-bg:/g) ?? []).toHaveLength(1)

    const skin = read('src/mobile/platform/skin.ts')
    expect(skin.match(/^ {2}demo: '/gm) ?? []).toHaveLength(3)
    // 联合类型 + getSkin 白名单 + 极性判断三处（Record 的键是 demo:，不带引号）
    expect(skin.match(/'demo'/g) ?? []).toHaveLength(3)

    const catalog = read('src/mobile/platform/skin-catalog.ts')
    expect(catalog.match(/id: 'demo',/g) ?? []).toHaveLength(1)
  })

  it('--set 手工指定角色色值', () => {
    const { palette } = makeRepo()
    expect(run(applyArgs(palette, ['--set', 'fg=#123456'])).status).toBe(0)
    expect(read('src/mobile/styles/000-tokens.css')).toContain('--palm-fg: #123456;')
  })

  it('--radius 决定圆角档位', () => {
    const { palette } = makeRepo()
    expect(run(applyArgs(palette, ['--radius', 'sharp'])).status).toBe(0)
    const tokens = read('src/mobile/styles/000-tokens.css')
    expect(tokens).toContain('--palm-r-s: 2px;')
    expect(tokens).toContain('--palm-r-m: 4px;')
    expect(tokens).toContain('--palm-r-l: 6px;')
  })

  it('--decor 把装饰层放进 600 段', () => {
    const { palette } = makeRepo()
    const decor = join(workdir, 'decor.css')
    writeFileSync(decor, "html[data-skin='demo'] .mobile-title { font-family: Georgia, serif; }\n")
    const result = run(applyArgs(palette, ['--decor', decor]))
    expect(result.status, result.stderr).toBe(0)
    expect(read('src/mobile/styles/610-skin-demo.css')).toContain("html[data-skin='demo'] .mobile-title")
  })

  it('--decor 覆盖与污染都拒绝（都是退出码 4）', () => {
    const { palette } = makeRepo()
    const decor = join(workdir, 'decor.css')
    writeFileSync(decor, "html[data-skin='demo'] .mobile-title { font-weight: 600; }\n")
    run(applyArgs(palette, ['--decor', decor]))

    // ① 已有装饰层：不覆盖（手写资产，重跑 --apply 不该冲掉）
    writeFileSync(join(workdir, 'src/mobile/styles/610-skin-demo.css'), '/* 手改过的内容 */\n')
    const overwrite = run(applyArgs(palette, ['--decor', decor]))
    expect(overwrite.status).toBe(4)
    expect(read('src/mobile/styles/610-skin-demo.css')).toContain('手改过的内容')

    // ② 没写 html[data-skin] 前缀：会装饰到所有皮肤上
    const bad = join(workdir, 'decor-bad.css')
    writeFileSync(bad, 'blockquote { border-inline-start: 3px solid var(--palm-accent); }\n')
    const polluted = run(applyArgs(palette, ['--decor', bad]))
    expect(polluted.status).toBe(4)
    expect(read('src/mobile/styles/610-skin-demo.css')).toContain('手改过的内容')
  })
})

describe('port-skin：参数与色值错误要说清', () => {
  it('抽不到核心角色时退出码 2，且不写任何文件', () => {
    const { paletteThin } = makeRepo()
    const before = read('src/mobile/platform/skin.ts')
    const result = run(applyArgs(paletteThin))

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('未命中')
    expect(read('src/mobile/platform/skin.ts')).toBe(before)
  })

  it('参数不合法就拒绝：缺 --id / 非法 --radius / 非颜色 --set（退出码 1）', () => {
    makeRepo()
    const noId = run(['--file', 'x.css'])
    expect(noId.status).toBe(1)
    expect(noId.stderr).toContain('--id')

    const { palette } = makeRepo()
    const badRadius = run(applyArgs(palette, ['--radius', '方形']))
    expect(badRadius.status).toBe(1)
    expect(badRadius.stderr).toContain('--radius 只支持')

    const badSet = run(applyArgs(palette, ['--set', 'fg=不是颜色']))
    expect(badSet.status).toBe(1)
    expect(badSet.stderr).toContain('不是 #rrggbb 色值')
  })
})
