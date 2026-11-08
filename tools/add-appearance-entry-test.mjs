import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SettingsView.test.tsx')
let text = readFileSync(P, 'utf8')

if (!text.includes('外观与皮肤')) {
  // 这条测试存在的意义：防「页面做好了但没人能点进去」。
  // 路由守卫只验 App 侧有没有 navigate，验不到"谁触发它"。
  const block = [
    '',
    "  it('设置页给出「外观与皮肤」入口，点了真能进外观页', () => {",
    '    const onOpenAppearance = vi.fn()',
    '    render(<SettingsView onBack={() => {}} onOpenAppearance={onOpenAppearance} />)',
    '    const row = screen.getByText(\'外观与皮肤\').closest(\'button\')',
    '    expect(row).not.toBeNull()',
    '    row!.click()',
    '    expect(onOpenAppearance).toHaveBeenCalledTimes(1)',
    '  })',
    '',
    "  it('不给回调时不渲染这一行（老页面行为不变）', () => {",
    '    render(<SettingsView onBack={() => {}} />)',
    '    expect(screen.queryByText(\'外观与皮肤\')).toBeNull()',
    '  })',
    '',
  ].join('\r\n')

  const end = text.lastIndexOf('})')
  text = text.slice(0, end) + block + text.slice(end)
  writeFileSync(P, text)
}

console.log('已加入口测试:', text.includes('外观与皮肤'))
