import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '470-appearance-page.css')
const css = readFileSync(CSS, 'utf8')

if (css.includes('.appearance-swatch')) {
  console.log('already')
} else {
  appendFileSync(CSS, `

/* ── 皮肤预览卡（定版图：色板即该皮肤的真实配色）────────────────── */
.appearance-swatch {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 6px;
  border-radius: var(--palm-r-m);
  background: var(--swatch-bg);
  border: 1px solid var(--palm-line);
}

.appearance-swatch-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--swatch-bar);
}

.appearance-swatch-dot {
  align-self: flex-end;
  width: 7px;
  height: 7px;
  border-radius: var(--palm-r-full);
  background: var(--swatch-accent);
}

.appearance-swatch-graphite { --swatch-bg: #15151c; --swatch-bar: #2a2a3a; --swatch-accent: #7c8cff; }
.appearance-swatch-paper    { --swatch-bg: #faf8f4; --swatch-bar: #e2ddd2; --swatch-accent: #8a5a2b; }
.appearance-swatch-nocturne { --swatch-bg: #0f1520; --swatch-bar: #1e2c40; --swatch-accent: #22d3ee; }

.appearance-row[aria-pressed='true'] .appearance-swatch {
  border-color: var(--palm-accent);
  box-shadow: 0 0 0 1px var(--palm-accent);
}
`)
  console.log('appended')
}
