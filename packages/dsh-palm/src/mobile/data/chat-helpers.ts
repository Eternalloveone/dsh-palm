/**
 * **聊天页数据常量与纯函数**（W4-4：从 `api.ts` 抽出）。
 *
 * 这两样被 session 域实现（`data/impl/session.ts`）用到，放在 api.ts 里会让域实现
 * 反过来 import api.ts 而成环。它们是纯的：一个超时上限、一个队列标签映射。
 *
 * @module dsh-palm/mobile/data/chat-helpers
 */

/**
 * `mobile.readChat` 的 RPC 上限。默认 60 s 对热宿主够用，但冷启动/大会话被
 * 换出内存时，实测首页读要 17~109 s（317 会话里最大的那个 6986 条），60 s 一到
 * 就被 RPC 层掐断，页面停在「加载中…」——用户看到的就是「点了结果进不去」。
 */
export const READ_CHAT_TIMEOUT_MS = 180_000

/** 非文本块的占位词：排队条上出现 [image] [file] 这种半英文，普通用户读不懂。 */
export function queueBlockLabel(type: string | undefined): string {
  switch (type) {
    case 'image': return '图片'
    case 'file': return '文件'
    case 'audio': return '音频'
    case 'video': return '视频'
    case 'document': return '文档'
    default: return '内容'
  }
}
