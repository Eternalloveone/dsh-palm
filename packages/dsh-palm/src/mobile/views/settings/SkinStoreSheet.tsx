/**
 * 皮肤商店（全屏浮层）：点卡片当场试穿，退出前不保存。
 *
 * 入口在设置首屏第一组（2026-11-11 用户选定 A 方案：不加抽屉第 4 行）。
 *
 * 交互只有三种结局：
 * - 点卡片 → `previewSkin()`：整屏立刻换成那套，但**不落盘**；
 * - 「取消」/左上返回 / 系统返回 → 还原进店时那套；
 * - 「用这一套」→ `setSkin()` 落盘并退出。
 *
 * 为什么要试穿：皮肤决定整屏的底色、气泡、强调色，光看缩略图选不准。
 *
 * @module dsh-palm/mobile/views/settings/SkinStoreSheet
 */
import { useEffect, useRef, useState } from 'react'
import type { MobileSkin } from '../../platform/skin.ts'
import { getSkin, previewSkin, setSkin } from '../../platform/skin.ts'
import { SKIN_CATALOG, type SkinCatalogEntry } from '../../platform/skin-catalog.ts'
import { Sheet } from '../../ui/sheet.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface SkinStoreSheetProps {
  /** 关掉浮层（不负责保存，由本组件的「用这一套」自己写）。 */
  onClose(): void
}

/**
 * 渲染皮肤商店。
 *
 * @param props - 关闭回调
 * @returns 全屏浮层
 */
export function SkinStoreSheet({ onClose }: SkinStoreSheetProps) {
  /** 进店时那套皮肤：取消/意外退出时还原成它。 */
  const originalRef = useRef<MobileSkin>(getSkin())
  const [picked, setPicked] = useState<MobileSkin>(originalRef.current)
  /** 已经点过「用这一套」：卸载时不要再还原。 */
  const committedRef = useRef(false)

  // 组件卸载（含系统返回、页面被顶掉）时兜底还原：试穿没确认就当没发生过。
  useEffect(() => () => {
    if (!committedRef.current) setSkin(originalRef.current)
  }, [])

  const pick = (id: MobileSkin): void => {
    setPicked(id)
    previewSkin(id)
  }

  const cancel = (): void => {
    setSkin(originalRef.current)
    onClose()
  }

  const apply = (): void => {
    committedRef.current = true
    setSkin(picked)
    onClose()
  }

  return (
    <Sheet title="皮肤" onClose={cancel}>
      <p className="skin-store-hint">点一下就当场换，退出前不会保存</p>
      <div className="skin-store-grid" role="list">
        {SKIN_CATALOG.map(entry => (
          <SkinCard
            key={entry.id}
            entry={entry}
            selected={entry.id === picked}
            onPick={() => { pick(entry.id) }}
          />
        ))}
      </div>
      <div className="skin-store-foot">
        <Button type="button" className="mobile-button" onClick={cancel}>取消</Button>
        <Button type="button" className="mobile-button mobile-button-primary" onClick={apply}>用这一套</Button>
      </div>
    </Sheet>
  )
}

/**
 * 一张皮肤卡：上面是这套配色的迷你版界面，下面是名字、说明与来源。
 *
 * @param props - 条目、是否选中、点击回调
 * @returns 卡片
 */
function SkinCard({ entry, selected, onPick }: {
  entry: SkinCatalogEntry
  selected: boolean
  onPick(): void
}) {
  return (
    <div role="listitem">
      <Button
        type="button"
        className={'skin-card' + (selected ? ' skin-card-on' : '')}
        aria-pressed={selected}
        onClick={onPick}
      >
        {/* 迷你预览：只用这套皮肤自己的底色与强调色画三块（顶栏 / 气泡 / 输入条）。
            颜色来自 000-tokens.css 的 --palm-skin-*-bg/-ink，卡片里不写任何色值，
            也就不会跟真皮肤走偏、不会绕过皮肤契约。 */}
        <span className="skin-card-shot" data-skin={entry.id}>
          <span className="skin-card-shot-bar" />
          <span className="skin-card-shot-bubble" />
          <span className="skin-card-shot-input" />
        </span>
        <span className="skin-card-name">{entry.label}</span>
        <span className="skin-card-hint">{entry.hint}</span>
        <span className="skin-card-source">{entry.source}</span>
        {selected ? <span className="skin-card-tick" aria-hidden="true">✓</span> : null}
      </Button>
    </div>
  )
}
