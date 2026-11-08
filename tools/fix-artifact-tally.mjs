import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'session', 'artifacts.ts')
let text = readFileSync(P, 'utf8')

text = text.replace(
  `/** 统计：总文件数（去重后）与交付物数量。 */
export function artifactTally(turns: readonly ArtifactTurn[]): { files: number; delivered: number } {
  let files = 0
  let delivered = 0
  for (const turn of turns) {
    files += turn.files.length
    delivered += turn.files.filter(file => file.kind === 'deliverable').length
  }
  return { files, delivered }
}`,
  `/**
 * 统计：**跨轮去重**的文件总数与交付物数量。
 *
 * 同一个文件可能在第 3 轮被改、第 4 轮被声明为交付物；按轮分组时它会出现两次，
 * 但"这次会话动了几个文件"对用户来说只有一个答案——所以这里跨轮去重。
 */
export function artifactTally(turns: readonly ArtifactTurn[]): { files: number; delivered: number } {
  const all = new Set<string>()
  const delivered = new Set<string>()
  for (const turn of turns) {
    for (const file of turn.files) {
      all.add(file.path)
      if (file.kind === 'deliverable') delivered.add(file.path)
    }
  }
  return { files: all.size, delivered: delivered.size }
}`,
)

writeFileSync(P, text)
console.log('tally 已改为跨轮去重')
