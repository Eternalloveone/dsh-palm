/**
 * 手机端壁纸背景（本机图片，不上传）。
 *
 * 桌面端皮肤中心有壁纸桥（Wallpaper Engine），手机端没有——这里给它一条最小闭环：
 * 选一张本机图片 → 压到 localStorage 放得下 → 垫在页面底色之下，配「遮罩浓度」和
 * 「模糊」两个滑杆。**只让页面底色让位，卡片仍是不透明表面**：文字永远压在实色上，
 * 这样任何图片、任何皮肤都不会把正文读没（对比度守卫也就不必重算一遍）。
 *
 * 状态只有一个来源：localStorage 里的一份 JSON。应用时写到 <html data-wall> 与三个
 * CSS 变量上，样式只认这些（见 styles/530-wallpaper.css）。
 *
 * @module dsh-palm/mobile/platform/wallpaper
 */

/** 壁纸状态：图片（dataURL）+ 遮罩浓度（0–100）+ 模糊半径（0–20px）。 */
export interface WallpaperState {
  /** 压缩后的 dataURL；null = 没设壁纸。 */
  image: string | null
  /** 遮罩浓度：0 让图片全裸，100 几乎看不见图片（用皮肤表面色盖住）。 */
  mask: number
  /** 模糊半径（px），0 = 不模糊。 */
  blur: number
}

const STORAGE_KEY = 'dsh.palm.wallpaper'

/** 遮罩默认 85：图片看得见，但正文仍压在接近皮肤底色的表面上（55 时正文会跟图片抢）。 */
export const DEFAULT_WALLPAPER: WallpaperState = { image: null, mask: 85, blur: 0 }

const listeners = new Set<() => void>()

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

/** 读壁纸状态；坏数据一律回默认，不让脏值把界面搞花。 */
export function getWallpaper(): WallpaperState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return DEFAULT_WALLPAPER
    const parsed = JSON.parse(raw) as Partial<WallpaperState>
    return {
      image: typeof parsed.image === 'string' && parsed.image.startsWith('data:image/') ? parsed.image : null,
      mask: clamp(typeof parsed.mask === 'number' ? parsed.mask : DEFAULT_WALLPAPER.mask, 0, 100),
      blur: clamp(typeof parsed.blur === 'number' ? parsed.blur : DEFAULT_WALLPAPER.blur, 0, 20),
    }
  } catch {
    return DEFAULT_WALLPAPER
  }
}

/** 写壁纸状态（局部覆盖）+ 立即应用 + 广播。 */
export function setWallpaper(patch: Partial<WallpaperState>): WallpaperState {
  const next: WallpaperState = { ...getWallpaper(), ...patch }
  const normalized: WallpaperState = {
    image: next.image,
    mask: clamp(next.mask, 0, 100),
    blur: clamp(next.blur, 0, 20),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // 配额满了（图片太大）：本次仍应用，只是下次打开回到默认。
  }
  applyWallpaper(normalized)
  for (const listener of [...listeners]) listener()
  return normalized
}

/** 把状态写到 <html>：data-wall 开关 + 三个 CSS 变量。 */
export function applyWallpaper(state: WallpaperState = getWallpaper()): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (state.image === null) {
    delete root.dataset.wall
    root.style.removeProperty('--palm-wall-img')
    root.style.removeProperty('--palm-wall-mask')
    root.style.removeProperty('--palm-wall-blur')
    return
  }
  root.dataset.wall = 'on'
  root.style.setProperty('--palm-wall-img', `url("${state.image}")`)
  root.style.setProperty('--palm-wall-mask', String(state.mask))
  root.style.setProperty('--palm-wall-blur', String(state.blur))
}

/** 订阅壁纸变更；返回退订函数。 */
export function subscribeWallpaper(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 一张图压到多少像素长边（再大 localStorage 塞不下，手机上也没意义）。 */
const MAX_EDGE = 1600
/** 编码质量阶梯：先 0.72，超预算再往下降。 */
const QUALITY_STEPS = [0.72, 0.6, 0.5, 0.42]
/** 长边阶梯：质量压到底还超，就连尺寸一起降。 */
const EDGE_STEPS = [MAX_EDGE, 1280, 1024, 800]
/**
 * 单张壁纸上限（字符）。
 *
 * 800 KB 是**实测出来的硬顶**：把壁纸写进 CSS 变量时，Chromium 对自定义属性值的
 * 长度有上限（1 MB 能进、2.1 MB 静默丢弃），被丢掉时页面表现为「壁纸开了但什么也
 * 没有」。所以这里按字符数卡死，宁可压糊一点也不能写不进去。
 */
const MAX_CHARS = 800_000

/**
 * 把用户选的图片压成适合当壁纸的 dataURL。
 *
 * 手机直出的照片动辄 4~8 MB，原样塞 localStorage 会抛配额错误，直接写进 CSS 变量
 * 又会被 Chromium 悄悄丢弃；这里按「长边 + 质量」两重阶梯压到 800 KB 字符以内，
 * 压不下去就抛错让界面说明原因（换小图 / 换一张）。
 *
 * @param file - 用户选的文件
 * @returns 可存本地、可写进 CSS 变量的 dataURL
 */
export async function shrinkImageToDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('浏览器不支持画布，换一张图片再试')
    let last = ''
    for (const edge of EDGE_STEPS) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITY_STEPS) {
        last = canvas.toDataURL('image/jpeg', quality)
        if (last.length <= MAX_CHARS) return last
      }
    }
    throw new Error(`这张图压到 ${Math.round(MAX_CHARS / 1024)} KB 还是太大，换一张小一点的`)
  } finally {
    bitmap.close()
  }
}
