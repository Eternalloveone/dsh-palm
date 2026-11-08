import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ContextView.tsx')
let text = readFileSync(P, 'utf8')

// 占用条不用行内样式（inlineStyles 棘轮为 0）：按档位映射宽度
text = text.replace(
  `                  <div
                    className="context-bar"
                    role="img"
                    aria-label={\`上下文已用 \${Math.round(ratio * 100)}%\`}
                  >
                    <span className="context-bar-fill" data-pressure={ratio >= 0.85 ? 'high' : undefined} style={undefined} />
                  </div>`,
  `                  <div
                    className="context-bar"
                    role="img"
                    aria-label={\`上下文已用 \${Math.round(ratio * 100)}%\`}
                  >
                    <span
                      className="context-bar-fill"
                      data-level={String(Math.max(1, Math.ceil(ratio * 4)))}
                      data-pressure={ratio >= 0.85 ? 'high' : undefined}
                    />
                  </div>`,
)

writeFileSync(P, text)
console.log('占用条改为档位宽度（无行内样式）')
