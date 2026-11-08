import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ModelView.tsx')
let text = readFileSync(P, 'utf8')

const before = text
text = text.replace(
  '              <p className="model-page-note" role="alert">{catalog.message}</p>',
  '              <ErrorNote message={catalog.message} onRetry={reloadCatalog} retryLabel="重新加载" />',
)

writeFileSync(P, text)
console.log('替换成功:', before !== text, '| 现含 ErrorNote 加载分支:', text.includes('onRetry={reloadCatalog}'))
