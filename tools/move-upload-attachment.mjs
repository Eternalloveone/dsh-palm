// mobile.uploadAttachment 原位替换；MAX_ATTACHMENT_BASE64_CHARS 一并搬到 constants.ts。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const CONST = join(PKG, 'src', 'mobile', 'api', 'constants.ts')

const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

// 常量的值与注释
const at = lines.findIndex(line => line.replace(/\r$/, '').startsWith('const MAX_ATTACHMENT_BASE64_CHARS'))
let constValue = '20 * 1024 * 1024 * 4 / 3'
if (at >= 0) {
  constValue = lines[at].replace(/\r$/, '').replace('const MAX_ATTACHMENT_BASE64_CHARS = ', '').replace(/;$/, '').trim()
  lines.splice(at, 1)
}

let constText = readFileSync(CONST, 'utf8')
if (!constText.includes('MAX_ATTACHMENT_BASE64_CHARS')) {
  constText += `\n/** 附件 base64 字符数上限（对应 20 MB 原始字节）。 */\nexport const MAX_ATTACHMENT_BASE64_CHARS = ${constValue}\n`
  writeFileSync(CONST, constText)
}

const KEY = 'MOBILE_UPLOAD_ATTACHMENT_METHOD'
const start = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
if (start < 0) { console.log('未找到 uploadAttachment'); process.exit(0) }
let end = start
for (let i = start; i < lines.length; i += 1) {
  if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
}
const indent = lines[start].match(/^\s*/)[0]
lines.splice(start, end - start + 1, `${indent}[${KEY}, async (ctx) => mobileUploadAttachment(ctx)],${eol}`)

if (!lines.some(line => line.includes('mobile-upload.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileUploadAttachment } from './mobile/api/mobile-upload.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`uploadAttachment 已换：删 ${end - start + 1} 行；${raw.split('\n').length} → ${lines.length} 行`)
