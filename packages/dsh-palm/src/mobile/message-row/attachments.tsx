/**
 * 消息附件与图片组：一条消息里除正文之外的"物证"。
 *
 * 从 message-row.tsx 拆出来（W2-3）：附件条和图片墙各自带着自己的加载/失败态，
 * 和消息行的排版逻辑混在一个文件里只会互相拖累。
 *
 * @module dsh-palm/mobile/message-row/attachments
 */

import { useEffect, useState } from 'react'
import type { MessageFile, MessageImage } from '../render/messages.ts'
import { cachedAttachmentUrl, forgetAttachmentUrl, loadAttachmentUrl } from '../platform/attachment-images.ts'
import { formatFileSize } from '../render/ui-text.ts'
import { Button } from '../ui/primitives.tsx'

/**
 * 一条消息里的文件附件（桌面端那颗文件卡片的手机版）。
 *
 * 只画引用（图标 + 名字 + 扩展名·大小），不取字节：手机端还没有文件预览，
 * 先把"这条消息带了什么附件"讲清楚 —— 以前文件块被整块丢掉，发送条里看不出
 * 用户附过文档。
 */
export function MessageFiles({ files }: { files: readonly MessageFile[] }) {
  return (
    <div className="chat-msg-files" role="list" aria-label="消息附件">
      {files.map(file => (
        <div key={file.attachmentId} className="chat-msg-file" role="listitem" title={file.name}>
          <svg className="chat-msg-file-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M9 1.5 H4.5 A1.5 1.5 0 0 0 3 3 V13 A1.5 1.5 0 0 0 4.5 14.5 H11.5 A1.5 1.5 0 0 0 13 13 V5.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M9 1.5 V5.5 H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span className="chat-msg-file-name">{file.name}</span>
          <span className="chat-msg-file-meta">{filesMetaText(file)}</span>
        </div>
      ))}
    </div>
  )
}

/** 附件那行小字：`PDF · 2 KB`；没有扩展名就只有大小。 */
function filesMetaText(file: MessageFile): string {
  const dot = file.name.lastIndexOf('.')
  const extension = dot > 0 && dot < file.name.length - 1
    ? file.name.slice(dot + 1).toUpperCase().slice(0, 8)
    : ''
  const size = file.bytes > 0 ? formatFileSize(file.bytes) : ''
  return [extension, size].filter(part => part !== '').join(' · ')
}

/**
 * 一条消息里的图片组。
 *
 * 事件里只有引用，字节挂载时按需取（内容寻址缓存，重挂不再请求）。取字节失败
 * 只影响这一张图：显示可点重试的占位，而不是让整行消失。
 */
export function MessageImages({ sessionId, images }: { sessionId: string; images: readonly MessageImage[] }) {
  return (
    <div className="chat-msg-images" role="list" aria-label="消息图片">
      {images.map(image => <MessageImageTile key={image.attachmentId} sessionId={sessionId} image={image} />)}
    </div>
  )
}

/** 单张图片：占位 → data URL；点一下由 ChatView 的滚动点击处理开全屏。 */
export function MessageImageTile({ sessionId, image }: { sessionId: string; image: MessageImage }) {
  const [url, setUrl] = useState<string | undefined>(() => cachedAttachmentUrl(image.attachmentId))
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const label = image.name !== undefined && image.name !== '' ? image.name : '图片'

  useEffect(() => {
    if (url !== undefined) return
    // 解码失败后停在失败态：字节没变，再读一次还是同一个坏 data URL。
    if (failed) return
    let cancelled = false
    void loadAttachmentUrl(sessionId, image).then((loaded) => {
      if (cancelled) return
      if (loaded === undefined) setFailed(true)
      else {
        setFailed(false)
        setUrl(loaded)
      }
    })
    return () => { cancelled = true }
  }, [sessionId, image.attachmentId, url, attempt, failed])

  if (url === undefined) {
    return (
      <Button
        type="button"
        role="listitem"
        className={`chat-msg-image chat-msg-image-placeholder${failed ? ' chat-msg-image-failed' : ''}`}
        aria-label={failed ? `${label}，没显示出来，点击重试` : `${label}，加载中`}
        onClick={() => {
          if (!failed) return
          setFailed(false)
          setAttempt(value => value + 1)
        }}
      >
        {failed ? '这张图没显示出来，点一下重试' : '图片加载中…'}
      </Button>
    )
  }
  return (
    <img
      className="chat-msg-image"
      role="listitem"
      src={url}
      alt={label}
      loading="lazy"
      {...(image.width > 0 ? { width: image.width } : {})}
      {...(image.height > 0 ? { height: image.height } : {})}
      onLoad={(event) => {
        // 结构损坏的图会「加载成功」却一个像素都解不出来：naturalWidth 是 0。
        // 这种图既不触发 onError，浏览器也不画任何东西 —— 屏幕上就是一块纯黑。
        // 相册能看是因为系统解码器宽容，浏览器不接受这种文件。
        if (event.currentTarget.naturalWidth !== 0) return
        forgetAttachmentUrl(image.attachmentId)
        setUrl(undefined)
        setFailed(true)
      }}
      onError={() => {
        // 解码失败时浏览器只给一块空白（深色主题下就是"黑图"）。没有 onError 就
        // 永远黑着：用户既看不到提示，也没有重试的入口。这里退回占位/失败态，
        // 顺手清掉缓存 —— 不清的话重试还是同一个坏字节。
        forgetAttachmentUrl(image.attachmentId)
        setUrl(undefined)
        setFailed(true)
      }}
    />
  )
}
