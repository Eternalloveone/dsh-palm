/**
 * 外观面板（底部弹层）：点头像就能换皮肤，不用绕「设置 → 皮肤商店」。
 *
 * 三个交互约定（2026-11-14 用户选定，见 mockups/appearance-sheet.html）：
 *   1. 点卡片当场生效（`setSkin` 立刻落盘，不做试穿），底部给 3 秒「撤销」；
 *   2. 🎲 随机换一套带图的皮肤，长按回到上一套；
 *   3. 背景图一行直接接到现有 `WallpaperSheet`，避免两个入口各写一套。
 *
 * 为什么不做「试穿 + 确定」：这个入口的使用场景是「随手换个心情」，多一步确认
 * 就失去了随手性；误触由撤销条兜底，比确认框轻。
 *
 * @module dsh-palm/mobile/views/settings/AppearanceSheet
 */
import { useEffect, useRef, useState } from 'react'
import type { MobileSkin } from '../../platform/skin.ts'
import { SKIN_LABEL, getSkin, setSkin, subscribeSkin } from '../../platform/skin.ts'
import { SKIN_CATALOG } from '../../platform/skin-catalog.ts'
import { getWallpaper, subscribeWallpaper } from '../../platform/wallpaper.ts'
import { Sheet } from '../../ui/sheet.tsx'
import { Button } from '../../ui/primitives.tsx'
import { WallpaperSheet } from './WallpaperSheet.tsx'

/** 带素材/装饰、缩略图有辨识度的那批（随机换只在这种里跳）。 */
const ART_SKINS: MobileSkin[] = [
  'maid-atelier', 'cyber-night', 'blue-fantasy', 'harbor', 'whale-song', 'war-thunder',
  'dragon-heir', 'furina', 'pink-sakura', 'minecraft', 'trading', 'xp',
  'wallpaper-exclusive', 'whale-mom', 'deep-current',
]

/** 撤销条停留时长（毫秒）。 */
const UNDO_MS = 3200

export interface AppearanceSheetProps {
  /** 关掉面板。 */
  onClose(): void
}

/**
 * 渲染外观面板。
 *
 * @param props - 关闭回调
 * @returns 底部弹层
 */
export function AppearanceSheet({ onClose }: AppearanceSheetProps) {
  const [current, setCurrent] = useState<MobileSkin>(getSkin)
  const [pending, setPending] = useState<{ prev: MobileSkin } | null>(null)
  const [wallOpen, setWallOpen] = useState(false)
  const [, bumpWall] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)

  // 皮肤可能在别处被改（设置页商店），面板里跟着变。
  useEffect(() => subscribeSkin(() => { setCurrent(getSkin()) }), [])
  useEffect(() => subscribeWallpaper(() => { bumpWall(n => n + 1) }), [])
  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current) }, [])

  // 打开面板（或换完装）时把当前皮肤滚到中间：否则第一屏看到的是列表开头的几套，
  // 用户会以为"当前这套没了"。
  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const active = strip.querySelector('.appearance-chip-on')
    if (active instanceof HTMLElement) active.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [current])

  const commit = (next: MobileSkin): void => {
    const prev = current
    if (next === prev) return
    setSkin(next)
    setCurrent(next)
    setPending({ prev })
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { setPending(null) }, UNDO_MS)
  }

  const undo = (): void => {
    if (pending === null) return
    setSkin(pending.prev)
    setCurrent(pending.prev)
    setPending(null)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }

  const shuffle = (): void => {
    const pool = ART_SKINS.filter(id => id !== current)
    const next = pool[Math.floor(Math.random() * pool.length)]
    if (next !== undefined) commit(next)
  }

  const wall = getWallpaper()
  const withArt = SKIN_CATALOG.filter(entry => ART_SKINS.includes(entry.id))

  if (wallOpen) {
    return (
      <WallpaperSheet
        onClose={() => {
          setWallOpen(false)
          bumpWall(n => n + 1)
        }}
      />
    )
  }

  return (
    <Sheet title="外观" onClose={onClose}>
      <div className="appearance-sheet">
        <div className="appearance-head">
          <span className="appearance-sub">
            当前：{SKIN_LABEL[current]} · 带图 {withArt.length} 套
          </span>
          <Button
            type="button"
            className="appearance-dice"
            aria-label="随机换一套外观"
            onClick={shuffle}
          >
            🎲
          </Button>
        </div>

        {/* 横向皮肤画廊：点一下立刻换（复用商店卡的配色变量，不新写色值）。 */}
        <div className="appearance-strip" role="list" ref={stripRef}>
          {withArt.map(entry => (
            <div key={entry.id} role="listitem">
              <Button
                type="button"
                className={'appearance-chip' + (entry.id === current ? ' appearance-chip-on' : '')}
                aria-pressed={entry.id === current}
                onClick={() => { commit(entry.id) }}
              >
                <span className="skin-card-shot" data-skin={entry.id}>
                  <span className="skin-card-shot-bar" />
                  <span className="skin-card-shot-bubble" />
                  <span className="skin-card-shot-input" />
                </span>
                <span className="appearance-chip-name">{entry.label}</span>
              </Button>
            </div>
          ))}
        </div>

        <div className="appearance-wall">
          <span
            className="appearance-wall-thumb"
            style={wall.image === null ? undefined : { backgroundImage: `url(${wall.image})` }}
            aria-hidden="true"
          />
          <span className="appearance-wall-text">
            <b>背景图</b>
            <small>
              {wall.image === null ? '未设置 · 用皮肤自己的底' : `已设置 · 遮罩 ${wall.mask}% · 模糊 ${wall.blur}px`}
            </small>
          </span>
          <Button type="button" className="appearance-wall-act" onClick={() => { setWallOpen(true) }}>
            换一张
          </Button>
        </div>

        <div className="appearance-foot">
          <Button
            type="button"
            className="appearance-link"
            onClick={() => { commit('graphite') }}
          >
            恢复默认外观
          </Button>
          <Button type="button" className="appearance-link" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>

      {pending === null ? null : (
        <div className="appearance-undo" role="status">
          已换装 <b>{SKIN_LABEL[current]}</b>
          <Button type="button" className="appearance-undo-act" onClick={undo}>撤销</Button>
        </div>
      )}
    </Sheet>
  )
}
