import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ModelView.tsx')
let text = readFileSync(P, 'utf8')
const eol = '\r\n'

/* 1) 导入 ErrorNote */
if (!text.includes("ui/error-note.tsx")) {
  text = text.replace(
    /import \{ (Button, IconButton|IconButton, Button) \} from '\.\.\/ui\/primitives\.tsx'/,
    match => match + eol + "import { ErrorNote } from '../ui/error-note.tsx'",
  )
}

/* 2) 把加载逻辑抽成可重试的函数（原来只在 effect 里跑一次，失败后没有第二次机会） */
if (!text.includes('const loadCatalog = ')) {
  text = text.replace(
    `  useEffect(() => {
    let alive = true
    models(sessionId).then(`,
    `  /** 读取模型目录；失败后用户可以点「重试」再跑一次（原来只有一次机会）。 */
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let alive = true
    models(sessionId).then(`,
  )
  text = text.replace(
    '  }, [sessionId])',
    '  }, [sessionId, reloadKey])' + eol + eol + '  const reloadCatalog = (): void => {' + eol + "    setCatalog({ status: 'loading' })" + eol + '    setReloadKey(key => key + 1)' + eol + '  }',
  )
}

/* 3) 错误呈现换成 ErrorNote（带重试） */
text = text.replace(
  `            {catalog.status === 'error' ? (\r\n              <p className="model-page-note" role="alert">{catalog.message}</p>\r\n            ) : null}`,
  `            {catalog.status === 'error' ? (\r\n              <ErrorNote message={catalog.message} onRetry={reloadCatalog} retryLabel="重新加载" />\r\n            ) : null}`,
)

/* 4) 保存失败也换成 ErrorNote（不丢，可关） */
text = text.replace(
  `{saveError === undefined ? null : <p className="model-page-note" role="alert">{saveError}</p>}`,
  `{saveError === undefined ? null : (\r\n              <ErrorNote message={saveError} onDismiss={() => { setSaveError(undefined) }} />\r\n            )}`,
)

writeFileSync(P, text)
console.log('ErrorNote:', text.includes('<ErrorNote'), '| reload:', text.includes('reloadCatalog'), '| effect deps:', text.includes('[sessionId, reloadKey]'))
