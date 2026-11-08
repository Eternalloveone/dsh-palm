/**
 * ⑭ 外观（独立页面，P6 第 4 屏迁移）。
 *
 * 以前外观是设置页里的几个浮层（主题/字号/密度各一个）：改一项要开一次浮层，
 * 改完看不到"现在整体长什么样"。这一屏把它们放在一起，改完立刻生效。
 *
 * 只放**真正影响观感**的三项：皮肤、字号、主题。
 * 密度与行号属于阅读偏好，留在设置页，不在这里堆。
 *
 * @module dsh-palm/mobile/views/AppearanceView
 */
import { useState } from 'react'
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import {
  FONT_SCALE_LABEL,
  getFontScale,
  setFontScale,
  type FontScale,
} from '../platform/display-prefs.ts'
import { getSkin, setSkin, SKIN_HINT, SKIN_LABEL, type MobileSkin } from '../platform/skin.ts'
import { getMobileThemeMode, setMobileThemeMode, type MobileThemeMode } from '../mobile-theme.ts'

const SKINS: readonly MobileSkin[] = ['graphite', 'paper', 'nocturne']
const SCALES: readonly FontScale[] = ['small', 'standard', 'large']

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
  const [theme, setThemeState] = useState<MobileThemeMode>(() => getMobileThemeMode())

  const pickSkin = (next: MobileSkin): void => {
    setSkinState(next)
    setSkin(next)
  }

  const pickScale = (next: FontScale): void => {
    setScaleState(next)
    setFontScale(next)
  }

  const pickTheme = (next: MobileThemeMode): void => {
    setThemeState(next)
    setMobileThemeMode(next)
  }

  return (
    <SlotLayout
      spec={settingsLayout}
      className="appearance-page"
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
          <div className="appearance-page-body">
            <section className="appearance-section">
              <h2 className="appearance-title">皮肤</h2>
              {SKINS.map(name => (
                <Button
                  key={name}
                  className="appearance-row"
                  aria-pressed={skin === name}
                  onClick={() => { pickSkin(name) }}
                >
                  <span className="appearance-row-main">{SKIN_LABEL[name]}</span>
                  <span className="appearance-row-sub">{SKIN_HINT[name]}</span>
                  {skin === name ? <span className="appearance-row-mark">当前</span> : null}
                </Button>
              ))}
            </section>

            <section className="appearance-section">
              <h2 className="appearance-title">字号</h2>
              {SCALES.map(name => (
                <Button
                  key={name}
                  className="appearance-row"
                  aria-pressed={scale === name}
                  onClick={() => { pickScale(name) }}
                >
                  <span className="appearance-row-main">{FONT_SCALE_LABEL[name]}</span>
                  {scale === name ? <span className="appearance-row-mark">当前</span> : null}
                </Button>
              ))}
            </section>

            <section className="appearance-section">
              <h2 className="appearance-title">明暗</h2>
              {THEMES.map(name => (
                <Button
                  key={name}
                  className="appearance-row"
                  aria-pressed={theme === name}
                  onClick={() => { pickTheme(name) }}
                >
                  <span className="appearance-row-main">{THEME_LABEL[name]}</span>
                  {theme === name ? <span className="appearance-row-mark">当前</span> : null}
                </Button>
              ))}
            </section>

            <p className="appearance-page-hint">改完立刻生效，不用重启。</p>
          </div>
        ),
      }}
    />
  )
}
