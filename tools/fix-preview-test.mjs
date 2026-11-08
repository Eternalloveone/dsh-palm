import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'kernels', 'preview-slice.test.ts')
let text = readFileSync(P, 'utf8')

// 测试里的假实现只关心形状：统一用 as never 收边界
text = text.replace(
  "    history: async () => ({ events: [{ event: { kind: 'message' } }] }),",
  "    history: async () => ({ events: [{ event: { type: 'message' } }] }) as never,",
)
text = text.replace(
  "    foldEvents: () => [{ text: 'hello world' }],",
  "    foldEvents: (() => [{ text: 'hello world' }]) as never,",
)
text = text.replace(
  "      foldEvents: () => [{ text: 'first' }, { text: 'second' }],",
  "      foldEvents: (() => [{ text: 'first' }, { text: 'second' }]) as never,",
)
text = text.replace(
  "    const deps = makeDeps({ foldEvents: () => [{ text: '', reasoning: 'thinking...' }] })",
  "    const deps = makeDeps({ foldEvents: (() => [{ text: '', reasoning: 'thinking...' }]) as never })",
)
text = text.replace(
  "      foldEvents: () => [{ text: 'real one' }, { text: '   ' }],",
  "      foldEvents: (() => [{ text: 'real one' }, { text: '   ' }]) as never,",
)
text = text.replace(
  "    const deps = makeDeps({ foldEvents: () => [{ text: '' }, { text: '' }] })",
  "    const deps = makeDeps({ foldEvents: (() => [{ text: '' }, { text: '' }]) as never })",
)
text = text.replace(
  "    const history = vi.fn(async () => ({ events: [] }))",
  "    const history = vi.fn(async () => ({ events: [] }) as never)",
)

writeFileSync(P, text)
console.log('测试依赖已用 as never 收边界')
