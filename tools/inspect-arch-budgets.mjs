import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const ARCH = join(PKG, 'src', 'mobile', 'architecture.test.ts')
const VIEWS = join(PKG, 'src', 'mobile', 'views')
const text = readFileSync(ARCH, 'utf8')

const isSource = name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')
const files = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs)
    else if (isSource(name)) files.push(abs)
  }
}
walk(VIEWS)

let hit = 0
const miss = []
for (const file of files) {
  const rel = 'views/' + relative(VIEWS, file).split(sep).join('/')
  const pattern = new RegExp(`'${rel.replace(/\./g, '\\.')}': ([\\d_]+),`)
  if (pattern.test(text)) hit += 1
  else miss.push(rel)
}

console.log(`匹配 ${hit}/${files.length} 个视图文件`)
console.log('没有预算登记：', miss.join(', ') || '（无）')
