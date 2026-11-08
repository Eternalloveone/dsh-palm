/**
 * ⑭ 外观（独立页面，P6 第 4 屏迁移；2026-11-08 按总览图「5 · 外观」统一版式）。
 *
 * 以前外观是设置页里的几个浮层（主题/字号/密度各一个）：改一项要开一次浮层，
 * 改完看不到"现在整体长什么样"。这一屏把它们放在一起，改完立刻生效。
 *
 * 版式：三张皮肤卡（色板即该皮肤真实配色，选中只加强调色描边、**不填充**）+
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
import { getSkin, setSkin, SKIN_HINT, SKIN_LABEL, type MobileSkin } from '../platform/skin.ts'
import { getMobileThemeMode, setMobileThemeMode, type MobileThemeMode } from '../mobile-theme.ts'

const SKINS: readonly MobileSkin[] = ['graphite', 'paper', 'nocturne']
const SCALES: readonly FontScale[] = ['small', 'standard', 'large']
const DENSITIES: readonly Density[] = ['compact', 'cozy']

/** 主题三档的中文说明。 */
const THEME_LABEL: Record<MobileThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
}

const THEMES: readonly MobileThemeMode[] = ['system', 'light', 'dark']

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
  const [skin, setSkinState] = useState<MobileSkin>(() => getSkin())
  const [scale, setScaleState] = useState<FontScale>(() => getFontScale())
  const [density, setDensityState] = useState<Density>(() => getDensity())
  const [theme, setThemeState] = useState<MobileThemeMode>(() => getMobileThemeMode())

  const pickSkin = (next: MobileSkin): void => { setSkinState(next); setSkin(next) }
  const pickScale = (next: FontScale): void => { setScaleState(next); setFontScale(next) }
  const pickDensity = (next: Density): void => { setDensityState(next); setDensity(next) }
  const pickTheme = (next: MobileThemeMode): void => { setThemeState(next); setMobileThemeMode(next) }

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
            <SpecGroupHead title="皮肤" note={`当前 ${SKIN_LABEL[skin]}`} />
            <div className="palm-spec-skins">
              {SKINS.map(name => (
                <Button
                  key={name}
                  className="palm-spec-skin"
                  data-skin={name}
                  aria-pressed={skin === name}
                  onClick={() => { pickSkin(name) }}
                >
                  {/* 定版图：皮肤不是一行文字，是一张能看见颜色的预览卡 */}
                  <span className="palm-spec-skin-sw" aria-hidden />
                  <span className="palm-spec-skin-name">{SKIN_LABEL[name]}</span>
                  <span className="palm-spec-skin-hint">{skin === name ? '选中' : SKIN_HINT[name]}</span>
                </Button>
              ))}
            </div>

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

            <SpecGroupHead title="明暗" note="跟随系统或手动" />
            <SpecGroup>
              {THEMES.map(name => (
                <SpecRow
                  key={name}
                  title={THEME_LABEL[name]}
                  value={theme === name ? '当前' : undefined}
                  pressed={theme === name}
                  onClick={() => { pickTheme(name) }}
                />
              ))}
            </SpecGroup>

            <p className="palm-spec-foot">改完立刻生效，不用重启。</p>
          </div>
        ),
      }}
    />
  )
}
