// @vitest-environment jsdom
/**
 * 交付卡/工具卡里的路径 → 预览请求路径（2026-11-11 用户：「有的文件点开显示找不到」）。
 *
 * 现场是工具把路径写成相对它自己 cwd 的形式（`ui/sheet.tsx`），而预览要的是宿主上的
 * 真路径。`absolutePathOf` 用工具结果里的 meta 绝对路径按后缀把它换回来；换不到就原样
 * 返回，交给宿主端按会话 cwd / 工作区 / 后缀兜底去找 —— 这里钉住这三条。
 */
import { describe, expect, it } from 'vitest'
import { absolutePathOf } from './artifact-cards.tsx'

const META = [
  'C:\\repo\\packages\\dsh-palm\\src\\mobile\\ui\\sheet.tsx',
  'C:\\repo\\packages\\dsh-palm\\src\\mobile\\ui\\process-line.tsx',
]

describe('预览路径解析', () => {
  it('相对工具 cwd 的路径按后缀换成 meta 里的绝对路径', () => {
    expect(absolutePathOf('ui/sheet.tsx', META)).toBe(META[0])
    // 反斜杠写法同样能配上。
    expect(absolutePathOf('ui\\process-line.tsx', META)).toBe(META[1])
  })

  it('本来就是绝对路径就原样用（不猜、不改写）', () => {
    expect(absolutePathOf('D:\\other\\a.ts', META)).toBe('D:\\other\\a.ts')
    expect(absolutePathOf('/home/u/a.ts', META)).toBe('/home/u/a.ts')
  })

  it('meta 里配不上时原样返回，不编造路径', () => {
    expect(absolutePathOf('ui/not-there.tsx', META)).toBe('ui/not-there.tsx')
    expect(absolutePathOf('ui/sheet.tsx', undefined)).toBe('ui/sheet.tsx')
    expect(absolutePathOf('ui/sheet.tsx', [])).toBe('ui/sheet.tsx')
  })

  it('后缀按路径段比：ui/sheet.tsx 不能配到 xui/sheet.tsx', () => {
    expect(absolutePathOf('ui/sheet.tsx', ['C:\\repo\\mobile\\xui\\sheet.tsx'])).toBe('ui/sheet.tsx')
    expect(absolutePathOf('sheet.tsx', ['C:\\repo\\ui\\other.ts'])).toBe('sheet.tsx')
    // 只有一个文件名时也认（工具可能只写了文件名）。
    expect(absolutePathOf('sheet.tsx', ['C:\\repo\\ui\\sheet.tsx'])).toBe('C:\\repo\\ui\\sheet.tsx')
  })
})