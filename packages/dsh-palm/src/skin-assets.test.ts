// @vitest-environment node
/**
 * 皮肤素材的解析与授权（请求时查清单）。
 *
 * 这条路径是「加皮肤不必重启」的关键，同时是唯一一条**由请求地址拼绝对文件路径**的
 * 代码，所以把边界逐条钉死：两段路径、白名单文件名、id 在清单里、许可齐全、文件登记过。
 */

import { describe, expect, it } from 'vitest'
import { assetContentType, resolveSkinAsset, type SkinAssetManifest } from './skin-assets.ts'

const MANIFEST: SkinAssetManifest = {
  skins: {
    furina: {
      license: 'BSD-3-Clause',
      source: 'dsh-web 皮肤包（zhu1090093659）',
      art: [{ file: 'furina-art.jpg' }, { file: 'alt.webp' }],
    },
    pending: {
      // 没有 license / source：素材一律不许服务
      art: [{ file: 'shot.png' }],
    },
  },
}

describe('皮肤素材解析', () => {
  it('清单里登记过的素材能解析出绝对路径与 content-type', () => {
    const jpg = resolveSkinAsset('/m/skin-assets/furina/furina-art.jpg', MANIFEST)
    expect(jpg?.path.endsWith('assets/skins/furina/furina-art.jpg') || jpg?.path.endsWith('assets\\skins\\furina\\furina-art.jpg')).toBe(true)
    expect(jpg?.type).toBe('image/jpeg')
    expect(resolveSkinAsset('/m/skin-assets/furina/alt.webp', MANIFEST)?.type).toBe('image/webp')
  })

  it('不在清单里的皮肤、或没登记的文件，一律拒绝', () => {
    expect(resolveSkinAsset('/m/skin-assets/unknown/a.png', MANIFEST)).toBeNull()
    expect(resolveSkinAsset('/m/skin-assets/furina/other.png', MANIFEST)).toBeNull()
  })

  it('缺 license 或 source 的皮肤不服务（合规闸门）', () => {
    expect(resolveSkinAsset('/m/skin-assets/pending/shot.png', MANIFEST)).toBeNull()
  })

  it('目录穿越与多段路径一律拒绝', () => {
    expect(resolveSkinAsset('/m/skin-assets/furina/../manifest.json', MANIFEST)).toBeNull()
    expect(resolveSkinAsset('/m/skin-assets/furina/..%2Fmanifest.json', MANIFEST)).toBeNull()
    expect(resolveSkinAsset('/m/skin-assets/../furina/furina-art.jpg', MANIFEST)).toBeNull()
    expect(resolveSkinAsset('/m/skin-assets/furina/sub/furina-art.jpg', MANIFEST)).toBeNull()
    expect(resolveSkinAsset('/m/skin-assets/furina', MANIFEST)).toBeNull()
  })

  it('前缀之外、或空清单，都解析不出来', () => {
    expect(resolveSkinAsset('/m/icon-192.png', MANIFEST)).toBeNull()
    expect(resolveSkinAsset('/m/skin-assets/furina/furina-art.jpg', {})).toBeNull()
  })

  it('content-type 按扩展名给，认不出按 png', () => {
    expect(assetContentType('a.JPG')).toBe('image/jpeg')
    expect(assetContentType('a.jpeg')).toBe('image/jpeg')
    expect(assetContentType('a.webp')).toBe('image/webp')
    expect(assetContentType('a.png')).toBe('image/png')
    expect(assetContentType('a.bin')).toBe('image/png')
  })
})
