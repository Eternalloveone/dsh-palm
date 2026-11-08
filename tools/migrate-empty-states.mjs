import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const view = rel => join(PKG, 'src', 'mobile', 'views', rel)
const read = path => readFileSync(path, 'utf8')
const write = (path, text) => writeFileSync(path, text)
const eol = '\r\n'

/* 三个新页面里的裸 <p> 空态 → 统一 EmptyState */

// ① 产物列表
{
  const path = view('ArtifactsView.tsx')
  let text = read(path)
  text = text.replace(
    /import \{ Button, IconButton \} from '\.\.\/ui\/primitives\.tsx'/,
    "import { Button, IconButton } from '../ui/primitives.tsx'" + eol + "import { EmptyState } from '../ui/empty-state.tsx'",
  )
  text = text.replace(
    /              <p className="artifacts-page-note">改动过的文件和报告会出现在这里。<\/p>/,
    '              <EmptyState title="这次会话还没有产出文件" hint="改动过的文件、生成的报告会按轮列在这里。" />',
  )
  write(path, text)
}

// ② 回合大纲
{
  const path = view('OutlineView.tsx')
  let text = read(path)
  text = text.replace(
    /import \{ Button, IconButton \} from '\.\.\/ui\/primitives\.tsx'/,
    "import { Button, IconButton } from '../ui/primitives.tsx'" + eol + "import { EmptyState } from '../ui/empty-state.tsx'",
  )
  text = text.replace(
    /              <p className="outline-page-note">当前会话还没有可跳转的轮次<\/p>/,
    '              <EmptyState title="还没有可跳转的轮次" hint="发出第一条消息后，这里会按轮列出。" />',
  )
  write(path, text)
}

// ③ 上下文占用
{
  const path = view('ContextView.tsx')
  let text = read(path)
  text = text.replace(
    /import \{ IconButton \} from '\.\.\/ui\/primitives\.tsx'/,
    "import { IconButton } from '../ui/primitives.tsx'" + eol + "import { EmptyState } from '../ui/empty-state.tsx'",
  )
  text = text.replace(
    /              <p className="context-page-note">宿主还没报这个会话的上下文用量。<\/p>/,
    '              <EmptyState title="宿主还没报上下文用量" hint="跑完一轮对话后再看，这里会有真实数字。" />',
  )
  write(path, text)
}

console.log('三个页面已改用 EmptyState')
