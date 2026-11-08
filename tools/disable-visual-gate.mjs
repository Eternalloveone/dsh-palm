import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')

/* ── 1) health-check：视觉门禁默认关闭，改成显式 --visual 才跑 ─────────── */
const hc = join(REPO, 'tools', 'health-check.mjs')
let text = readFileSync(hc, 'utf8')

text = text.replace(
  "const quick = flags.has('--quick') || flags.has('--json')",
  [
    "const quick = flags.has('--quick') || flags.has('--json')",
    '/** 视觉门禁默认关闭（2026-11-08 用户要求）：需要时显式 --visual 打开。 */',
    "const withVisual = flags.has('--visual')",
  ].join('\r\n'),
)

// 原来 if (quick) 跳过；现在只有显式 --visual 才跑
text = text.replace(
  'if (quick) {',
  'if (!withVisual || quick) {',
)
text = text.replace(
  "results.push({ name: '视觉门禁', ok: true, skipped: true, ms: 0, tail: ['--quick 跳过'] })",
  "results.push({ name: '视觉门禁', ok: true, skipped: true, ms: 0, tail: ['已按要求关闭（--visual 可打开）'] })",
)

writeFileSync(hc, text)
console.log('health-check：', text.includes('withVisual'), text.includes('已按要求关闭'))

/* ── 2) final-gates.ps1：串行链里去掉视觉与真机冒烟 ───────────────────── */
const fg = join(REPO, 'tools', 'final-gates.ps1')
let ps = readFileSync(fg, 'utf8')
const before = ps
ps = ps.replace(
  "Step 'visual'          { node tools/mobile-visual/run.mjs }",
  "# 视觉门禁已按要求关闭（2026-11-08）：需要时手动 node tools/mobile-visual/run.mjs",
)
ps = ps.replace(
  "Step 'scenarios'       { node tools/mobile-scenarios/run.mjs }",
  '# 真机冒烟同样默认不跑：node tools/mobile-scenarios/run.mjs --manual 手动执行',
)
ps = ps.replace(
  "Step 'health'          { node tools/health-check.mjs }",
  "Step 'health'          { node tools/health-check.mjs }",
)
if (ps !== before) {
  writeFileSync(fg, ps)
  console.log('final-gates.ps1：视觉/冒烟已从默认链移除')
} else {
  console.log('final-gates.ps1：未匹配到步骤行（检查缩进）')
}
