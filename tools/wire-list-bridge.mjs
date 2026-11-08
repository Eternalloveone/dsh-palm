import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views')
const VIEW = join(ROOT, 'SessionListView.tsx')
const APP = join(ROOT, 'App.tsx')

// 1) SessionListView：新增可选 bridge prop，订阅优先走 bridge
let view = readFileSync(VIEW, 'utf8')
const vEol = view.includes('\r\n') ? '\r\n' : ''
const vLines = view.split('\n')

const propAt = vLines.findIndex(line => line.includes('mux?: MuxClient | undefined'))
if (propAt >= 0 && !view.includes('bridge?: HostBridge')) {
  const indent = vLines[propAt].match(/^\s*/)[0]
  vLines.splice(propAt, 0, `${indent}/** P3：全站唯一订阅点；给了它就不再直接订阅 mux。 */${vEol}`)
  vLines.splice(propAt + 1, 0, `${indent}bridge?: HostBridge | undefined${vEol}`)
  view = vLines.join('\n')
  if (!view.includes("host-bridge.ts'")) {
    const lastImport = view.split('\n').reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
    const v2 = view.split('\n')
    v2.splice(lastImport + 1, 0, `import type { HostBridge } from '../kernels/host-bridge.ts'${vEol}`)
    view = v2.join('\n')
  }
  writeFileSync(VIEW, view)
  console.log('props 已加 bridge')
}

// 2) 订阅改用 bridge（缺省回落 mux，测试与旧宿主保持可用）
view = readFileSync(VIEW, 'utf8')
if (view.includes('return mux.onFrame((frame: MuxFrame) => {')) {
  view = view.replace(
    'return mux.onFrame((frame: MuxFrame) => {',
    'return (bridge ?? mux).onFrame((frame: MuxFrame) => {',
  )
  // 依赖数组带上 bridge
  view = view.replace(/\}, \[mux\]\)/g, '}, [mux, bridge])')
  writeFileSync(VIEW, view)
  console.log('订阅已改接 bridge')
}

// 3) App：把 bridgeRef.current 传下去
let app = readFileSync(APP, 'utf8')
if (!app.includes('bridge={bridgeRef.current}')) {
  app = app.replace(
    `          mux={muxRef.current}`,
    `          mux={muxRef.current}${vEol}          bridge={bridgeRef.current}`,
  )
  writeFileSync(APP, app)
  console.log('App 已传 bridge')
}
