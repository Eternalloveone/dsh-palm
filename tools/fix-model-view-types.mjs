import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ModelView.tsx')
let text = readFileSync(P, 'utf8')

// 1) 数据入口在 data/settings 门面
text = text.replace("import { models, selectModel } from '../data/list.ts'", "import { models, selectModel } from '../data/settings.ts'")

// 2) 模型目录里 provider 在分组上，模型只有 id/name/description
text = text.replace(
  "const active = selected?.provider === choice.model.provider && selected?.model === choice.model.id",
  "const active = selected?.provider === String(choice.group.id) && selected?.model === choice.model.id",
)
text = text.replace(
  `<span className="model-page-row-main">{choice.model.label ?? choice.model.id}</span>`,
  `<span className="model-page-row-main">{choice.model.name ?? choice.model.id}</span>`,
)
text = text.replace(
  `<span className="model-page-row-sub">{choice.group.label ?? choice.group.id}</span>`,
  `<span className="model-page-row-sub">{String(choice.group.label ?? choice.group.id)}</span>`,
)
text = text.replace(
  `                      key={\`\${choice.model.provider}:\${choice.model.id}\`}`,
  '                      key={`${String(choice.group.id)}:${choice.model.id}`}',
)
text = text.replace(
  `                        apply({
                          provider: choice.model.provider,
                          model: choice.model.id,`,
  `                        apply({
                          provider: String(choice.group.id),
                          model: choice.model.id,`,
)

writeFileSync(P, text)
console.log('import:', text.includes("data/settings.ts'"), '| provider:', text.includes('String(choice.group.id)'))
