import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r' : ''
const lines = text.split('\n')

// 1) 删除本地的 fetchPreview 与 mapLimited 定义
function dropAsync(name) {
  const start = lines.findIndex(line => line.replace(/\r$/, '').startsWith(`async function ${name}`))
  if (start < 0) return 0
  let docStart = start
  while (docStart > 0) {
    const prev = lines[docStart - 1].replace(/\r$/, '')
    if (prev.startsWith(' *') || prev.startsWith('/**') || prev.startsWith('//')) docStart -= 1
    else break
  }
  let end = start
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '}') { end = i; break }
  }
  const n = end - docStart + 1
  lines.splice(docStart, n)
  return n
}
const removed = { fetchPreview: dropAsync('fetchPreview'), mapLimited: dropAsync('mapLimited') }

let out = lines.join('\n')

// 2) 加 import（fetchSessionPreview + mapLimited）
if (!out.includes('preview-slice.ts')) {
  const arr = out.split('\n')
  const lastImport = arr.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  arr.splice(lastImport + 1, 0, `import { fetchSessionPreview, mapLimited } from '../kernels/preview-slice.ts'${eol}`)
  out = arr.join('\n')
}

// 3) 调用点：fetchPreview(x, y) → fetchSessionPreview(previewDeps, x, y)
out = out.replace(/\bfetchPreview\(/g, 'fetchSessionPreview(previewDeps, ')

// 4) 定义 previewDeps（放在组件内、首次使用前不现实——放模块级，注入实现）
if (!out.includes('const previewDeps')) {
  const marker = "export const sessionPreviewCache = new Map<string, string>()"
  out = out.replace(
    marker,
    `${marker}${eol}${eol}/** 预览切片的依赖注入：读取、折叠、压缩各一件，便于单测替换。 */${eol}const previewDeps = { history, foldEvents, previewSummary }`,
  )
}

writeFileSync(P, out)
console.log('删：', JSON.stringify(removed), '；行数：', out.split('\n').length)
