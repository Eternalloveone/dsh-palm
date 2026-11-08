/**
 * **聊天页的浮层组**（W3：从 \`ChatView.tsx\` 渲染体尾部搬出）。
 *
 * 六个浮层各自已经是独立组件，这里只做一件事：**把"什么时候该出现"集中到一处**。
 *
 * 以前它们散在 4,000 行渲染体的最后 60 行里，中间隔着消息列表、输入区、诊断面板——
 * 想确认"同时能开几个浮层"要把文件翻到底再往上找。现在一眼看完：
 *
 * | 浮层 | 出现条件 |
 * |---|---|
 * | 轮次列表 | \`turnListOpen\` |
 * | 文件预览 | \`previewPath !== null\` |
 * | 图片大图 | \`lightboxSrc !== null\` |
 * | 会话菜单组（更多/导出/git/重命名/删除） | 内部各自开关，由 \`SessionSheets\` 自己管 |
 * | 语音输入 | \`voiceOpen\` |
 * | 消息长按菜单 | \`ctxMenu\` 有值 |
 *
 * props 类型不重抄一遍，直接用各组件自己的第一个参数（\`Parameters<typeof X>[0]\`）——
 * 组件改签名时这里会跟着变，不会出现"两处定义、只改一处"。
 *
 * @module dsh-palm/mobile/views/chat/chat-overlays
 */
import { MessageMenu } from './message-menu.tsx'
import { SessionSheets } from './session-sheets.tsx'
import { VoiceSheet } from './voice-sheet.tsx'
import { FilePreviewSheet } from '../../../components/file-preview-sheet.tsx'
import { ImageLightbox } from '../../../components/image-lightbox.tsx'

/** 依赖：每项对应一个浮层的完整 props（\`undefined\` = 不显示）。 */
export interface ChatOverlaysProps {
  filePreview: Parameters<typeof FilePreviewSheet>[0] | undefined
  lightbox: Parameters<typeof ImageLightbox>[0] | undefined
  sessionSheets: Parameters<typeof SessionSheets>[0]
  voice: Parameters<typeof VoiceSheet>[0]
  messageMenu: Parameters<typeof MessageMenu>[0]
}

/** 渲染当前该出现的浮层。 */
export function ChatOverlays(props: ChatOverlaysProps): React.ReactElement {
  const { filePreview, lightbox, sessionSheets, voice, messageMenu } = props
  return (
    <>
      {filePreview !== undefined && <FilePreviewSheet {...filePreview} />}
      {lightbox !== undefined && <ImageLightbox {...lightbox} />}
      <SessionSheets {...sessionSheets} />
      <VoiceSheet {...voice} />
      <MessageMenu {...messageMenu} />
    </>
  )
}
