// @vitest-environment jsdom
/**
 * 本地图片水合契约（手机端）。桌面端把 `![](D:\a.png)` 重写成 /api/file；
 * 手机端没有那个路由，所以 markdown 只带 `data-local-src`，挂载后必须经
 * `mobile.readFile`（api.readFile）填回 data URL —— 这就是「手机端看不到
 * 图片」那个缺陷的回归位。
 *
 * 反向对照也在里面：readFile 失败时**不能**留下半张图（不给 src），远程
 * 图和 data: 的既有行为不变（后者仍退化成 alt 文字）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarkdownText } from './markdown-text.tsx'
import {
  LOCAL_IMAGE_RETRY_MS,
  isLocalImageFailed,
  localImageFailureReason,
  markLocalImageFailed,
  resetLocalImageCache,
} from '../platform/local-images.ts'

const readFile = vi.fn()

vi.mock('../api.ts', () => ({
  readFile: (path: string, sessionId?: string) => readFile(path, sessionId),
}))

const DATA_URL = 'data:image/png;base64,QUJD'

beforeEach(() => {
  readFile.mockReset()
  resetLocalImageCache()
})

afterEach(() => {
  cleanup()
})

/** 渲染一段助手 markdown，返回消息体容器。 */
function renderBody(text: string, sessionId = 's-1'): HTMLElement {
  const { container } = render(<MarkdownText text={text} pending={false} sessionId={sessionId} />)
  const body = container.querySelector('.chat-md-body')
  if (body === null) throw new Error('消息体没有渲染出来')
  return body as HTMLElement
}

describe('长回答的折叠入口（2026-10-30 真机回归）', () => {
  it('「展开全文」按钮必须在裁剪容器之外——否则它被自己裁掉，用户无路可走', () => {
    // 真机现象：正文断在半句、下面只有一点渐变，没有任何可点的地方。
    // 根因是 max-height:45vh + overflow:hidden 的容器同时包住了按钮。
    const huge = 'F'.repeat(7_000)
    render(<MarkdownText text={huge} pending={false} sessionId="s-1" />)

    const toggle = screen.getByRole('button', { name: /展开全文/ })
    expect(toggle).toBeTruthy()
    // 关键断言：按钮的任何一个祖先都不能是裁剪节点
    const clipped = toggle.closest('.chat-md-collapsed')
    expect(clipped).toBeNull()
    // 而正文容器确实是裁剪的
    const body = document.querySelector('.chat-md-body')
    expect(body === null ? '' : body.className).toContain('chat-md-collapsed')
  })

  it('展开后按钮变成「收起」，正文容器不再裁剪', () => {
    const huge = 'G'.repeat(7_000)
    render(<MarkdownText text={huge} pending={false} sessionId="s-1" />)
    fireEvent.click(screen.getByRole('button', { name: /展开全文/ }))
    const collapse = screen.getByRole('button', { name: '收起' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    const body = document.querySelector('.chat-md-body')
    expect(body === null ? '' : body.className).not.toContain('chat-md-collapsed')
  })
})

describe('MarkdownText 的本地图片水合', () => {
  it('把本地路径经 readFile 换成 data URL', async () => {
    readFile.mockResolvedValue({ kind: 'image', path: 'D:/shots/a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![shot](D:/shots/a.png)')

    const image = body.querySelector('img.md-local-img') as HTMLImageElement
    expect(image).not.toBeNull()
    // 水合前没有 src —— 不能拿本地路径去当 URL（浏览器读不到）。
    expect(image.getAttribute('src')).toBeNull()
    expect(image.getAttribute('alt')).toBe('shot')

    await waitFor(() => { expect(image.getAttribute('src')).toBe(DATA_URL) })
    expect(image.dataset['localState']).toBe('loaded')
    expect(readFile).toHaveBeenCalledWith('D:/shots/a.png', 's-1')
  })

  it('相对路径按会话解析（sessionId 一起传下去）', async () => {
    readFile.mockResolvedValue({ kind: 'image', path: './a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![](./a.png)', 's-42')
    await waitFor(() => {
      expect((body.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(DATA_URL)
    })
    expect(readFile).toHaveBeenCalledWith('./a.png', 's-42')
  })

  it('readFile 失败时不留半张图（反面）', async () => {
    readFile.mockRejectedValue(new Error('no such file'))
    const body = renderBody('![shot](D:/shots/missing.png)')

    const image = body.querySelector('img.md-local-img') as HTMLImageElement
    await waitFor(() => { expect(image.dataset['localState']).toBe('failed') })
    expect(image.getAttribute('src')).toBeNull()
  })

  it('读不到时换成带路径的小牌子，而不是留一个破图', async () => {
    // 2026-11-10 真机反馈「经常正文里的图片没法显示」：破图只显示 alt，
    // 谁也看不出是主机上没这个文件。牌子写明是哪张、哪个路径。
    readFile.mockRejectedValue(new Error('no such file'))
    const body = renderBody('![动作表](docs/screenshots/missing.png)')
    await waitFor(() => {
      const chip = body.querySelector('.md-img-missing')
      expect(chip).not.toBeNull()
      expect(chip?.getAttribute('data-local-path')).toBe('docs/screenshots/missing.png')
      expect(chip?.textContent).toContain('动作表未找到')
      expect(chip?.textContent).toContain('docs/screenshots/missing.png')
    })
    expect(body.querySelector('img.md-local-img')).toBeNull()
  })
  it('宿主判成文本时也不当图片显示（反面）', async () => {
    readFile.mockResolvedValue({ kind: 'text', path: 'D:/a.png', name: 'a.png', text: 'oops' })
    const body = renderBody('![shot](D:/a.png)')
    const image = body.querySelector('img.md-local-img') as HTMLImageElement
    await waitFor(() => { expect(image.dataset['localState']).toBe('failed') })
    expect(image.getAttribute('src')).toBeNull()
  })

  it('远程图不走 readFile（既有行为不变）', () => {
    const body = renderBody('![a](https://e.com/a.png)')
    const image = body.querySelector('img') as HTMLImageElement
    expect(image.getAttribute('src')).toBe('https://e.com/a.png')
    expect(image.classList.contains('md-local-img')).toBe(false)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('data: 图仍然退化成 alt 文字（既有契约不变）', () => {
    const body = renderBody('![a](data:text/html,x)')
    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent).toContain('a')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('同一张图挂两次只发一次请求（缓存去重）', async () => {
    readFile.mockResolvedValue({ kind: 'image', path: 'D:/a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![a](D:/a.png)\n\n![a](D:/a.png)')
    await waitFor(() => {
      const images = body.querySelectorAll('img.md-local-img')
      expect(images.length).toBe(2)
      for (const image of images) expect(image.getAttribute('src')).toBe(DATA_URL)
    })
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('没有 sessionId 时不发起读取（不给宿主猜 cwd）', () => {
    const { container } = render(<MarkdownText text="![a](D:/a.png)" pending={false} />)
    const body = container.querySelector('.chat-md-body') as HTMLElement
    expect(body.querySelector('img.md-local-img')).not.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })
})

describe('读不到的图会自己重试（2026-11-11 真机：正文里的图一直不显示）', () => {
  // 真机现场：agent 先按 markdown 引用截图、几秒后才把 PNG 写出来。第一次水合读到
  // 「找不到」，而失败记录只进不出 → 牌子一直挂到整页重开。用户看到的就是
  // 「正文中的图片还是没显示」。
  it('点一下「未找到」牌子就重试，图能补上', async () => {
    readFile.mockRejectedValueOnce(new Error('no such file'))
    readFile.mockResolvedValue({ kind: 'image', path: 'docs/screenshots/a.png', name: 'a.png', dataUrl: DATA_URL })
    const body = renderBody('![动作表](docs/screenshots/a.png)')

    const chip = await waitFor(() => {
      const found = body.querySelector('.md-img-missing')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(chip.getAttribute('data-local-alt')).toBe('动作表')

    fireEvent.click(chip)
    await waitFor(() => {
      const image = body.querySelector('img.md-local-img') as HTMLImageElement
      expect(image.getAttribute('src')).toBe(DATA_URL)
    })
    // 重试成功后牌子必须消失，且 alt 没有在还原时丢掉。
    expect(body.querySelector('.md-img-missing')).toBeNull()
    expect(body.querySelector('img.md-local-img')?.getAttribute('alt')).toBe('动作表')
  })

  it('一轮结束时自动重试：流式期间失败、收尾后图落地就能显示', async () => {
    readFile.mockRejectedValueOnce(new Error('no such file'))
    readFile.mockResolvedValue({ kind: 'image', path: 'D:/a.png', name: 'a.png', dataUrl: DATA_URL })
    const text = '![动作表](D:/a.png)\n\n尾巴还在流'
    const { container, rerender } = render(<MarkdownText text={text} pending sessionId="s-1" />)
    const body = container.querySelector('.chat-md-body') as HTMLElement

    await waitFor(() => { expect(body.querySelector('.md-img-missing')).not.toBeNull() })

    rerender(<MarkdownText text={text} pending={false} sessionId="s-1" />)
    await waitFor(() => {
      const image = body.querySelector('img.md-local-img') as HTMLImageElement
      expect(image.getAttribute('src')).toBe(DATA_URL)
    })
  })

  it('失败只在 TTL 内挡住重复请求，过期后允许再试', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-11T15:00:00Z'))
      markLocalImageFailed('s-1', 'D:/a.png', '主机上没有这个文件')
      expect(isLocalImageFailed('s-1', 'D:/a.png')).toBe(true)
      expect(localImageFailureReason('s-1', 'D:/a.png')).toBe('主机上没有这个文件')

      vi.setSystemTime(new Date(Date.now() + LOCAL_IMAGE_RETRY_MS + 1))
      expect(isLocalImageFailed('s-1', 'D:/a.png')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('牌子上写出人话原因，别只说「未找到」', async () => {
    readFile.mockRejectedValue(new Error('宿主上找不到这个文件'))
    const body = renderBody('![动作表](D:/a.png)')
    await waitFor(() => {
      const chip = body.querySelector('.md-img-missing')
      expect(chip?.textContent).toContain('主机上没有这个文件')
    })
  })
})

describe('长回答跨 2000 字不把已读格式改回原文（2026-11-06 渲染稳定性）', () => {
  it('已渲染的粗体在文本越过阈值后仍然保留', () => {
    // 旧实现：>2000 字整块退回纯文本预览，屏幕上方已经看到的 **粗体** 会当场
    // 变回星号（审计 P1「字变回去了」）。现在只让新增尾部退化。
    const head = `**重点** ${'A'.repeat(200)}`
    const view = render(<MarkdownText text={head} pending sessionId="s-1" />)
    expect(document.querySelector('strong')?.textContent).toBe('重点')

    view.rerender(<MarkdownText text={head + 'B'.repeat(2_200)} pending sessionId="s-1" />)
    expect(document.querySelector('strong')?.textContent).toBe('重点')
  })

  it('阈值之后的尾部按纯文本转义，不再解释 Markdown', () => {
    // 必须是**同一个未闭合段落**：跨段落时上一段已经进了稳定块，走的是真解析，
    // 不会经过预览阈值。审计里的现场也是"一个很长的段落写到 2000 字"。
    const single = `**重点** ${'A'.repeat(2_100)}**尾部**`
    render(<MarkdownText text={single} pending sessionId="s-1" />)
    // 头部（前 2000 字）仍是格式化后的粗体。
    expect(document.querySelector('strong')?.textContent).toBe('重点')
    // 尾部字面量原样显示（证明它走的是纯文本路径，而不是被解析成新的 <strong>）。
    expect(document.body.textContent).toContain('**尾部**')
    expect(document.querySelectorAll('strong')).toHaveLength(1)
  })

  it('收尾时保留代码块与尾部节点（不整段卸载重挂）', () => {
    // 审计 P1：收尾那一拍 segment id 从稳定块 + tail(-1) 换成 0..N，React 把
    // 代码块当新节点重挂（重新高亮、可见闪动）。保留 tail 的 -1 后，收尾只应
    // 更新内容，不该换 DOM 节点。
    const text = '```ts\nconst a = 1\n```\n\n尾段落正在输出'
    const view = render(<MarkdownText text={text} pending sessionId="s-1" />)
    const codeBefore = document.querySelector('.code-block')
    const tailBefore = document.querySelector('.md-html')
    expect(codeBefore).not.toBeNull()
    expect(tailBefore).not.toBeNull()

    view.rerender(<MarkdownText text={text} pending={false} sessionId="s-1" />)
    expect(document.querySelector('.code-block')).toBe(codeBefore)
    expect(document.querySelector('.md-html')).toBe(tailBefore)
  })
})
