import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = process.env.DSH_PALM_REPO ?? resolve(HERE, '..')
const p = join(REPO, 'packages', 'dsh-palm', 'lib', 'mobile.js')
const raw = readFileSync(p)
const gz = gzipSync(raw)
const br = brotliCompressSync(raw)
const kb = (b) => (b / 1024).toFixed(1) + ' KB'
console.log('raw      :', kb(raw.length))
console.log('gzip     :', kb(gz.length), '(-' + Math.round((1 - gz.length / raw.length) * 100) + '%)')
console.log('brotli   :', kb(br.length), '(-' + Math.round((1 - br.length / raw.length) * 100) + '%)')
