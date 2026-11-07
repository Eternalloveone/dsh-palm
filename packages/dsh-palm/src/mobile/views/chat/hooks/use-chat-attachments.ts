/**
 * 输入区的**待发附件**：图片（compress 后本地挂起）与文件（宿主暂存拿收据）。
 *
 * 从 `ChatView` 搬出来的（S4a）。这块东西只跟「用户选了什么、传没传上去」有关，
 * 跟会话流/滚动/回合无关，唯一的外部依赖是 `uploadAttachment`（宿主暂存）和
 * `toast`（上限/解码失败的即时反馈），所以可以整块独立，并单独跑单测。
 *
 * 三态 chip 的由来（真机反馈，别改回去）：以前只有**上传成功之后**才往列表里放，
 * 用户选完文件发送框一片空白，看着像"没加进去"。现在选完立刻挂一条 uploading，
 * 成功转 ready、失败转 failed（点一下重传），发送框始终反映用户选了什么。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { compressImageFile, MAX_ATTACHED_IMAGES, readAsDataURL, type AttachedImage } from '../../../platform/image.ts'
import { uploadAttachment } from '../../../data/workspace.ts'
import { toast } from '../../../components/toast.tsx'

/**
 * 待发附件的一条（桌面端 composer 那颗 chip 的复刻）。
 *
 * `status` 三态决定 chip 的样子：uploading「上传中…」、ready「大小」、
 * failed「上传失败，点按重试」。上传失败的那条**留着**，让用户看得到是哪一条、
 * 能重传或移除 —— 以前是直接消失，发送框里什么都看不到。
 */
export interface StagedFile {
  /** 本地键：宿主收据要等回包才有，chip 先挂在它上面。 */
  localId: string
  name: string
  bytes?: number
  status: 'uploading' | 'ready' | 'failed'
  /** 宿主铸的收据（status === 'ready' 时必有）。 */
  receiptId?: string
  /**
   * 重传要用的原文件。
   *
   * 编辑「带附件的排队消息」时回填的 chip 没有原文件（字节在宿主那边、收据还在）：
   * 这种只能发送/移除，不能重传 —— 所以这里可空。
   */
  file?: File
  /** 这次上传的取消句柄（弱网卡住时点「取消」就停，不必等 120 秒超时）。 */
  abort?: AbortController
}

/** 单个附件上限（与宿主 `mobile.uploadAttachment` 的 20 MB 判据同源）。 */
export const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024
/** 一次最多挂几个文件：再多手机端那一条附件栏就挤成一行了。 */
export const MAX_ATTACHED_FILES = 5

export interface ChatAttachments {
  /** 待发图片（已压缩）。 */
  attachImages: AttachedImage[]
  /** 待发文件（宿主暂存中 / 已就绪 / 失败）。 */
  attachFiles: StagedFile[]
  /** 正在上传的个数：>0 时先别发，免得发出一条缺附件的消息。 */
  uploadingFiles: number
  setAttachImages: Dispatch<SetStateAction<AttachedImage[]>>
  setAttachFiles: Dispatch<SetStateAction<StagedFile[]>>
  /** 选/粘贴一张图片：压缩后追加（解码失败或超上限时 toast 并丢弃）。 */
  addImage: (file: File) => void
  /** 选一批文件：先立 chip 再上传。 */
  addFiles: (files: readonly File[]) => void
  /** 失败的那条点一下重传。 */
  retryStaged: (localId: string) => void
  /** 打开图片 / 拍照用的选择框。 */
  openPicker: (mode: 'image' | 'camera') => void
}

export function useChatAttachments(options: { sessionId: string }): ChatAttachments {
  const { sessionId } = options
  /** Images picked or pasted into the composer, awaiting send (community-style attach). */
  const [attachImages, setAttachImages] = useState<AttachedImage[]>([])
  /** Live mirror of attachImages for the async addImage cap check (no stale closure). */
  const attachImagesRef = useRef(attachImages)
  useEffect(() => { attachImagesRef.current = attachImages }, [attachImages])
  const [attachFiles, setAttachFiles] = useState<StagedFile[]>([])
  /** 正在上传的附件个数：>0 时先别发，免得发出一条缺附件的消息。 */
  const [uploadingFiles, setUploadingFiles] = useState(0)
  const attachFilesRef = useRef(attachFiles)
  useEffect(() => { attachFilesRef.current = attachFiles }, [attachFiles])
  /** 上一次点出来的文件选择框节点：下一次打开前先摘掉，避免节点堆积。 */
  const pickerInputRef = useRef<HTMLInputElement | null>(null)

  /** Add a picked/pasted image: compress it, then append to the attach list. */
  const addImage = useCallback((file: File) => {
    void compressImageFile(file).then(({ image, failed }) => {
      // A decode failure (HEIC etc.) can't be sent: drop it and tell the user
      // instead of silently keeping an unusable attachment.
      if (failed) {
        toast('该图片无法解码，已忽略')
        return
      }
      // Over the cap: refuse loudly rather than silently dropping the image.
      if (attachImagesRef.current.length >= MAX_ATTACHED_IMAGES) {
        toast(`最多附加 ${MAX_ATTACHED_IMAGES} 张图片`)
        return
      }
      setAttachImages(previous => [...previous, image])
    })
  }, [])

  /**
   * 把一条待发附件交给宿主暂存，成功/失败各自改写这条 chip 的状态。
   *
   * 为什么要走宿主：prompt 里文件附件的正式形态是 `{ type: 'file', receiptId }`，字节
   * 由宿主附件服务落盘、按会话暂存，手机端只在线上传一个 id。桌面那条 `/upload`
   * 直传通道走桌面鉴权，手机走不通，所以由插件在移动通道里代传。
   */
  const uploadStaged = useCallback((localId: string, file: File): void => {
    setUploadingFiles(previous => previous + 1)
    const controller = new AbortController()
    // 挂上取消句柄：chip 上的「取消」用它叫停（超时另有 120 秒兜底）。
    setAttachFiles(previous => previous.map(item => item.localId === localId
      ? { ...item, abort: controller }
      : item))
    void readAsDataURL(file).then(
      (dataUrl) => {
        // data URL → 纯 base64：宿主只收 base64，前缀它自己不需要。
        const comma = dataUrl.indexOf(',')
        const data = comma < 0 ? '' : dataUrl.slice(comma + 1)
        if (data === '') throw new Error('empty')
        if (controller.signal.aborted) throw new Error('cancelled')
        return uploadAttachment(sessionId, { name: file.name, data }, controller.signal)
      },
    ).then(
      (uploaded) => {
        setAttachFiles(previous => previous.map(item => item.localId === localId
          ? {
              ...item,
              status: 'ready',
              receiptId: uploaded.receiptId,
              name: uploaded.name === '' ? item.name : uploaded.name,
              bytes: uploaded.bytes ?? item.bytes,
            }
          : item))
      },
      () => {
        setAttachFiles(previous => previous.map(item => item.localId === localId ? { ...item, status: 'failed' } : item))
      },
    ).finally(() => {
      setUploadingFiles(previous => Math.max(0, previous - 1))
      // 句柄用完即弃：留着只会让 chip 记着一个已经结束的 controller。
      setAttachFiles(previous => previous.map(item => item.localId === localId
        ? { ...item, abort: undefined }
        : item))
    })
  }, [sessionId])

  const addFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return
    const room = MAX_ATTACHED_FILES - attachFilesRef.current.length
    if (room <= 0) {
      toast(`最多附加 ${MAX_ATTACHED_FILES} 个文件`)
      return
    }
    const accepted = files.slice(0, room)
    if (files.length > room) toast(`最多附加 ${MAX_ATTACHED_FILES} 个文件`)
    for (const file of accepted) {
      if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
        toast(`${file.name} 超过 20 MB，已忽略`)
        continue
      }
      const localId = `staged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // 先立 chip（上传中），再传字节：发送框必须立刻显示用户选了什么。
      setAttachFiles(previous => [...previous, {
        localId,
        name: file.name,
        bytes: file.size,
        status: 'uploading',
        file,
      }])
      uploadStaged(localId, file)
    }
  }, [uploadStaged])

  /** 失败的那条点一下就重传（原 File 还留着；编辑回填的收据条目没有原文件，重传无从谈起）。 */
  const retryStaged = useCallback((localId: string): void => {
    const target = attachFilesRef.current.find(item => item.localId === localId)
    if (target === undefined || target.status !== 'failed' || target.file === undefined) return
    setAttachFiles(previous => previous.map(item => item.localId === localId ? { ...item, status: 'uploading' } : item))
    uploadStaged(localId, target.file)
  }, [uploadStaged])

  /**
   * 打开图片 / 拍照用的选择框。
   *
   * 为什么不复用「文件」那一项：文件走的是菜单项里 label 直连的原生输入框，图片和拍照
   * 仍用程序化点击。每次现造一个新节点，属性在进 DOM 前设好，避免浏览器沿用上一次的
   * 选择器配置（真机上这个坑让「文件」一直弹相册）。这里只服务图片类型的两条路。
   */
  const openPicker = useCallback((mode: 'image' | 'camera'): void => {
    document.querySelectorAll<HTMLInputElement>('input.chat-picker-input').forEach(node => { node.remove() })
    pickerInputRef.current = null
    const input = document.createElement('input')
    input.type = 'file'
    input.className = 'chat-picker-input'
    input.multiple = mode !== 'camera'
    input.setAttribute('accept', 'image/*')
    if (mode === 'camera') input.setAttribute('capture', 'environment')
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])]
      for (const file of files) addImage(file)
      input.remove()
      if (pickerInputRef.current === input) pickerInputRef.current = null
    })
    input.addEventListener('cancel', () => {
      input.remove()
      if (pickerInputRef.current === input) pickerInputRef.current = null
    })
    pickerInputRef.current = input
    document.body.appendChild(input)
    const native = input as HTMLInputElement & { showPicker?: () => void }
    try {
      if (typeof native.showPicker === 'function') native.showPicker()
      else input.click()
    } catch {
      input.click()
    }
  }, [addImage])

  return {
    attachImages,
    attachFiles,
    uploadingFiles,
    setAttachImages,
    setAttachFiles,
    addImage,
    addFiles,
    retryStaged,
    openPicker,
  }
}
