/**
 * **输入区的两个选择面板**（S3-B：从 `ChatView.tsx` 渲染体里搬出的第二块）。
 *
 * ### 宿主文件：引用，不搬运
 * 手机上系统选择器给不了文件时，这里把**宿主机上的路径**写进输入框（`@路径` 是这套系统的
 * 既定写法），agent 直接按路径读，不用上传字节。
 *
 * ### 命令面板：只填空，不执行
 * 桌面端行为是"选中命令只把它填进输入框"，由用户补参数、自己按发送。以前这里直接执行，
 * 结果 `/goal` 这类带参命令在手机上一次填参数的机会都没有。
 *
 * 两个面板都在关闭后立刻改输入框/命令 chip——**顺序不能反**，否则面板会带着旧值重开一次。
 *
 * @module dsh-palm/mobile/views/chat/chat-input-sheets
 */
import type { ReactElement } from 'react'

import { CommandSheet, HostFileSheet } from '../../../sheets.tsx'

/** 依赖。 */
export interface ChatInputSheetsProps {
  /** 宿主文件面板是否打开。 */
  hostFileOpen: boolean
  /** 关掉宿主文件面板。 */
  closeHostFile: () => void
  /** 当前工作目录（宿主机上的路径；没有就不给 rootPath）。 */
  cwd: string | undefined
  /** 往输入框追加引用（函数式更新，避免读到旧输入）。 */
  appendReference: (path: string) => void
  /** 引用成功后提示一次。 */
  notify: (text: string) => void
  /** 命令面板是否打开。 */
  commandOpen: boolean
  /** 关掉命令面板。 */
  closeCommand: () => void
  /** 可用命令。 */
  commands: Parameters<typeof CommandSheet>[0]['commands']
  /** 选中命令：只填空不执行。 */
  claimCommand: (line: string) => void
  /** 把路径包成 `@...` 引用（有空格时加引号）。 */
  quotePathForReference: (path: string) => string
}

/** 渲染两个选择面板（都不需要时各返回 null）。 */
export function ChatInputSheets(props: ChatInputSheetsProps): ReactElement {
  const {
    hostFileOpen, closeHostFile, cwd, appendReference, notify,
    commandOpen, closeCommand, commands, claimCommand, quotePathForReference,
  } = props
  return (
    <>
      {hostFileOpen && (
        <HostFileSheet
          {...(cwd === undefined ? {} : { rootPath: cwd })}
          onClose={closeHostFile}
          onPick={(pickedPath, pickedName) => {
            closeHostFile()
            appendReference(quotePathForReference(pickedPath))
            notify(`已引用 ${pickedName}`)
          }}
        />
      )}
      {commandOpen && (
        <CommandSheet
          commands={commands}
          onPickCommand={(line) => {
            closeCommand()
            // 只填空不执行：原来直接执行，带参命令在手机上一次填参数的机会都没有。
            claimCommand(line.replace(/^\//, ''))
          }}
          onClose={closeCommand}
        />
      )}
    </>
  )
}
