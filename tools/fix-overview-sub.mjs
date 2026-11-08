import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'RunOverviewView.tsx')
const text = readFileSync(P, 'utf8')
const updated = text.replace(
  'const unsubscribe = bridge === undefined ? mux.onFrame(onFrame) : bridge.onFrame(onFrame)',
  'const unsubscribe = bridge === undefined\n      ? mux.onFrame(onFrame)\n      : bridge.onFrame(onFrame as unknown as Parameters<typeof bridge.onFrame>[0])',
)
writeFileSync(P, updated)
console.log('双路订阅已加类型桥接:', updated !== text)
