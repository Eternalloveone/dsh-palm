import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views')
const VIEW = join(ROOT, 'RunOverviewView.tsx')
const APP = join(ROOT, 'App.tsx')

let view = readFileSync(VIEW, 'utf8')
const eol = view.includes('\r\n') ? '\r' : ''
const lines = view.split('\n')

// 1) props：在 mux 之后加 bridge
const propAt = lines.findIndex(line => line.includes('mux?: RunOverviewMux | undefined'))
if (propAt >= 0 && !view.includes('bridge?: HostBridge')) {
  const indent = lines[propAt].match(/^\s*/)[0]
  lines.splice(propAt + 1, 0, `${indent}/** P3：全站唯一订阅点；给了它就不再直接订阅 mux。 */${eol}`)
  lines.splice(propAt + 2, 0, `${indent}bridge?: HostBridge | undefined${eol}`)
  view = lines.join('\n')
  console.log('props 已加 bridge')
}

// 2) import
if (!view.includes("kernels/host-bridge.ts'")) {
  const v2 = view.split('\n')
  const lastImport = v2.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  v2.splice(lastImport + 1, 0, `import type { HostBridge } from '../kernels/host-bridge.ts'${eol}`)
  view = v2.join('\n')
  console.log('import 已加')
}

// 3) 解构 + 依赖 + 订阅
view = view.replace(
  'export function RunOverviewView({ mux, onBack, onOpenSession, onOpenSubagent }',
  'export function RunOverviewView({ mux, bridge, onBack, onOpenSession, onOpenSubagent }',
)
view = view.replace(
  '    const unsubscribe = mux.onFrame(onFrame)',
  `    // P3：优先走全站唯一订阅点；没有 bridge 时（单测/旧宿主）仍直连 mux。
    const unsubscribe = bridge === undefined ? mux.onFrame(onFrame) : bridge.onFrame(onFrame)`,
)
view = view.replace('  }, [mux])', '  }, [mux, bridge])')
writeFileSync(VIEW, view)

// 4) App 传 bridge
let app = readFileSync(APP, 'utf8')
if (!app.includes('bridge={bridgeRef.current}\n') || app.split('bridge={bridgeRef.current}').length < 3) {
  app = app.replace(
    `      ? <RunOverviewView${eol}        mux={muxRef.current}`,
    `      ? <RunOverviewView${eol}        mux={muxRef.current}${eol}        bridge={bridgeRef.current}`,
  )
  writeFileSync(APP, app)
  console.log('App 已传 bridge（RunOverview）')
}
