import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views')
const VIEW = join(ROOT, 'ChatView.tsx')
const APP = join(ROOT, 'App.tsx')

let view = readFileSync(VIEW, 'utf8')
const eol = view.includes('\r\n') ? '\r' : ''

// 1) props
if (!view.includes('bridge?: HostBridge')) {
  view = view.replace(
    '  mux?: MuxClient | undefined',
    `  mux?: MuxClient | undefined${eol}  /** P3：全站唯一订阅点；给了它就不再直接订阅 mux。 */${eol}  bridge?: HostBridge | undefined`,
  )
  console.log('props 已加')
}

// 2) import
if (!view.includes("kernels/host-bridge.ts'")) {
  const lines = view.split('\n')
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import type { HostBridge } from '../kernels/host-bridge.ts'${eol}`)
  view = lines.join('\n')
  console.log('import 已加')
}

// 3) 解构
view = view.replace('export function ChatView({\n  session,', 'export function ChatView({\n  session,')
// 找出解构块里的 mux 字段（形如 `  mux,`）
if (!/^  mux,$/m.test(view)) {
  view = view.replace(/^  mux,$/m, '  mux,')
}
const hasDestructureBridge = /^  bridge,$/m.test(view)
if (!hasDestructureBridge) {
  view = view.replace(/^  mux,$/m, `  mux,${eol}  bridge,`)
  console.log('解构已加 bridge')
}

// 4) 订阅双路
if (view.includes('return mux.onFrame((frame: MuxFrame, frameRpcId?: string) => {')) {
  view = view.replace(
    `    return mux.onFrame((frame: MuxFrame, frameRpcId?: string) => {${eol}      reportConnectivity(true)${eol}      dispatchFrame(ctx, frame, frameRpcId)${eol}    })`,
    [
      `    const onFrame = (frame: MuxFrame, frameRpcId?: string): void => {`,
      `      reportConnectivity(true)`,
      `      dispatchFrame(ctx, frame, frameRpcId)`,
      `    }`,
      `    // P3：优先走全站唯一订阅点；没有 bridge 时（单测/旧宿主）仍直连 mux。`,
      `    return bridge === undefined ? mux.onFrame(onFrame) : bridge.onFrame(onFrame)`,
    ].join(eol),
  )
  view = view.replace('  }, [mux, session.sessionId, reconcileRunning, applyInbox])', '  }, [mux, bridge, session.sessionId, reconcileRunning, applyInbox])')
  writeFileSync(VIEW, view)
  console.log('订阅已双路')
}

// 5) App 传 bridge
let app = readFileSync(APP, 'utf8')
const site = app.indexOf('<ChatView')
if (site >= 0) {
  const near = app.slice(site, site + 400)
  if (!near.includes('bridge=')) {
    app = app.replace(/(<ChatView\s*\n(\s*)mux=\{muxRef\.current\})/, `$1${eol}$2bridge={bridgeRef.current}`)
    writeFileSync(APP, app)
    console.log('App 已传 bridge（ChatView）')
  } else {
    console.log('App 已有 bridge（ChatView）')
  }
}
