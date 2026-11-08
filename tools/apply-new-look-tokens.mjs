import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '000-tokens.css')
let text = readFileSync(P, 'utf8')

/* ── 1) 字号阶梯：整条上移（更大字）────────────────────────────────── */
text = text.replace(
  `  --palm-t-s: 12px;\n  --palm-t-m: 14px;\n  --palm-t-l: 17px;\n  --palm-t-xl: 22px;\n  --palm-t-2xl: 28px;`,
  `  --palm-t-xs: 13px;\n  --palm-t-s: 14px;\n  --palm-t-m: 15px;\n  --palm-t-l: 18px;\n  --palm-t-xl: 23px;\n  --palm-t-2xl: 28px;`,
)

/* ── 2) 行高：更宽松 ───────────────────────────────────────────────── */
text = text.replace('  --palm-lh-body: 1.5;', '  --palm-lh-body: 1.6;')
text = text.replace('  --palm-lh-head: 1.3;', '  --palm-lh-head: 1.35;')

/* ── 3) 间距：大档更长（更宽松），小档不动 ─────────────────────────── */
text = text.replace(
  `  --palm-s5: 20px;\n  --palm-s6: 24px;`,
  `  --palm-s5: 24px;\n  --palm-s6: 28px;\n  --palm-s7: 32px;\n  --palm-s8: 36px;`,
)

/* ── 4) 圆角：整体圆一点，并补 full ─────────────────────────────────── */
text = text.replace(
  `  --palm-r-s: 8px;\n  --palm-r-m: 12px;\n  --palm-r-l: 18px;`,
  `  --palm-r-s: 10px;\n  --palm-r-m: 14px;\n  --palm-r-l: 20px;\n  --palm-r-full: 9999px;`,
)

/* ── 5) 触控目标：字大了，目标也放大 2px ───────────────────────────── */
text = text.replace('  --palm-hit: 44px;', '  --palm-hit: 46px;')

/* ── 6) 旧变量桥接：767 处历史 CSS 全部改由 --palm-* 驱动 ──────────────
   关键：designTokensCss() 注入在 000 之前，所以这里的 var() 覆盖它的字面值；
   以后只改 --palm-*，全站（含未迁移的旧样式）一起变。 */
const bridge = `

/* ── 旧名桥接（一次性）：历史样式的 767 处引用改由上面的 --palm-* 驱动 ──
   designTokensCss() 先注入，这一段在它之后，因此这里的映射会覆盖旧字面值。
   下一步是把旧名逐批替换掉，届时删掉本段即可。 */
:root {
  /* 字号：整条上移一档（旧 11/12/13/15/16.5 → 新 13/14/15/18/23） */
  --text-xs: var(--palm-t-xs);
  --text-sm: var(--palm-t-s);
  --text-md: var(--palm-t-m);
  --text-base: var(--palm-t-l);
  --text-lg: var(--palm-t-xl);

  /* 间距：小档不变，大档拉长（更宽松） */
  --space-1: var(--palm-s1);
  --space-2: var(--palm-s2);
  --space-3: var(--palm-s3);
  --space-4: var(--palm-s4);
  --space-5: var(--palm-s5);
  --space-6: var(--palm-s6);
  --space-8: var(--palm-s8);

  /* 圆角 */
  --radius-chip: var(--palm-r-s);
  --radius-menu: var(--palm-r-s);
  --radius-card: var(--palm-r-m);
  --radius-sheet: var(--palm-r-l);
  --radius-capsule: var(--palm-r-full);
  --radius-full: var(--palm-r-full);
}`

if (!text.includes('旧名桥接')) text = text.trimEnd() + bridge + '\r\n'

writeFileSync(P, text)
console.log('字号:', text.includes('--palm-t-xs: 13px'), '| 间距:', text.includes('--palm-s8: 36px'), '| 桥接:', text.includes('旧名桥接'))
