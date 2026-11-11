#!/usr/bin/env node
/**
 * 皮肤移植器：把 dsh-skin-market 里的桌面皮肤翻译成手机端皮肤包。
 *
 * 背景（2026-11-11）：市场里 469 个皮肤都是**桌面网页的 cordis 插件**，做法是给
 * `--dsw-alias-*` 令牌赋值 + 少量类覆盖；手机端是另一套令牌（`--palm-*`）与另一套组件，
 * 代码不能复用，但**角色可以一一对应**。这个脚本把那套对应关系固化成可执行流程：
 *
 *   1. 从 GitHub 拉皮肤源码（只用固定 commit，避免上游改动影响产物）
 *   2. 抽出「颜色角色 → 色值」（桌面令牌名或调色板对象的键）
 *   3. 映射到手机端 8 个核心角色，再派生其余 40 多个颜色令牌（混色提前算成字面量）
 *   4. 按 WCAG AA 自检并自动压深不合格的前景色
 *   5. 输出可直接贴进 `000-tokens.css` 的色板块；`--apply` 时连同皮肤卡色板与目录条目一起写入
 *
 * 用法：
 *   node scripts/port-skin.mjs --repo 2754LM/dsh-theme-newsprint --commit <sha> --id newsprint
 *   node scripts/port-skin.mjs --repo Nwflower/dsh-claude-style --commit <sha> --id claude --apply
 *   node scripts/port-skin.mjs --file 本地/client.js --id demo          # 离线调试
 *
 * 退出码：0 成功；1 参数/网络问题；2 抽不到足够的颜色（需要人工看一眼）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/* ── 参数 ─────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}
/** 可重复参数（`--set a=#111 --set b=#222`）：返回全部出现项的值。 */
const argAll = (name) => {
  const values = []
  argv.forEach((token, index) => {
    if (token !== `--${name}`) return
    const value = argv[index + 1]
    if (value !== undefined && !value.startsWith('--')) values.push(value)
  })
  return values
}

const repo = arg('repo')
const commit = arg('commit')
const localFile = arg('file')
const skinId = arg('id')
const apply = arg('apply', false) === true
const preferDark = arg('dark', false) === true
const label = arg('label')
/** 商店卡片上的一句话说明（不传就写「移植皮肤」）。 */
const hint = arg('hint')
/** 来源协议（写进商店卡片的署名行）。 */
const license = arg('license', 'MIT')
/**
 * 装饰层：颜色表达不了的那部分（衬线标题、报头线、玻璃、像素边框）。
 * 传一份 CSS 文件，会被复制成 `src/mobile/styles/6NN-skin-<id>.css`
 * —— 600 段是装饰层专用段位，`skin-decor.test.ts` 会检查它只写令牌、类名真实存在、限定在本皮肤上。
 */
const decorSource = arg('decor')
/** `--set fg=#161616`：手工指定角色色值（可多次传）。 */
const roleOverrides = argAll('set')
  .map((pair) => {
    const [role, value] = pair.split('=')
    return [role?.trim(), value?.trim()]
  })
  .filter(([role, value]) => typeof role === 'string' && typeof value === 'string')
/**
 * 圆角档位：桌面皮肤里"直角工业 / 圆润 / 胶囊"这类气质差异，多半就体现在这里。
 * 默认 `soft` 与石墨一致，避免移植来的皮肤看着都一样。
 */
const radiusPreset = arg('radius', 'soft')
const RADIUS_PRESETS = {
  sharp: { s: '2px', m: '4px', l: '6px' },
  soft: { s: '8px', m: '12px', l: '18px' },
  round: { s: '12px', m: '18px', l: '26px' },
  pill: { s: '16px', m: '22px', l: '30px' },
}
if (typeof radiusPreset !== 'string' || RADIUS_PRESETS[radiusPreset] === undefined) {
  console.error(`--radius 只支持：${Object.keys(RADIUS_PRESETS).join(' / ')}`)
  process.exit(1)
}

if (typeof skinId !== 'string') {
  console.error('缺少 --id（皮肤标识，纯小写字母/数字，例如 claude、bloom）')
  process.exit(1)
}
if (typeof repo !== 'string' && typeof localFile !== 'string') {
  console.error('需要 --repo owner/name + --commit，或 --file 本地文件')
  process.exit(1)
}

/* ── 颜色工具 ─────────────────────────────────────────────────────────── */
const isHex = (value) => /^#[0-9a-fA-F]{6}$/.test(value)
const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const toHex = (list) => '#' + list.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** OKLCH → sRGB（市场里大量皮肤用 oklch 写调色板，不换算就一个颜色都抽不到）。 */
function oklchToHex(lPercent, chroma, hueDegrees) {
  const l = lPercent / 100
  const h = (hueDegrees * Math.PI) / 180
  const a = chroma * Math.cos(h)
  const b = chroma * Math.sin(h)
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ]
  const encoded = linear.map((v) => {
    const c = Math.max(0, Math.min(1, v))
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
  })
  return toHex(encoded)
}

/** 任意受支持的颜色写法 → `#rrggbb`；认不出返回 undefined。 */
function parseColor(raw) {
  const text = String(raw).trim().replace(/^['"]|['"]$/g, '')
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase()
  const oklch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/.exec(text)
  if (oklch !== null) return oklchToHex(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]))
  const oklcha = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text)
  if (oklcha !== null) return oklchToHex(Number(oklcha[1]) * 100, Number(oklcha[2]), Number(oklcha[3]))
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(text)
  if (hsl !== null) return toHex(hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100))
  return undefined
}

/** HSL → RGB（0~255 的三元组）。 */
function hslToRgb(hDegrees, s, l) {
  const h = ((hDegrees % 360) + 360) % 360 / 360
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

/** RGB → HSL（h 角度、s/l 0~1）。 */
function rgbToHsl(color) {
  const [r, g, b] = rgb(color).map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

/**
 * 语法高亮色板：**从皮肤的强调色派生**，而不是沿用桌面注入的通用两套。
 *
 * 为什么必须派生：`--tok-*` 原来只有「浅色/深色」两套，于是暖白报纸皮肤配的是一组
 * 冷调通用代码色，代码块像贴上去的（2026-11-11 用户追问"能覆盖所有页面吗"时发现）。
 *
 * 做法：以强调色的色相为主，按语法角色各偏一点色相/明度，最后统一压到 AA 4.5 以上。
 */
function deriveSyntax(accent, bg, surface) {
  const [, sat, light] = rgbToHsl(accent)
  /**
   * 语法角色用**固定色相**（紫/绿/橙/红/青），只把强调色的饱和度与明度借过来。
   *
   * 为什么不用「强调色色相加偏移」：蓝底皮肤（报纸）加 +285° 会得到绿色关键字、
   * 玫红字符串，看着像乱码；固定色相 + 借用饱和度/明度，才能在任何强调色下
   * 都是"一眼认得出的代码配色"，同时整体气质跟皮肤一致。
   */
  const ROLE_HUES = { keyword: 285, string: 130, number: 35, type: 5, prop: 175 }
  const nextSaturation = Math.min(0.82, Math.max(0.32, sat * 0.9))
  const nextLightness = Math.min(0.62, Math.max(0.28, light))
  const tone = (roleHue) => toHex(hslToRgb(roleHue, nextSaturation, nextLightness))
  const raw = {
    keyword: tone(ROLE_HUES.keyword),
    string: tone(ROLE_HUES.string),
    comment: mix(accent, bg, 0.45),
    number: tone(ROLE_HUES.number),
    type: tone(ROLE_HUES.type),
    func: accent,
    prop: tone(ROLE_HUES.prop),
  }
  // 代码块通常压在第二层表面上：逐个压到 AA 4.5，色相保持不变。
  const out = {}
  for (const [role, value] of Object.entries(raw)) out[role] = tuneForContrast(value, surface, 4.5)
  // 注释本来就该更淡：只要求 3.2（与桌面皮肤一致，不当正文用）。
  out.comment = tuneForContrast(raw.comment, surface, 3.2)
  return out
}

const mix = (fg, bg, ratio) => {
  const [a1, a2, a3] = rgb(fg)
  const [b1, b2, b3] = rgb(bg)
  return toHex([a1 * ratio + b1 * (1 - ratio), a2 * ratio + b2 * (1 - ratio), a3 * ratio + b3 * (1 - ratio)])
}
const alpha = (color, a) => (isHex(color) ? `rgba(${rgb(color).join(', ')}, ${a})` : color)

/** 相对亮度（WCAG 2.1）。 */
function luminance(color) {
  const channel = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb(color)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 对比度（1~21）。 */
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 把前景压深（或提亮）到目标对比度；返回调整后的色值。 */
function tuneForContrast(fg, bg, target) {
  if (!isHex(fg) || !isHex(bg)) return fg
  const darkBackground = luminance(bg) < 0.5
  let current = fg
  for (let step = 0; step < 60; step += 1) {
    if (contrast(current, bg) >= target) return current
    current = darkBackground ? mix('#ffffff', current, 0.06) : mix('#000000', current, 0.06)
  }
  return current
}

/* ── 角色映射表 ───────────────────────────────────────────────────────── */
/**
 * 桌面令牌名（或调色板键）→ 手机端角色。按顺序匹配，命中的越多越好。
 * 键一律小写、用 `-` 归一化后再比；`paper.base` 这种嵌套调色板会被展开成 `paper-base`。
 */
const ROLE_PATTERNS = [
  ['bg', [
    /^bg-?base$/, /^bg-?background$/, /^background$/, /^bg$/, /^app-?bg$/,
    /^paper-?base$/, /^surface-?base$/, /^surface-?bg$/, /^neutral-?bg$/,
    // 单主题皮肤常用「纸 / 墨」两个短键（终末地就是 `light` / `dark`），放最后才匹配。
    /^canvas$/, /^paper$/, /^canvas-?bg$/, /^page$/, /^light$/, /^base$/,
  ]],
  ['surface1', [
    /^bg-?layer-?1$/, /^bg-?layer-?2$/, /^bg-?card$/, /^bg-?container$/,
    /^paper-?raised$/, /^paper-?card$/, /^surface-?raised$/, /^surface-?1$/, /^bg-?elevated$/,
  ]],
  ['surface2', [
    /^bg-?layer-?3$/, /^bg-?overlay$/, /^bg-?module/, /^surface-?emphasis$/, /^surface-?2$/,
    /^paper-?container$/, /^paper-?emphasis$/, /^bg-?surface-?2$/,
  ]],
  ['line', [
    /^border-?l-?1$/, /^border-?l-?2$/, /^border-?base$/, /^border$/, /^divider$/,
    /^paper-?rule$/, /^border-?subtle$/, /^line$/,
  ]],
  ['fg', [
    /^text-?primary$/, /^fg$/, /^fg-?1$/, /^text-?base$/, /^foreground$/, /^tx$/, /^ink$/,
    /^ink-?primary$/, /^ink-?base$/, /^text$/, /^paper-?ink$/,
    /^label-?primary$/, /^label-?1$/, /^content-?primary$/, /^content$/,
  ]],
  ['fg2', [
    /^text-?secondary$/, /^fg-?2$/, /^text-?weak$/, /^text-?2$/,
    /^ink-?secondary$/, /^ink-?muted$/, /^ink-?dimmed$/,
    /^label-?secondary$/, /^label-?2$/, /^content-?secondary$/,
  ]],
  ['fg3', [
    /^text-?tertiary$/, /^fg-?3$/, /^text-?muted$/, /^caption$/, /^text-?3$/,
    /^ink-?tertiary$/, /^ink-?caption$/, /^ink-?subtle$/,
    /^label-?tertiary$/, /^label-?3$/, /^label-?caption$/, /^content-?tertiary$/,
  ]],
  ['accent', [
    /^brand-?primary$/, /^brand$/, /^accent-?blue$/, /^accent-?primary$/, /^accent-?base$/,
    /^accent-?link$/, /^accent$/, /^primary$/, /^link$/, /^edge-?accent$/, /^brand-?color$/,
  ]],
  ['ok', [/^state-?success/, /^success/, /^ok$/, /^positive$/, /^green$/]],
  ['warn', [/^state-?warning/, /^warning$/, /^warn$/, /^caution$/, /^yellow$/]],
  ['danger', [/^state-?error/, /^state-?danger/, /^error$/, /^danger$/, /^destructive$/, /^red$/]],
]

/** 角色 → 名称的候选形态（带明暗后缀的会被 `resolveRoles` 按模式挑）。 */
const MODE_SUFFIX = /[-_]?(light|dark|l|d)$/

/** 表面类角色还有一批短键（莫兰迪系皮肤用 `sf` / `sf2`）。 */
const ROLE_EXTRA = {
  surface1: [/^sf$/, /^s-?1$/],
  surface2: [/^sf-?2$/, /^s-?2$/],
  bg: [/^bg-?canvas$/, /^paper$/],
}

/**
 * 分区式调色板（claude-style 那种 `canvas / sidebar / bubble / link` 各带明暗两档）。
 * 键会被展开成 `canvas-light` 这种形态，按模式挑档后剩下的名字在这里补映射。
 */
const SECTION_ROLES = {
  bg: [/^canvas$/, /^bg-?canvas$/, /^base-?canvas$/],
  surface1: [/^sidebar$/, /^card$/, /^panel$/, /^surface-?sheet$/, /^popover$/],
  surface2: [/^bubble$/, /^bubble-?assistant$/, /^bubble-?user$/],
  accent: [/^link$/, /^accent-?ink$/],
}

/** 颜色字面量的通用形态：hex / oklch / hsl（市场里三种都常见）。 */
const COLOR_VALUE = String.raw`(#[0-9a-fA-F]{3,8}|oklch\([^)]*\)|hsla?\([^)]*\))`

/**
 * 从源码里抽「名字 → 色值」。三种写法都认：
 *   CSS：`--dsw-alias-bg-base: #15151c;`
 *   JS ：`"--dsw-alias-bg-base": "#15151c"` / `bgBase: "#15151c"`
 *   调色板对象/调色板常量：`paper: { base: "#f5f3ed" }`、`bgL: 'oklch(96% 0.01 240)'`
 * 只收**可解析的字面量**：`alpha(x, .1)`、`var(--y)`、`color-mix()` 这类派生值跳过。
 */
function extractColors(sources) {
  const found = new Map()
  const bump = (name, value) => {
    const key = normalize(name)
    if (key === '') return
    const color = parseColor(value)
    if (color === undefined) return
    const previous = found.get(key)
    if (previous === undefined) {
      found.set(key, { value: color, count: 1 })
      return
    }
    if (previous.value === color) previous.count += 1
  }
  for (const { text } of sources) {
    for (const match of text.matchAll(new RegExp(`(["']?)(--?[a-zA-Z][\\w-]*)\\1\\s*:\\s*["']?${COLOR_VALUE}`, 'g'))) {
      bump(match[2], match[4] ?? match[3])
    }
    for (const match of text.matchAll(new RegExp(`(["']?)([a-zA-Z][\\w]*)\\1\\s*:\\s*(["'])${COLOR_VALUE}\\3`, 'g'))) {
      bump(match[2], match[4] ?? match[3])
    }
    // 调色板对象：一层嵌套，把外层名当命名空间（`paper.base` → `paper-base`）。
    for (const section of PALETTE_SECTIONS) {
      const blockPattern = new RegExp(`["']?${section}["']?\\s*:\\s*\\{([^{}]{0,4000})\\}`, 'g')
      for (const block of text.matchAll(blockPattern)) {
        const inner = block[1] ?? ''
        for (const pair of inner.matchAll(new RegExp(`["']?([a-zA-Z][\\w]*)["']?\\s*:\\s*["']${COLOR_VALUE}["']`, 'g'))) {
          bump(`${section}-${pair[1]}`, pair[2])
        }
      }
    }
  }
  return found
}

/** 归一化：`--dsw-alias-bg-base` → `bg-base`；`bgBase` → `bgbase`。 */
const normalize = (name) => name
  .replace(/^--/, '')
  .replace(/^(dsw|palm|dsh)-/, '')
  .replace(/^alias-/, '')
  .replace(/^theme-/, '')
  .toLowerCase()
  .replace(/[_\s]+/g, '-')

/* ── 源码获取 ─────────────────────────────────────────────────────────── */
const CANDIDATE_FILE = /(skin|theme|palette|palettes|token|tokens|color|colors|appearance|flavor|flavours)\.(css|js|mjs|json|ts|tsx)$/i

/** 文件名的可信度：主题/调色板 > 通用 tokens > 其他；`testing/`、`fixtures/`、`.test.` 直接压到底。 */
function fileScore(path) {
  const lower = path.toLowerCase()
  let score = 0
  if (/palette|colors|colours/.test(lower)) score += 6
  else if (/theme|skin|appearance|flavor/.test(lower)) score += 5
  else if (/token/.test(lower)) score += 3
  if (/\/test|fixture|mock|stub|sample|docs?\//.test(lower)) score -= 8
  if (lower.endsWith('.css')) score += 2
  return score
}

/** 一份源码里有多少个十六进制色值（判断"这份文件到底有没有调色板"）。 */
const hexCount = (text) => (text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length + (text.match(/oklch\(/g) ?? []).length

/** 带重试的 fetch：GitHub 偶发 ECONNRESET，重试三次就够（避免把网络抖动误判成"抽不到色"）。 */
async function fetchWithRetry(url, init) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)))
    }
  }
  throw lastError
}

/**
 * 取一个 URL 的文本。
 *
 * 为什么要有 PowerShell 兜底：这台机器上 node 的 fetch 连 api.github.com 会被重置
 * （ECONNRESET，代理只对系统栈生效），而 `Invoke-WebRequest` 走系统代理是通的。
 * 先试 fetch，失败且是 Windows 就换 PowerShell，两边都失败才报错。
 */
async function fetchText(url) {
  const init = { headers: { 'user-agent': 'dsh-palm-port-skin', accept: 'application/vnd.github+json' } }
  try {
    const response = await fetchWithRetry(url, init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } catch (error) {
    if (process.platform !== 'win32') throw error
    const { execFileSync } = await import('node:child_process')
    const script = `$ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -Uri '${url}' -UseBasicParsing -TimeoutSec 60).Content`
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  }
}

async function githubJson(url) {
  const text = await fetchText(url)
  return JSON.parse(text)
}

/** 拉取皮肤源码文本（多个候选文件拼在一起，总量设上限）。 */
async function loadSources() {
  if (typeof localFile === 'string') {
    return [{ path: localFile, text: readFileSync(localFile, 'utf8') }]
  }
  const tree = await githubJson(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`)
  /** 先按文件名挑 12 个候选，下载后再按"真的有多少色值"筛，避免把测试夹具当调色板。 */
  const files = (tree.tree ?? [])
    .filter(entry => entry.type === 'blob' && CANDIDATE_FILE.test(entry.path))
    .filter(entry => (entry.size ?? 0) < 600_000 && (entry.size ?? 0) > 300)
    .sort((a, b) => fileScore(b.path) - fileScore(a.path) || (b.size ?? 0) - (a.size ?? 0))
    .slice(0, 12)
  if (files.length === 0) throw new Error('仓库里没找到像"皮肤源码"的文件（css/js 且名字含 skin/theme/token…）')
  const downloaded = []
  for (const entry of files) {
    try {
      downloaded.push({ path: entry.path, text: await fetchText(`https://raw.githubusercontent.com/${repo}/${commit}/${entry.path}`) })
    } catch (error) {
      console.log(`跳过 ${entry.path}：${String(error).slice(0, 80)}`)
    }
  }
  const ranked = downloaded
    .map(file => ({ ...file, hexes: hexCount(file.text) }))
    .sort((a, b) => b.hexes - a.hexes)
  for (const file of ranked.slice(0, 6)) console.log(`  ${String(file.hexes).padStart(4)} 色  ${file.path}`)
  return ranked.slice(0, 5).filter(file => file.hexes >= 4)
}

/* ── 抽取 ─────────────────────────────────────────────────────────────── */
/** 调色板对象的常见外层名：`paper: { base: "#…" }` → `paper-base`。 */
const PALETTE_SECTIONS = [
  'paper', 'ink', 'accent', 'state', 'surface', 'text', 'bg', 'border', 'brand', 'fg', 'fill', 'neutral', 'base',
  // 桌面皮肤的另一种写法：按「画布/侧栏/气泡/链接」分区，每区再分明暗（claude-style 就是这种）。
  'canvas', 'sidebar', 'bubble', 'link', 'code', 'edges', 'card', 'panel', 'popover',
]


/**
 * 挑出核心角色。带明暗后缀的键（`bgL` / `bgD` / `bg-light`）按 `mode` 优先取值，
 * 没有后缀的键（`--dsw-alias-bg-base`）直接用。
 *
 * @param found 抽取到的「键 → {value, count}」
 * @param mode `'l'` 取浅色档，`'d'` 取深色档
 */
function resolveRoles(found, mode) {
  const roles = {}
  const ordered = [...found.entries()].sort((a, b) => b[1].count - a[1].count)
  const stripMode = (key) => key.replace(MODE_SUFFIX, '')
  const modeOf = (key) => MODE_SUFFIX.exec(key)?.[1] ?? ''
  const matchesMode = (key) => {
    const suffix = modeOf(key)
    if (suffix === '') return true
    if (mode === 'l') return suffix === 'l' || suffix === 'light'
    return suffix === 'd' || suffix === 'dark'
  }
  /**
   * 一个键的若干种「可比较形态」：原样、去掉明暗后缀、**去掉最前面一段自定义前缀**。
   *
   * 第三种是必需的：市场里的皮肤大多用自己的前缀（`--paper-base` / `--edge-accent` /
   * `--dsw-alias-bg-base`），谁也不按我们的规矩命名。只认特定前缀就得为每套皮肤改映射表，
   * 所以这里再兜一层"去掉第一段"（`demo-bg-base` → `bg-base`）。
   */
  const shapesOf = (key) => {
    const shapes = [key, stripMode(key)]
    const cut = key.indexOf('-')
    if (cut > 0) {
      const rest = key.slice(cut + 1)
      shapes.push(rest, stripMode(rest))
    }
    return shapes
  }
  const hitFor = (pattern, requireMode) => ordered.find(([key]) =>
    (requireMode ? matchesMode(key) : true) && shapesOf(key).some(shape => pattern.test(shape)))
  for (const [role, patterns] of ROLE_PATTERNS) {
    const all = [...patterns, ...(ROLE_EXTRA[role] ?? []), ...(SECTION_ROLES[role] ?? [])]
    let picked
    for (const pattern of all) {
      picked = hitFor(pattern, true)
      if (picked !== undefined) break
    }
    // 兜底：同角色换另一个明暗档（皮肤只给了一个档位时也总比没有强）。
    if (picked === undefined) {
      for (const pattern of all) {
        picked = hitFor(pattern, false)
        if (picked !== undefined) break
      }
    }
    if (picked !== undefined) roles[role] = picked[1].value
  }
  return roles
}

/* ── 派生手机端令牌 ───────────────────────────────────────────────────── */
/** 由 8 个核心角色派生整套手机端颜色令牌（与三套内置皮肤同构）。 */
function deriveTokens(roles) {
  const bg = roles.bg ?? '#101015'
  const lightSkin = luminance(bg) > 0.5
  const bgLum = luminance(bg)

  /**
   * 表面层的**远近合理性**校验：桌面皮肤里 `bg-layer-1` 可能是另一个明暗档的值
   * （终末地的 `surface1` 抽出来是深墨色，压在奶油纸面上会变成一块黑板）。
   *
   * 判据不是"必须更亮"——纯白底上的卡片（claude 的侧栏 `#fafafa`）本来就比底**暗**一点点。
   * 真正要拦的是**跨了明暗档**的值：与底色的亮度差超过 0.35 就丢弃，改用派生值。
   */
  const saneSurface = (candidate, fallback) => {
    if (!isHex(candidate)) return fallback
    if (Math.abs(luminance(candidate) - bgLum) > 0.35) return fallback
    return candidate
  }

  const fg = roles.fg ?? (lightSkin ? '#1a1a1a' : '#f4f4f8')
  const surface1 = saneSurface(roles.surface1, lightSkin ? mix('#ffffff', bg, 0.55) : mix('#ffffff', bg, 0.06))
  const surface2Candidate = saneSurface(roles.surface2, lightSkin ? mix(fg, bg, 0.05) : mix('#ffffff', bg, 0.11))
  /**
   * 两层表面必须**看得出层次**（`skin-contrast.test` 要求 ≥ 1.07:1）。
   * Claude 那种"白底 + #fafafa + #f4f2f3"在桌面很耐看，但手机小屏上卡片会糊成一片，
   * 所以只在这条底线被踩到时，往文字色方向多推一点点。
   */
  const surface2 = contrast(surface1, surface2Candidate) >= 1.07
    ? surface2Candidate
    : mix(fg, surface1, 0.06)
  // 边框必须"贴着底色"：对比度 1.02~3.4 之间才像一条线，太深就变成一道黑边。
  const lineCandidate = roles.line
  const lineGap = isHex(lineCandidate ?? '') ? contrast(lineCandidate, bg) : 99
  const line = lineGap > 1.02 && lineGap < 3.4 ? lineCandidate : mix(fg, bg, lightSkin ? 0.12 : 0.14)
  let fg2 = roles.fg2 ?? mix(fg, bg, 0.7)
  let fg3 = roles.fg3 ?? mix(fg, bg, 0.5)
  // 强调色在手机端**当文字用**（链接、选中态）：先在底色上压到 AA，
  // 再在它自己的 10% 淡底上压一遍 —— 淡底比底色更浅/更深，两步都要过。
  let accent = roles.accent ?? (lightSkin ? '#8a5a2b' : '#7c8cff')
  accent = tuneForContrast(accent, bg, 4.5)
  for (let round = 0; round < 4; round += 1) {
    const tint = mix(accent, surface2, 0.1)
    const tuned = tuneForContrast(accent, tint, 4.5)
    if (tuned === accent) break
    accent = tuned
  }
  let ok = roles.ok ?? (lightSkin ? '#1f6f45' : '#4ade80')
  let warn = roles.warn ?? (lightSkin ? '#8a5f10' : '#e69641')
  let danger = roles.danger ?? (lightSkin ? '#a63b4f' : '#f87171')

  // WCAG：正文 ≥ 7:1（能压就压），辅助 ≥ 4.5:1；状态色压在自己 10% 淡底上 ≥ 4.5。
  fg2 = tuneForContrast(fg2, bg, 4.6)
  fg3 = tuneForContrast(fg3, bg, 4.5)
  const okOnTint = mix(ok, bg, 0.1)
  const warnOnTint = mix(warn, bg, 0.1)
  const dangerOnTint = mix(danger, bg, 0.1)
  ok = tuneForContrast(ok, okOnTint, 4.5)
  warn = tuneForContrast(warn, warnOnTint, 4.5)
  danger = tuneForContrast(danger, dangerOnTint, 4.5)

  // 语法高亮：跟着这套皮肤的强调色走（代码块底色一般就是第二层表面）。
  const syntax = deriveSyntax(accent, bg, surface2)

  return {
    light: lightSkin,
    core: { bg, surface1, surface2, line, fg, fg2, fg3, accent, ok, warn, danger },
    syntax,
    radius: RADIUS_PRESETS[radiusPreset],
    tokens: [
      ['--palm-r-s', RADIUS_PRESETS[radiusPreset].s],
      ['--palm-r-m', RADIUS_PRESETS[radiusPreset].m],
      ['--palm-r-l', RADIUS_PRESETS[radiusPreset].l],
      ['--palm-bg', bg],
      ['--palm-sur-1', surface1],
      ['--palm-sur-2', surface2],
      ['--palm-line', isHex(line) ? alpha(line, 0.5) : line],
      ['--palm-fg', fg],
      ['--palm-fg-2', fg2],
      ['--palm-fg-3', fg3],
      ['--palm-accent', accent],
      ['--palm-whale', accent],
      ['--palm-accent-2', mix('#ffffff', accent, 0.15)],
      ['--palm-on-accent', contrast(accent, '#ffffff') >= 4.5 ? '#ffffff' : '#101015'],
      ['--palm-ok', ok],
      ['--palm-warn', warn],
      ['--palm-danger', danger],
      ['--palm-tint-warn', alpha(warn, 0.1)],
      ['--palm-warn-band', alpha(warn, 0.24)],
      ['--palm-search-mark', mix(accent, surface1, 0.26)],
      ['--palm-press-bg', mix(fg, bg, 0.04)],
      ['--palm-danger-band', mix(danger, bg, 0.12)],
      ['--palm-danger-line', mix(danger, bg, 0.28)],
      ['--palm-ok-band', mix(ok, bg, 0.12)],
      ['--palm-accent-line', mix(accent, bg, 0.35)],
      ['--palm-accent-16', mix(accent, surface1, 0.16)],
      ['--palm-tint-ok', alpha(ok, 0.1)],
      ['--palm-tint-danger', alpha(danger, 0.1)],
      ['--palm-tint-accent', alpha(accent, 0.1)],
      ['--palm-hi', `inset 0 1px 0 ${alpha('#ffffff', 0.9)}`],
      ['--palm-sh1', `0 1px 2px ${alpha(fg, 0.08)}`],
      ['--palm-sh2', `0 6px 20px ${alpha(fg, 0.12)}`],
      ['--palm-shadow', `0 0 0 1px ${alpha(fg, 0.1)}, 0 10px 30px ${alpha(fg, 0.14)}`],
      ['--palm-flow-card-bg', `linear-gradient(180deg, ${alpha(ok, 0.05)}, ${alpha('#ffffff', 0.96)})`],
      ['--palm-flow-rule', alpha(fg, 0.08)],
      ['--palm-flow-card-line', alpha(ok, 0.28)],
      ['--palm-flow-tag-ok', alpha(ok, 0.12)],
      ['--palm-flow-tag-edit', alpha(accent, 0.12)],
      ['--palm-scrim', alpha(fg, 0.42)],
      ['--palm-on-scrim', bg],
      ['--palm-scrim-strong', alpha(fg, 0.8)],
      ['--palm-scrim-soft', alpha(fg, 0.12)],
      ['--palm-on-scrim-soft', alpha(bg, 0.7)],
      ['--palm-strip-fg', fg],
      ['--palm-strip-detail-fg', fg2],
      ['--palm-strip-right-fg', fg3],
      ['--palm-strip-text-shadow', 'none'],
      ['--palm-dock-chip-bg', alpha(fg, 0.05)],
      ['--palm-dock-chip-div-bg', alpha(fg, 0.16)],
      ['--palm-dock-ring-track', alpha(accent, 0.3)],
      ['--palm-dock-queue-bg', alpha(warn, 0.09)],
    ],
  }
}

/* ── 报告与写出 ───────────────────────────────────────────────────────── */
const CORE_ROLES = ['bg', 'surface1', 'surface2', 'fg', 'fg2', 'fg3', 'accent', 'line']
/** 必须抽到才算成功：其余（表面、二级/三级文字、边框）可以由这几项派生出来。 */
const REQUIRED_ROLES = ['bg', 'fg', 'accent']

function report(found, roles) {
  const missing = CORE_ROLES.filter(role => roles[role] === undefined)
  console.log(`抽取到 ${found.size} 个命名颜色，命中 ${CORE_ROLES.length - missing.length}/${CORE_ROLES.length} 个核心角色`)
  if (missing.length > 0) {
    console.log(`未命中：${missing.join(', ')}`)
    console.log('出现最多的候选（前 12，供人工挑）：')
    const top = [...found.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12)
    for (const [key, value] of top) console.log(`  ${key.padEnd(34)} ${value.value} ×${value.count}`)
  }
  return missing
}

function cssBlock(id, derived, sourceNote) {
  const { tokens, light, syntax, radius } = derived
  const body = tokens.map(([name, value]) => `  ${name}: ${value};`).join('\n')
  const syntaxLines = Object.entries(syntax).map(([role, value]) => `  --tok-${role}: ${value};`).join('\n')
  return `
/* ═══════════ 皮肤：${id} ══════════════════════════════════════════════════
 * ${sourceNote}
 * 由 scripts/port-skin.mjs 从桌面皮肤翻译：桌面令牌 → 手机端令牌，混色提前算成字面量。
 * 对比度已按 WCAG AA 自检并自动压深（含语法高亮，压在自己的代码块底色上）。
 * 圆角档位：${radius.s} / ${radius.m} / ${radius.l}（--radius 决定"直角还是圆润"）。
 */
html[data-skin='${id}'] {
${body}
  /* 语法高亮：从这套皮肤的强调色派生，否则代码块会沿用通用两套色板、和周围格格不入。 */
${syntaxLines}
  --palm-font-sans: var(--font-sans);
  color-scheme: ${light ? 'light' : 'dark'};
}
`
}

function applyToSources(id, block, derived) {
  const tokensPath = 'src/mobile/styles/000-tokens.css'
  const catalogPath = 'src/mobile/platform/skin-catalog.ts'
  const skinPath = 'src/mobile/platform/skin.ts'

  const tokens = readFileSync(tokensPath, 'utf8')
  if (tokens.includes(`html[data-skin='${id}']`)) {
    console.log(`!! 000-tokens.css 里已有 ${id}，跳过写入（避免重复块）`)
  } else {
    const anchor = tokens.lastIndexOf('\n}', tokens.indexOf("html[data-skin='nocturne']"))
    writeFileSync(tokensPath, tokens.slice(0, anchor + 2) + block + tokens.slice(anchor + 2))
    console.log(`已写入色板块：${tokensPath}`)
  }

  // 皮肤卡色板（商店预览用）——必须幂等：同一条命令跑两次不能再插一对。
  const tokensNow = readFileSync(tokensPath, 'utf8')
  if (!tokensNow.includes(`--palm-skin-${id}-bg:`)) {
    const withSwatch = tokensNow.replace(
      /  --palm-skin-nocturne-ink: [^;]+;/,
      match => `${match}\n  --palm-skin-${id}-bg: ${derived.core.bg};\n  --palm-skin-${id}-ink: ${derived.core.accent};`,
    )
    writeFileSync(tokensPath, withSwatch)
  }

  // 运行时类型 + 中文名 + chrome
  let skin = readFileSync(skinPath, 'utf8')
  if (!skin.includes(`'${id}'`)) {
    const before = skin
    skin = skin
      // 逐个类型名往里加：直接对整行做替换，避免贪婪正则在引号之间乱插。
      .replace(/^export type MobileSkin =.*$/m, line => `${line.trimEnd()} | '${id}'`)
      .replace(/(export const SKIN_LABEL: Record<MobileSkin, string> = \{\n)/, `$1  ${id}: '${label ?? id}',\n`)
      .replace(/(export const SKIN_HINT: Record<MobileSkin, string> = \{\n)/, `$1  ${id}: '${hint ?? '移植皮肤'}',\n`)
      .replace(/(const SKIN_CHROME: Record<MobileSkin, string> = \{\n)/, `$1  ${id}: '${derived.core.bg}',\n`)
      // 读存盘的兜底行：默认值可能是常量也可能是字面量（`? value : 'graphite'`），两种都要认。
      .replace(
        /(return value === [^\n?]+) \? value : [^\n]+/,
        (match, head, tail) => `${head} || value === '${id}' ? value : ${match.split(': ').at(-1)}`,
      )
      .replace(
        /(return skin === [^\n?]+) \? 'light' : 'dark'/,
        `${derived.light ? `$1 || skin === '${id}' ? 'light' : 'dark'` : '$1 ? \'light\' : \'dark\''}`,
      )
    writeFileSync(skinPath, skin)
    // 写不进去等于这个皮肤在运行时不可用——**必须报出来**，不能静默跳过。
    const checks = [
      [`'${id}'`, '联合类型'],
      [`  ${id}: `, '三个 Record 之一'],
      [`value === '${id}'`, 'getSkin 白名单'],
      [`skin === '${id}'`, '极性判断'],
    ]
    const missed = checks.filter(([needle]) => !skin.includes(needle)).map(([, what]) => what)
    if (missed.length > 0) {
      console.error(`!! 运行时注册不完整：${missed.join('、')} 没写进去（${skinPath} 结构与预期不符，需要手工补）`)
      process.exit(3)
    }
    if (before === skin) console.error('!! 运行时注册没有产生任何改动，检查 skin.ts 结构是否变了')
    console.log(`已注册运行时皮肤：${skinPath}`)
  }

  // 商店目录
  let catalog = readFileSync(catalogPath, 'utf8')
  if (!catalog.includes(`id: '${id}'`)) {
    const entry = [
      '  {',
      `    id: '${id}',`,
      `    label: '${label ?? id}',`,
      `    hint: '${hint ?? '移植皮肤'}',`,
      `    source: '来自 ${repo ?? localFile} · ${license}',`,
      '    builtin: false,',
      '  },',
    ].join('\n')
    catalog = catalog.replace(/\n\]\n\n\/\*\* 按 id 取一条/, `\n${entry}\n]\n\n/** 按 id 取一条`)
    writeFileSync(catalogPath, catalog)
    console.log(`已加入皮肤目录：${catalogPath}`)
  }
}

/**
 * 装饰层落地：把 `--decor` 给的 CSS 复制成 `src/mobile/styles/6NN-skin-<id>.css`。
 *
 * 三条自我约束（对应 `skin-decor.test.ts` 的三条守卫）：
 * - 文件名落在 600 段，`gen-mobile-css` 按名字排序自动纳入，不需要改注册表；
 * - **已存在就拒绝**（退出码 4）：装饰是手写资产，静默覆盖会丢掉别人的调整；
 * - 只做复制 + 换行归一，不在这一层改内容（改内容请改那份 CSS 源文件）。
 */
function applyDecor(id, sourcePath) {
  const stylesDir = 'src/mobile/styles'
  // 同一套皮肤已有装饰就拒绝：装饰是手写资产，重跑 `--apply` 不该把它冲掉。
  const existing = readdirSync(stylesDir).find(name => new RegExp(`^6\\d{2}-skin-${id}\\.css$`).test(name))
  if (existing !== undefined) {
    console.error(`!! ${stylesDir}/${existing} 已存在，装饰层不覆盖；要替换请手工合并`)
    process.exit(4)
  }
  const target = `${stylesDir}/${nextDecorName(stylesDir, id)}`
  if (!existsSync(sourcePath)) {
    console.error(`--decor 指向的文件不存在：${sourcePath}`)
    process.exit(1)
  }
  const css = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
  if (!/html\[data-skin=/.test(css)) {
    console.error(`!! 装饰层没写 html[data-skin='${id}'] 前缀，会污染其它皮肤；拒绝写入`)
    process.exit(4)
  }
  writeFileSync(target, css.endsWith('\n') ? css : `${css}\n`)
  console.log(`已写入装饰层：${target}`)
}

/** 600 段里下一个空位（610、611、612…）。 */
function nextDecorName(stylesDir, id) {
  const taken = readdirSync(stylesDir)
    .filter(name => /^6\d{2}-skin-/.test(name))
    .map(name => Number(name.slice(0, 3)))
  const next = taken.length === 0 ? 610 : Math.max(...taken) + 1
  return `${next}-skin-${id}.css`
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
const sources = await loadSources()
console.log(`读取 ${sources.length} 个文件：${sources.map(s => s.path).join(', ')}`)
const found = extractColors(sources)
const roles = resolveRoles(found, preferDark ? 'd' : 'l')
// 人工兜底：`--set fg=#161616` 直接指定某个角色（桌面皮肤的调色板只给了一半字面量时用得上）。
for (const [role, value] of roleOverrides) {
  if (!isHex(value)) {
    console.error(`--set ${role}=${value} 不是 #rrggbb 色值`)
    process.exit(1)
  }
  roles[role] = value
}
report(found, roles)

/**
 * 先判"够不够翻"，再动手写。
 * 顺序很关键：`--apply` 会直接改源码，抽不到底色/正文/强调这三样时写进去的只是套了默认色的空壳，
 * 所以这里必须在**任何写操作之前**退出（2026-11-11 加测试时发现原来是在最后才退出）。
 */
const lacking = REQUIRED_ROLES.filter(role => roles[role] === undefined)
if (lacking.length > 0) {
  console.error(`缺少核心角色：${lacking.join(', ')}（皮肤源码里找不到这几种色，换文件或 --set 手工指定）`)
  process.exit(2)
}

const derived = deriveTokens(roles)
const sourceNote = `来自 ${repo ?? localFile}（${commit ? commit.slice(0, 7) : '本地'}）`
const block = cssBlock(skinId, derived, sourceNote)

console.log('\n核心角色：')
for (const [role, value] of Object.entries(derived.core)) console.log(`  ${role.padEnd(9)} ${typeof value === 'string' ? value : ''}`)
console.log(`极性：${derived.light ? '浅色' : '深色'}`)
console.log('对比度自检：', {
  '正文字号/底': contrast(derived.core.fg, derived.core.bg).toFixed(2),
  '二级/底': contrast(derived.core.fg2, derived.core.bg).toFixed(2),
  '三级/底': contrast(derived.core.fg3, derived.core.bg).toFixed(2),
  '强调/底': contrast(derived.core.accent, derived.core.bg).toFixed(2),
})

if (apply) {
  applyToSources(skinId, block, derived)
  if (typeof decorSource === 'string') applyDecor(skinId, decorSource)
  console.log('\n下一步：node scripts/gen-mobile-css.mjs && pnpm typecheck && npx vitest run src/mobile/design src/mobile/styles')
} else {
  const outPath = join(process.cwd(), `skin-${skinId}.css`)
  writeFileSync(outPath, block)
  console.log(`\n预览：${outPath}（加 --apply 直接写进源码）`)
}

process.exit(REQUIRED_ROLES.some(role => roles[role] === undefined) ? 2 : 0)
