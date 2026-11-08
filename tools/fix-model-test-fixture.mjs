import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ModelView.test.tsx')
let text = readFileSync(P, 'utf8')

// 目录结构对齐真实类型：reasoning = { efforts, defaultEffort }，档位是 { id, name }
text = text.replace(
  `            reasoning: {
              default: 'medium',
              options: [
                { id: 'low', label: '低', description: '快' },
                { id: 'medium', label: '中', description: '均衡' },
                { id: 'high', label: '高', description: '慢而稳' },
              ],
            },`,
  `            reasoning: {
              defaultEffort: 'medium',
              efforts: [
                { id: 'low', name: '低', description: '快' },
                { id: 'medium', name: '中', description: '均衡' },
                { id: 'high', name: '高', description: '慢而稳' },
              ],
            },`,
)
text = text.replace(
  `            id: 'haiku',
            name: 'Haiku',`,
  `            id: 'haiku',
            name: 'Haiku',`,
)
text = text.replace(`      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },`, `      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },`)
text = text.replace(`    current: { provider: 'anthropic', model: 'sonnet' },`, `    current: { provider: 'anthropic', model: 'sonnet' },`)

writeFileSync(P, text)
console.log('目录结构已对齐 efforts/defaultEffort')
