import { describe, expect, it } from 'vitest'
import { contextEntryTarget, permissionEntryTarget } from './entry-routing.ts'

describe('对话页入口归属（P6 ⑥ ⑦）', () => {
  it('接了上下文页就走页面', () => {
    expect(contextEntryTarget(true, true)).toBe('page')
  })

  it('没接页面才退回气泡（老用法不变）', () => {
    expect(contextEntryTarget(true, false)).toBe('popover')
  })

  it('没有用量数据时什么都不做', () => {
    expect(contextEntryTarget(false, true)).toBe('none')
    expect(contextEntryTarget(false, false)).toBe('none')
  })

  it('接了批准方式页就走页面', () => {
    expect(permissionEntryTarget(true)).toBe('page')
  })

  it('没接页面才弹选择面板', () => {
    expect(permissionEntryTarget(false)).toBe('sheet')
  })
})
