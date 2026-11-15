/**
 * 皮肤图标贴图生成器（2026-11-14，B 方案）。
 *
 * 为什么生成而不是手画：同一套字形要在几套皮肤里各长一个样，手画 15×3 张没人维护得动，
 * 改一笔要同步 45 个文件。这里把「字形」写成 ASCII 点阵（唯一真源），再按皮肤风格
 * 渲染成 SVG 剪影 —— 加一套皮肤 = 加一个 renderer，加一个图标 = 加一张点阵。
 *
 * 三种渲染风格（都输出纯黑剪影，靠 CSS mask 上色，跟着 currentColor 走）：
 *   block    XP：实心像素块，圆角 0.6（Luna 工具条那种硬边但有一点点圆）
 *   chunky   我的世界：先膨胀一格再加粗边，方块感更重，直角
 *   outline  赛博夜城：只留轮廓那一圈像素（霓虹线框）
 *
 * 用法：node scripts/gen-skin-icons.mjs [--check]
 *   --check 只校验「生成结果与磁盘一致」，不写文件（CI / 测试用）。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKINS_DIR = join(ROOT, 'assets', 'skins')
const MANIFEST = join(SKINS_DIR, 'manifest.json')

/* ── 字形（唯一真源）：每张点阵必须等宽等高，# = 实心 ────────────────────── */
const GLYPHS = {
  'contrast': [
    '....####....',
    '..#####.##..',
    '.#####....#.',
    '.#####....#.',
    '######.....#',
    '######.....#',
    '######.....#',
    '######.....#',
    '.#####....#.',
    '.#####....#.',
    '..#####.##..',
    '....####....',
  ],
  'image': [
    '############',
    '#..........#',
    '#...##.....#',
    '#..####....#',
    '#..........#',
    '#........#.#',
    '#......##..#',
    '#...####...#',
    '#..######..#',
    '#..........#',
    '############',
    '............',
  ],
  'sliders': [
    '............',
    '...##.......',
    '##########..',
    '...##.......',
    '............',
    '.......##...',
    '..##########',
    '.......##...',
    '............',
    '..##........',
    '##########..',
    '..##........',
  ],
  'hash': [
    '............',
    '..#....#....',
    '..#....#....',
    '.##########.',
    '..#....#....',
    '..#....#....',
    '.##########.',
    '..#....#....',
    '..#....#....',
    '............',
    '............',
    '............',
  ],
  'scroll-down': [
    '............',
    '.....###....',
    '.....#.#....',
    '.....#.#....',
    '.....#.#....',
    '..####.####.',
    '...###.###..',
    '....##.##...',
    '.....#.#....',
    '............',
    '..########..',
    '............',
  ],
  'vibrate': [
    '............',
    '.#..######.#',
    '.#..#....#.#',
    '.#..#....#.#',
    '.#..#....#.#',
    '.#..#....#.#',
    '.#..#....#.#',
    '.#..#....#.#',
    '.#..######.#',
    '.#........#.',
    '.#........#.',
    '............',
  ],
  'bell': [
    '............',
    '.....###....',
    '....#####...',
    '...#######..',
    '...#######..',
    '...#######..',
    '..#########.',
    '.###########',
    '............',
    '....#####...',
    '............',
    '............',
  ],
  'mic': [
    '....####....',
    '...######...',
    '...######...',
    '...######...',
    '...######...',
    '...######...',
    '..#..####..#',
    '..##......##',
    '...#######..',
    '....#####...',
    '.....###....',
    '............',
  ],
  'shield': [
    '..########..',
    '..########..',
    '..########..',
    '..########..',
    '..########..',
    '...######...',
    '...######...',
    '....####....',
    '....####....',
    '.....##.....',
    '............',
    '............',
  ],
  'trash': [
    '....####....',
    '..########..',
    '............',
    '..########..',
    '..##.##.##..',
    '..##.##.##..',
    '..##.##.##..',
    '..##.##.##..',
    '..##.##.##..',
    '..########..',
    '............',
    '............',
  ],
  'info': [
    '....####....',
    '..##....##..',
    '.#........#.',
    '.#...##...#.',
    '.#...##...#.',
    '.#........#.',
    '.#...##...#.',
    '.#...##...#.',
    '..##....##..',
    '....####....',
    '............',
    '............',
  ],
  'gauge': [
    '............',
    '....####....',
    '..##....##..',
    '.#........#.',
    '.#.......#..',
    '.#.....#...#',
    '.#........#.',
    '..##....##..',
    '....####....',
    '............',
    '............',
    '............',
  ],
  'upper-right': [
    '............',
    '......#.....',
    '.....###....',
    '....#####...',
    '......#.....',
    '............',
    '..#.........',
    '..#.........',
    '..#.........',
    '..##########',
    '............',
    '............',
  ],
  'type': [
    '............',
    '....####....',
    '.....###....',
    '....#####...',
    '....#...#...',
    '...##...##..',
    '...#######..',
    '..##.....##.',
    '..#.......#.',
    '............',
    '............',
    '............',
  ],
  'rows': [
    '............',
    '###.#######.',
    '###.#######.',
    '............',
    '###.#######.',
    '###.#######.',
    '............',
    '###.#######.',
    '###.#######.',
    '............',
    '............',
    '............',
  ],
}

/* ── 风格 ─────────────────────────────────────────────────────────────── */
const STYLES = {
  // XP：实心像素块，轻微圆角。
  block: { dilate: 0, rx: 0.6 },
  // 我的世界：先裁到内容再把格子放大（像素块更粗更硬），直角。
  // 不用"膨胀"来加粗 —— 膨胀会把 # 这种细笔画糊成一团（2026-11-14 实拍过）。
  chunky: { dilate: 0, rx: 0, crop: true },
  // 赛博：只保留轮廓像素（霓虹线框），先腐蚀再取差集。
  outline: { dilate: 0, rx: 0, onlyEdge: true },
}

/** 把 # 点阵读成布尔网格。 */
const grid = (map) => map.map((row) => [...row].map((ch) => ch === '#'))

/** 膨胀：四邻域向外长一格（chunky 用）。 */
function dilate(cells) {
  const rows = cells.length
  const cols = cells[0].length
  return cells.map((row, y) => row.map((on, x) => on
    || cells[y - 1]?.[x] || cells[y + 1]?.[x] || row[x - 1] || row[x + 1]))
}

/** 腐蚀：四邻域内缩一格（outline 用）。 */
function erode(cells) {
  const rows = cells.length
  const cols = cells[0].length
  return cells.map((row, y) => row.map((on, x) => on
    && cells[y - 1]?.[x] !== false && cells[y + 1]?.[x] !== false
    && row[x - 1] !== false && row[x + 1] !== false))
}

/** 布尔网格 → 逐行合并成矩形（SVG 体积靠它，不然一个图标就是 100 个 rect）。 */
function runs(cells, cell) {
  const out = []
  cells.forEach((row, y) => {
    let start = -1
    for (let x = 0; x <= row.length; x += 1) {
      const on = row[x] === true
      if (on && start === -1) start = x
      if (!on && start !== -1) {
        out.push({ x: start * cell, y: y * cell, w: (x - start) * cell, h: cell })
        start = -1
      }
    }
  })
  return out
}

const num = (value) => Number(value.toFixed(2)).toString()

/** 裁到内容的外接方框（四周空白不留，格子因此变大 = 像素更粗）。非正方形补成正方形。 */
function crop(cells) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  cells.forEach((row, y) => row.forEach((on, x) => {
    if (!on) return
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }))
  if (maxX < 0) return cells
  const side = Math.max(maxX - minX + 1, maxY - minY + 1)
  return Array.from({ length: side }, (_, y) => Array.from({ length: side }, (_, x) => {
    return cells[minY + y]?.[minX + x] === true
  }))
}

/** 生成一个 SVG（24×24 画布，纯黑剪影，mask 上色）。 */
function render(map, style) {
  const cells0 = grid(map)
  const style0 = STYLES[style]
  let cells = style0.dilate > 0 ? dilate(cells0) : cells0
  if (style0.onlyEdge) {
    const inner = erode(cells0)
    cells = cells0.map((row, y) => row.map((on, x) => on && !inner[y][x]))
  }
  if (style0.crop) cells = crop(cells)
  const cell = 24 / cells.length
  const rects = runs(cells, cell)
    .map((r) => `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}"${style0.rx > 0 ? ` rx="${style0.rx}"` : ''}/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${rects}</svg>\n`
}

/** 哪套皮肤用哪种风格（id 必须是真实皮肤，见 platform/skin.ts）。 */
const SKIN_STYLES = {
  'xp': 'block',
  'minecraft': 'chunky',
  'cyber-night': 'outline',
}

/* ── 写盘 / 校验 ───────────────────────────────────────────────────────── */
const CHECK = process.argv.includes('--check')
const written = []
const drifted = []

for (const [skin, style] of Object.entries(SKIN_STYLES)) {
  const dir = join(SKINS_DIR, skin)
  if (!CHECK) mkdirSync(dir, { recursive: true })
  for (const [icon, map] of Object.entries(GLYPHS)) {
    const rows = new Set(map.map((row) => row.length))
    if (rows.size !== 1 || map.length !== map[0].length) {
      throw new Error(`字形 ${icon} 不是等宽等高的方阵（${map.length} 行 / 宽度 ${[...rows]}）`)
    }
    const svg = render(map, style)
    const file = join(dir, `${icon}.svg`)
    if (CHECK) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== svg) drifted.push(`${skin}/${icon}.svg`)
      continue
    }
    writeFileSync(file, svg)
    written.push(`${skin}/${icon}.svg`)
  }
}

/* 清单：把这三套皮肤的 icon 条目按磁盘重建，非 icon 条目（边框/插画）原样保留。 */
function syncManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const credit = {
    'xp': 'dsh-palm 项目自绘 · Apache-2.0',
    'minecraft': 'dsh-palm 项目自绘 · Apache-2.0',
    'cyber-night': 'dsh-palm 项目自绘 · Apache-2.0',
  }
  for (const skin of Object.keys(SKIN_STYLES)) {
    const entry = manifest.skins[skin] ?? { source: 'dsh-palm 项目自绘', license: 'Apache-2.0', art: [] }
    const keep = (entry.art ?? []).filter((art) => art.role !== 'icon')
    const icons = readdirSync(join(SKINS_DIR, skin))
      .filter((name) => name.endsWith('.svg') && name !== 'frame.svg')
      .sort()
      .map((file) => ({
        file,
        role: 'icon',
        note: `图标层：设置页/抽屉共用字形，点阵见 scripts/gen-skin-icons.mjs`,
        credit: credit[skin],
      }))
    entry.art = [...keep, ...icons]
    entry.source = entry.source ?? 'dsh-palm 项目自绘'
    entry.license = entry.license ?? 'Apache-2.0'
    manifest.skins[skin] = entry
  }
  if (CHECK) return
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
}

if (CHECK) {
  if (drifted.length > 0) {
    console.error(`有 ${drifted.length} 个图标与生成器不一致（重跑 node scripts/gen-skin-icons.mjs）：\n  ${drifted.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`[gen-skin-icons] 一致：${Object.keys(SKIN_STYLES).length} 套皮肤 × ${Object.keys(GLYPHS).length} 个字形`)
} else {
  syncManifest()
  console.log(`[gen-skin-icons] 写出 ${written.length} 个 SVG（${Object.keys(SKIN_STYLES).length} 套皮肤 × ${Object.keys(GLYPHS).length} 个字形）`)
}
