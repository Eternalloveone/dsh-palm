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
 *
 * Keys are the namespace and field ids the host actually reports. Names that
 * drift out of the host schema turn the whole group into a blank tile, so this
 * table is kept to what `settings.read` returns — a stale key is worse than a
 * missing one, because nothing renders it and nobody notices it broke.
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
    fontSize: { title: '聊天字号', desc: '桌面端聊天区的字号', scope: 'desktop' },
    codeFontSize: { title: '代码字号', desc: '桌面端代码块的字号', scope: 'desktop' },
    terminalFontSize: { title: '终端字号', desc: '桌面端终端的字号', scope: 'desktop' },
    textFontFamily: { title: '正文字体', desc: '桌面端正文使用的字体', scope: 'desktop' },
    codeFontFamily: { title: '代码字体', desc: '桌面端代码使用的字体', scope: 'desktop' },
    terminalFontFamily: { title: '终端字体', desc: '桌面端终端使用的字体', scope: 'desktop' },
  },
  'ui-conversation': {
    busyEnter: { title: '忙碌时回车发送', desc: '模型生成中按回车是排队还是打断', scope: 'sync' },
  },
  'ui-chat': {
    transcriptView: { title: '对话视图', desc: '桌面端消息的显示方式', scope: 'desktop' },
    collapseTiming: { title: '折叠过程', desc: '桌面端是否折叠工具过程', scope: 'desktop' },
    performanceUsage: { title: '性能用量条', desc: '桌面端显示性能与用量', scope: 'desktop' },
    linkOpening: { title: '链接打开方式', desc: '桌面端点击链接的行为', scope: 'desktop' },
  },
  'agent-default-model': {
    provider: { title: '模型提供方', desc: '新会话默认的模型提供方', scope: 'sync' },
    model: { title: '模型', desc: '新会话默认的模型', scope: 'sync' },
    reasoningEffort: { title: '推理档位', desc: '默认的推理强度', scope: 'sync' },
  },
  'llm-pi-ai': {
    providers: { title: '模型提供方', desc: '已配置的提供方与模型目录', scope: 'desktop' },
  },
  'llm-deepseek': {
    maxTokens: { title: '最大输出 token', desc: '单次回复的长度上限', scope: 'desktop' },
    defaultContextWindow: { title: '上下文窗口', desc: '默认的上下文长度', scope: 'desktop' },
    streamIdleTimeoutMs: { title: '流空闲超时', desc: '多久没有新内容就断开', scope: 'desktop' },
    apiKeyEnv: { title: '密钥环境变量', desc: '从这个环境变量读取密钥', scope: 'desktop' },
  },
  'subagent-model-selection-settings': {
    enabled: { title: '子代理自选模型', desc: '子代理能否单独指定模型', scope: 'sync' },
    allowedModels: { title: '允许的模型', desc: '子代理可用的模型白名单', scope: 'sync' },
  },
  'web-search-free': {
    provider: { title: '搜索引擎', desc: '免费搜索使用哪一家', scope: 'desktop' },
    fallbackOrder: { title: '回退顺序', desc: '主引擎失败后依次尝试', scope: 'desktop' },
    safeSearch: { title: '安全搜索', desc: '过滤成人内容', scope: 'desktop' },
    cacheTtl: { title: '缓存时长', desc: '搜索结果缓存多久', scope: 'desktop' },
  },
  'web-search-deepseek': {
    model: { title: '搜索模型', desc: '联网搜索使用的模型', scope: 'desktop' },
    maxTokens: { title: '最大输出 token', desc: '搜索摘要的长度上限', scope: 'desktop' },
    maxUses: { title: '最多搜索次数', desc: '单轮对话最多调用几次', scope: 'desktop' },
  },
  mnemon: {
    runtimeMemory: { title: '运行时记忆', desc: '是否启用常驻热记忆', scope: 'desktop' },
    defaultRecallLimit: { title: '默认召回条数', desc: '一次最多取回多少条记忆', scope: 'desktop' },
    displayMode: { title: '显示方式', desc: '记忆界面的呈现方式', scope: 'desktop' },
    tabEnabled: { title: '记忆标签页', desc: '是否在桌面端显示记忆页', scope: 'desktop' },
    writeEnabled: { title: '允许写入', desc: '是否允许自动写入记忆', scope: 'desktop' },
  },
  'agent-loop': {
    maxParallelToolCalls: { title: '最大并行工具调用', desc: '单轮最多同时执行的工具数', scope: 'sync' },
  },
  subagent: {
    maxDepth: { title: '子代理最大层数', desc: '子代理还能再开几层子代理', scope: 'desktop' },
    maxActiveSubagents: { title: '同时运行子代理数', desc: '同一时刻最多几个子代理', scope: 'desktop' },
  },
  permission: {
    defaultPreset: { title: '默认权限档位', desc: '新会话默认的命令权限', scope: 'desktop' },
  },
  'pwsh-sandbox': {
    timeoutMs: { title: '命令超时', desc: '单条命令最长执行时间', scope: 'desktop' },
    maxOutputBytes: { title: '输出上限', desc: '单条命令最多保留多少输出', scope: 'desktop' },
  },
  'better-sidebar': {
    mobileNoAutoOpen: { title: '手机不自动展开', desc: '手机上不要自动弹开侧边栏', scope: 'sync' },
    mobileDefaultTree: { title: '手机默认文件树', desc: '手机上文件树默认展开到什么程度', scope: 'sync' },
    autoOpenSubagent: { title: '自动展开子代理', desc: '子代理运行时自动展开其行', scope: 'sync' },
    autoOpenJobs: { title: '自动展开任务', desc: '有后台任务时自动展开任务区', scope: 'sync' },
    tabsEnabled: { title: '启用标签页', desc: '编辑器标签页功能', scope: 'sync' },
    viewersEnabled: { title: '启用查看器', desc: '内嵌文档/图查看器', scope: 'sync' },
    editorExplorer: { title: '编辑器文件树', desc: '编辑器侧显示文件树', scope: 'sync' },
    tasksViewMode: { title: '任务视图', desc: '任务区的显示模式', scope: 'sync' },
  },
  'dsh-palm': {
    // 「远程访问入口」必须是桌面端改：手机上一关，这台手机立刻连不上。
    enabled: { title: '远程访问', desc: '是否启用远程访问入口（关掉手机就连不上）', scope: 'desktop' },
    mobileEnterToSend: { title: '手机回车即发送', desc: '手机上按回车直接发出去，不用再点发送', scope: 'sync' },
    offlineAfterMs: { title: '离线判定', desc: '多久没心跳算这台设备离线', scope: 'sync' },
    maxDevices: { title: '最多配对设备', desc: '允许同时配对的设备数量', scope: 'sync' },
    tokenTtlMs: { title: '登录有效期', desc: '配对令牌多久失效一次', scope: 'sync' },
    idleExpireMs: { title: '空闲过期', desc: '长时间无操作后要求重新配对', scope: 'desktop' },
    requirePairingForLan: { title: '局域网也要配对', desc: '同一网络下的设备也必须配对', scope: 'desktop' },
    publicBaseUrl: { title: '公网地址', desc: '远程访问使用的对外地址', scope: 'desktop' },
    cookieName: { title: 'Cookie 名', desc: '配对凭证使用的 Cookie 名', scope: 'desktop' },
  },
}

/** Look up field metadata; undefined falls back to the raw id + schema text. */
export function fieldMeta(ns: string, field: string): FieldMeta | undefined {
  return FIELD_META[ns]?.[field]
}
