import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')

text = text.replace(
  `const workspace = {
  workspaceId: 'ws-1' as never,
  path: '/repo',
  title: 'repo',
  sessionIds: [] as never,
}`,
  `const workspace = {
  workspaceId: 'ws-1',
  path: '/repo',
  title: 'repo',
  sessionIds: [],
  createdAt: 0,
  updatedAt: 0,
} as never`,
)

text = text.replace(
  `const standaloneWorkspace = { workspaceId: 'standalone' as never, path: '', title: '未分组', sessionIds: [] as never }`,
  `const standaloneWorkspace = { workspaceId: 'standalone', path: '', title: '未分组', sessionIds: [], createdAt: 0, updatedAt: 0 } as never`,
)

writeFileSync(P, text)
console.log('fixtures 补齐 WorkspaceView 必填字段')
