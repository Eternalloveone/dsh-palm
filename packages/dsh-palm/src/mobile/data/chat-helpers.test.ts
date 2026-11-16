/**
 * 队列条占位词：`[image]` 这种半英文标签普通用户读不懂，必须映射成中文。
 *
 * 这里还钉住 `READ_CHAT_TIMEOUT_MS` 的下限——它存在的理由就是"默认 60 s 不够"，
 * 哪天有人把常量改回去，这条会先红。
 */
import { describe, expect, it } from 'vitest'
import { queueBlockLabel, READ_CHAT_TIMEOUT_MS } from './chat-helpers.ts'

describe('chat-helpers', () => {
  it('已知块类型都有中文占位词', () => {
    expect(queueBlockLabel('image')).toBe('图片')
    expect(queueBlockLabel('file')).toBe('文件')
    expect(queueBlockLabel('audio')).toBe('音频')
    expect(queueBlockLabel('video')).toBe('视频')
    expect(queueBlockLabel('document')).toBe('文档')
  })

  it('未知或缺失的类型退回「内容」，不把 undefined 拼进界面', () => {
    expect(queueBlockLabel(undefined)).toBe('内容')
    expect(queueBlockLabel('')).toBe('内容')
    expect(queueBlockLabel('hologram')).toBe('内容')
  })

  it('读会话的 RPC 上限远大于默认 60 s（冷启动/大会话实测 17~109 s）', () => {
    expect(READ_CHAT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000)
  })
})
