import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')

/* 代码块里的文件链：有 ⑩ 独立页就走页，没有才回落到浮层。
   这样两种入口（文件行 / 代码块里的路径）行为一致。
   用 ref 拿最新回调，避免把 handler 的依赖从 [] 改大（它会重建整棵点击代理）。 */
if (!text.includes('onOpenDiffRef')) {
  text = text.replace(
    '  const [previewPath, setPreviewPath] = useState<string | null>(null)',
    '  const [previewPath, setPreviewPath] = useState<string | null>(null)\r\n' +
      '  /** 最新的一级「看 diff」回调：代码块里的文件链也要走同一个入口。 */\r\n' +
      '  const onOpenDiffRef = useRef(onOpenDiff)\r\n' +
      '  onOpenDiffRef.current = onOpenDiff',
  )

  text = text.replace(
    '    setPreviewPath(path)\r\n  }, [])',
    '    if (onOpenDiffRef.current !== undefined) {\r\n' +
      '      onOpenDiffRef.current(path)\r\n' +
      '      return\r\n' +
      '    }\r\n' +
      '    setPreviewPath(path)\r\n  }, [])',
  )
}

writeFileSync(P, text)
console.log('ref:', text.includes('onOpenDiffRef'), '| 分支:', text.includes('onOpenDiffRef.current(path)'))
