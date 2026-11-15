/**
 * 背景图浮层：和「皮肤商店」同一栏目下的第二行打开它。
 *
 * 为什么不塞进皮肤商店那张浮层：商店的约定是「试穿 → 取消还原 → 用这一套」，
 * 一次事务。背景图是即时生效、和皮肤选择互不影响的另一件事，混进去会让「取消」
 * 到底撤销什么变得说不清。所以两者并列在「皮肤与背景」栏目里，各开各的浮层。
 *
 * @module dsh-palm/mobile/views/settings/WallpaperSheet
 */
import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../../ui/sheet.tsx'
import { Button } from '../../ui/primitives.tsx'
import {
  getWallpaper,
  setWallpaper,
  shrinkImageToDataUrl,
  subscribeWallpaper,
} from '../../platform/wallpaper.ts'

export interface WallpaperSheetProps {
  /** 关掉浮层（背景图是即时生效的，关掉即保存）。 */
  onClose(): void
}

/** 渲染背景图浮层。 */
export function WallpaperSheet({ onClose }: WallpaperSheetProps) {
  const [wall, setWallState] = useState(() => getWallpaper())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => subscribeWallpaper(() => setWallState(getWallpaper())), [])

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    setBusy(true)
    setError(null)
    try {
      setWallState(setWallpaper({ image: await shrinkImageToDataUrl(file) }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这张图用不了，换一张再试')
    } finally {
      setBusy(false)
      if (fileRef.current !== null) fileRef.current.value = ''
    }
  }

  return (
    <Sheet title="背景图" onClose={onClose}>
      <p className="skin-store-hint">本机图片，不上传；卡片保持不透明，正文不会被图抢。</p>

      {wall.image === null ? (
        <p className="skin-store-hint">还没设背景图。选一张图，页面底色会让位给它。</p>
      ) : (
        <div className="wall-sheet-rows">
          <WallSlider
            label="遮罩"
            value={wall.mask}
            min={0}
            max={100}
            step={5}
            format={value => `${value}%`}
            onChange={mask => { setWallState(setWallpaper({ mask })) }}
          />
          <WallSlider
            label="模糊"
            value={wall.blur}
            min={0}
            max={20}
            step={1}
            format={value => `${value}px`}
            onChange={blur => { setWallState(setWallpaper({ blur })) }}
          />
        </div>
      )}

      {error === null ? null : <p className="wall-error" role="alert">{error}</p>}

      <div className="skin-store-foot">
        <Button type="button" className="mobile-button" onClick={() => { fileRef.current?.click() }} disabled={busy}>
          {busy ? '正在压图…' : wall.image === null ? '选一张图' : '换一张图'}
        </Button>
        {wall.image === null ? null : (
          <Button type="button" className="mobile-button" onClick={() => { setWallState(setWallpaper({ image: null })) }}>
            去掉背景图
          </Button>
        )}
        <Button type="button" className="mobile-button mobile-button-primary" onClick={onClose}>完成</Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="wall-file"
        onChange={event => { void onPickFile(event.target.files?.[0]) }}
      />
    </Sheet>
  )
}

/** 一行滑杆：标题 + 原生 range + 当前值。 */
function WallSlider({ label, value, min, max, step, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format(value: number): string
  onChange(value: number): void
}) {
  return (
    <div className="wall-slider-row">
      <span className="wall-slider-label">{label}</span>
      <input
        className="wall-slider"
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => { onChange(Number(event.target.value)) }}
      />
      <span className="wall-slider-value">{format(value)}</span>
    </div>
  )
}
