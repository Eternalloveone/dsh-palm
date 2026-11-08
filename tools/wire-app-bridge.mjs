import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.tsx')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

if (!text.includes('createHostBridge }')) {
  text = text.replace(
    "import { MuxClient } from '../stream/mux.ts'",
    `import { createHostBridge } from '../kernels/host-bridge.ts'${eol}import { MuxClient } from '../stream/mux.ts'`,
  )
}

if (!text.includes('bridgeRef')) {
  text = text.replace(
    'const muxRef = useRef<MuxClient | undefined>(undefined)',
    `const muxRef = useRef<MuxClient | undefined>(undefined)${eol}  const bridgeRef = useRef<ReturnType<typeof createHostBridge> | undefined>(undefined)`,
  )
}

writeFileSync(P, text)
console.log('import:', text.includes('createHostBridge }'), 'ref:', text.includes('bridgeRef'))
