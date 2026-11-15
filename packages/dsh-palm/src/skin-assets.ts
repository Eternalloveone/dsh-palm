/**
 * 皮肤素材（L2 素材转接层）的解析与授权：**每次请求现读清单**。
 *
 * 为什么不在启动时把路由表铺好：那样每加一套带图的皮肤都得重启宿主一次
 * （2026-11-14 实测：重启后图片才从 404 变 200）。改成「一条前缀路由 + 请求时
 * 查清单」之后，加皮肤只需要 构建 + 刷新页面。
 *
 * 安全边界仍然在清单上，且是 fail-closed：
 *   1. 路径只接受 `/m/skin-assets/<id>/<file>` 两段，文件名不许有分隔符或 `..`；
 *   2. `<id>` 必须在清单里，且 `license` + `source` 都非空；
 *   3. `<file>` 必须出现在该皮肤的 `art[]` 里（清单之外的图一律不服务）。
 *
 * 清单按 mtime 缓存：改完 manifest.json 立刻生效，不用重启也不用改代码。
 *
 * @module dsh-palm/skin-assets
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 素材的角色：决定它在界面里怎么用（也决定审许可时看哪一类）。 */
export type SkinArtRole = 'illustration' | 'texture' | 'icon' | 'badge' | 'border'

/** 清单里一段素材。 */
export interface SkinArtEntry {
  file?: string
  role?: SkinArtRole
  note?: string
  /** 逐条署名：图标/徽章常来自字体图标或游戏原素材，许可与代码不同。 */
  credit?: string
  /** 九宫格参数：role=border 的素材必填，装饰层的 border-image 数字要与它一致。 */
  frame?: { slice?: number; width?: number }
}

/** 清单里一套皮肤。 */
export interface SkinAssetSkin {
  license?: string
  source?: string
  art?: SkinArtEntry[]
}

/** 清单文件形状。 */
export interface SkinAssetManifest {
  skins?: Record<string, SkinAssetSkin>
}

/** 一次解析的结果：绝对路径 + content-type。 */
export interface ResolvedSkinAsset {
  path: string
  type: string
}

const MANIFEST_URL = new URL('../assets/skins/manifest.json', import.meta.url)
const SKIN_DIR_URL = new URL('../assets/skins/', import.meta.url)
const ASSET_PREFIX = '/m/skin-assets/'

/** 文件名白名单：字母数字开头，只允许字母数字点下划线连字符。 */
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*$/i

let cached: { mtimeMs: number; manifest: SkinAssetManifest } | null = null

/** 读清单（按 mtime 缓存；坏 JSON 当作空清单，不抛）。 */
export function readManifest(manifestPath: string = fileURLToPath(MANIFEST_URL)): SkinAssetManifest {
  try {
    const { mtimeMs } = statSync(manifestPath)
    if (cached !== null && cached.mtimeMs === mtimeMs) return cached.manifest
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SkinAssetManifest
    cached = { mtimeMs, manifest }
    return manifest
  } catch {
    return {}
  }
}

/** 按扩展名给 content-type（图标会是 SVG，其余两种是位图）。 */
export function assetContentType(file: string): string {
  const lower = file.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

/**
 * 把请求路径解析成素材；不该服务的组合一律返回 null（调用方回 404）。
 *
 * @param pathname - 完整的请求路径，如 `/m/skin-assets/furina/furina-art.jpg`
 * @param manifest - 已读到的清单（默认现读）
 */
export function resolveSkinAsset(
  pathname: string,
  manifest: SkinAssetManifest = readManifest(),
): ResolvedSkinAsset | null {
  if (!pathname.startsWith(ASSET_PREFIX)) return null
  const rest = pathname.slice(ASSET_PREFIX.length)
  const parts = rest.split('/')
  if (parts.length !== 2) return null
  const [id = '', file = ''] = parts
  if (!SAFE_FILE.test(id) || !SAFE_FILE.test(file)) return null
  const skin = manifest.skins?.[id]
  if (skin === undefined) return null
  if ((skin.license ?? '') === '' || (skin.source ?? '') === '') return null
  const listed = (skin.art ?? []).some(entry => entry.file === file)
  if (!listed) return null
  return {
    path: fileURLToPath(new URL(`${id}/${file}`, SKIN_DIR_URL)),
    type: assetContentType(file),
  }
}

/** 素材路由的前缀（宿主注册一条前缀路由用）。 */
export const SKIN_ASSET_ROUTE = '/m/skin-assets'
