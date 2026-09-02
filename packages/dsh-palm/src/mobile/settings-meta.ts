/**
 * Field metadata for the mobile settings surface: a Chinese display title, a
 * one-line description, and the effective scope of each host-schema field.
 *
 * The schema envelope ships raw field ids and (sometimes) a description; this
 * table fills the gaps so every rendered field has a readable title and a
 * plain-language hint. `scope` drives the source badge:
 *   - 'sync'    writable from the phone, changes sync to the host
 *   - 'desktop' read-only on the phone, change it on the desktop
 * Fields without an entry fall back to the raw id + schema description.
 */

export type FieldScope = 'sync' | 'desktop'

export interface FieldMeta {
  /** Chinese display title (replaces the raw field id). */
  title: string
  /** One-line plain-language description. */
  desc?: string
  /** Where the field can be changed. */
  scope: FieldScope
}

/** Per-namespace field metadata. Keys are the host schema field ids. */
export const FIELD_META: Record<string, Record<string, FieldMeta>> = {
  'ui-theme': {
    preference: { title: '主题偏好', desc: '深色 / 浅色 / 跟随系统', scope: 'sync' },
  },
  'ui-conversation': {
    busyEnter: { title: '忙碌时回车发送', desc: '模型生成中按回车直接发送下一条消息', scope: 'sync' },
  },
  'ui-onboarding': {
    completed: { title: '引导完成状态', desc: '首次使用引导是否已完成', scope: 'desktop' },
  },
  locale: {
    preference: { title: '界面语言', desc: '桌面端界面语言', scope: 'desktop' },
  },
  'agent-presets': {
    default: { title: '默认预设', desc: '新会话使用的 Agent 预设', scope: 'sync' },
  },
  'subagent-model': {
    provider: { title: '子代理提供方', desc: '子代理使用的模型提供方', scope: 'sync' },
    model: { title: '子代理模型', desc: '子代理使用的模型', scope: 'sync' },
  },
  'agent-default-model': {
    provider: { title: '模型提供方', desc: '新会话默认的模型提供方', scope: 'sync' },
    model: { title: '模型', desc: '新会话默认的模型', scope: 'sync' },
    reasoningEffort: { title: '推理档位', desc: '默认的推理强度', scope: 'sync' },
  },
  'llm-pi-ai': {
    providers: { title: '模型提供方', desc: '已配置的提供方与模型目录', scope: 'desktop' },
    apiKeys: { title: 'API Key', desc: '各提供方的密钥（不显示）', scope: 'desktop' },
  },
  'llm-deepseek': {
    baseURL: { title: '接口地址', desc: 'DeepSeek API 地址', scope: 'desktop' },
    apiKey: { title: 'API Key', desc: 'DeepSeek 密钥（不显示）', scope: 'desktop' },
  },
  'free-search': {
    engine: { title: '搜索服务', desc: '免费搜索使用的引擎', scope: 'desktop' },
  },
  'web-search-deepseek': {
    enabled: { title: '联网搜索', desc: '是否启用 DeepSeek 联网搜索', scope: 'desktop' },
  },
  mnemon: {
    provider: { title: '记忆提供方', desc: '记忆空间使用的提供方', scope: 'desktop' },
  },
  'mnemon-ui': {
    enabled: { title: '记忆界面', desc: '是否启用记忆界面', scope: 'desktop' },
  },
  'at-file': {
    enabled: { title: '启用 @文件', desc: '在输入框支持 @ 引用文件', scope: 'sync' },
  },
  'tool-see-image': {
    enabled: { title: '看图工具', desc: '是否启用图片查看工具', scope: 'desktop' },
  },
  'agent-loop': {
    maxParallelToolCalls: { title: '最大并行工具调用', desc: '单轮最多同时执行的工具数', scope: 'sync' },
  },
  shell: {
    defaultShell: { title: '默认 Shell', desc: '命令执行的默认 Shell', scope: 'desktop' },
  },
  permission: {
    allowlist: { title: '命令白名单', desc: '允许执行的命令列表', scope: 'desktop' },
  },
  'dsh-market': {
    allowRestart: { title: '允许重启', desc: '安装插件后允许自动重启', scope: 'sync' },
  },
  'remote-web-ui': {
    enabled: { title: '远程访问', desc: '是否启用远程访问入口', scope: 'desktop' },
  },
}

/** Look up field metadata; undefined falls back to the raw id + schema text. */
export function fieldMeta(ns: string, field: string): FieldMeta | undefined {
  return FIELD_META[ns]?.[field]
}
