/**
 * ⑭ 外观（独立页面，P6 第 4 屏迁移；2026-11-08 按总览图「5 · 外观」统一版式）。
 *
 * 以前外观是设置页里的几个浮层（主题/字号/密度各一个）：改一项要开一次浮层，
 * 改完看不到"现在整体长什么样"。这一屏把它们放在一起，改完立刻生效。
 * 版式：
 * 字号 / 密度 / 明暗三组行（行内右侧是当前值）。尺寸走 --palm-spec-* 令牌，
 * 复用的是 `ui/screen-spec.tsx` 那一层（分组卡 + 行）。
 *
 * @module dsh-palm/mobile/views/AppearanceView
 */
import { useState } from 'react'
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { IconButton, Button } from '../ui/primitives.tsx'
import { SpecGroup, SpecGroupHead, SpecRow } from './screen-spec.tsx'
import {
  DENSITY_LABEL,
  FONT_SCALE_LABEL,
  getDensity,
  getFontScale,
  setDensity,
  setFontScale,
  type Density,
  type FontScale,
} from '../platform/display-prefs.ts'

const SCALES: readonly FontScale[] = ['small', 'standard', 'large']
const DENSITIES: readonly Density[] = ['compact', 'cozy']

export interface AppearanceViewProps {
  onBack(): void
}

/**
 * 渲染外观页。
 *
 * @param props - 返回回调
 * @returns 外观页
 */
export function AppearanceView({ onBack }: AppearanceViewProps) {
  const [scale, setScaleState] = useState<FontScale>(() => getFontScale())
  const [density, setDensityState] = useState<Density>(() => getDensity())

  const pickScale = (next: FontScale): void => { setScaleState(next); setFontScale(next) }
  const pickDensity = (next: Density): void => { setDensityState(next); setDensity(next) }

  return (
    <SlotLayout
      spec={settingsLayout}
      className="palm-spec-page appearance-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">外观</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        groups: (
          <div className="palm-spec-body">
            <SpecGroupHead title="字号" note="正文行高 1.5" />
            <SpecGroup>
              {SCALES.map(name => (
                <SpecRow
                  key={name}
                  title={FONT_SCALE_LABEL[name]}
                  value={scale === name ? '当前' : undefined}
                  pressed={scale === name}
                  onClick={() => { pickScale(name) }}
                />
              ))}
            </SpecGroup>

            <SpecGroupHead title="密度" note="行距与留白" />
            <SpecGroup>
              {DENSITIES.map(name => (
                <SpecRow
                  key={name}
                  title={DENSITY_LABEL[name]}
                  value={density === name ? '当前' : undefined}
                  pressed={density === name}
                  onClick={() => { pickDensity(name) }}
                />
              ))}
            </SpecGroup>

            <p className="palm-spec-foot">明暗由皮肤决定：石墨 / 夜航是深色底，纸是浅色底。改完立刻生效，不用重启。</p>
          </div>
        ),
      }}
    />
  )
}
