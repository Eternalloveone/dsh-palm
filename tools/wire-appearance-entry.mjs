import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

/* 发现：onOpenAppearance 在 SettingsView 里只解构、从未调用 →
   ⑭ 外观页在生产里**点不进去**（路由守卫只验了 App 侧有 navigate，没验谁触发）。
   补一个真实入口：外观组第一条「外观与皮肤」。 */

/* 1) 分组组件加可选回调 */
const section = join(PKG, 'src', 'mobile', 'views', 'settings', 'appearance-section.tsx')
let text = readFileSync(section, 'utf8')

if (!text.includes('onOpenAppearance')) {
  text = text.replace(
    '  showTheme, showFont, showDensity, showLineNumbers, showAutoScroll, showHaptics,',
    '  showTheme, showFont, showDensity, showLineNumbers, showAutoScroll, showHaptics, onOpenAppearance,',
  )
  // 接口里加字段（跟在最后一个可选字段后）
  text = text.replace(
    /export interface AppearanceSectionProps \{/,
    'export interface AppearanceSectionProps {' + eol + '  /** 打开「外观」独立页；不给就不显示这一行（老版设置页行为不变）。 */' + eol + '  onOpenAppearance?: (() => void) | undefined',
  )
  // 组内第一条：外观与皮肤
  text = text.replace(
    '          <li className="settings-groupTitle">外观 <span className="settings-groupDesc">显示效果</span></li>',
    '          <li className="settings-groupTitle">外观 <span className="settings-groupDesc">显示效果</span></li>' + eol +
      '          {onOpenAppearance === undefined ? null : (' + eol +
      '            <SettingsRow' + eol +
      '              icon={<ContrastIcon />}' + eol +
      '              title="外观与皮肤"' + eol +
      '              desc="皮肤、字号、明暗在一页里调"' + eol +
      '              action={<RowChevron />}' + eol +
      '              onClick={onOpenAppearance}' + eol +
      '            />' + eol +
      '          )}',
  )
  writeFileSync(section, text)
}

/* 2) SettingsView 透传 */
const view = join(PKG, 'src', 'mobile', 'views', 'SettingsView.tsx')
let settings = readFileSync(view, 'utf8')
if (settings.includes('onOpenAppearance') && !settings.includes('onOpenAppearance={onOpenAppearance}')) {
  settings = settings.replace(
    /<AppearanceSection\r?\n(\s*)/,
    match => `${match}onOpenAppearance={onOpenAppearance}${eol}${match.slice(0, -2)}`,
  )
  writeFileSync(view, settings)
}

console.log('section:', text.includes('外观与皮肤'), '| view:', settings.includes('onOpenAppearance={onOpenAppearance}'))
