/**
 * 主机配置分区：分组定义、子页搜索索引、分组说明与图标。
 * 纯数据 / 纯函数，设置页与其分区共用；不反向依赖 SettingsView。
 */
import type { ReactNode } from 'react'
import {
  GaugeIcon, HashIcon, InfoIcon, RowsIcon, ShieldIcon, SlidersIcon, TypeIcon, UpperRightIcon,
} from '../../icons.tsx'

/** Merged card groups: semantically related namespaces share one card. */
export const SETTINGS_GROUPS: Array<{ id: string; title: string; namespaces: string[] }> = [
  { id: 'general', title: '通用', namespaces: ['ui-theme', 'ui-conversation'] },
  { id: 'models', title: '模型', namespaces: ['llm-pi-ai', 'llm-deepseek', 'subagent-model-selection-settings', 'agent-default-model'] },
  { id: 'search', title: '搜索', namespaces: ['web-search-free', 'web-search-deepseek'] },
  { id: 'memory', title: '记忆', namespaces: ['mnemon'] },
  { id: 'tools', title: '工具', namespaces: ['agent-loop', 'subagent'] },
  { id: 'system', title: '系统', namespaces: ['permission', 'pwsh-sandbox'] },
  { id: 'sidebar', title: '侧边栏', namespaces: ['better-sidebar'] },
  { id: 'remote', title: '远程访问', namespaces: ['dsh-palm'] },
]

/** One searchable sub-configuration entry: lives INSIDE the notify / voice
 *  sub-pages, which the main-page keyword filter cannot reach. Tapping a
 *  search hit opens the owning sub-page and scrolls the entry into view
 *  with a one-shot pulse (data-locate-id anchor on the rendered entry). */
export interface SettingsIndexEntry {
  /** The entry's `data-locate-id` anchor on the rendered sub-page. */
  id: string
  label: string
  group: string
  keywords: string[]
  open: 'notify' | 'voice'
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  { id: 'notify-browser', label: '浏览器通知（启用）', group: '通知', keywords: ['浏览器通知', '通知权限', 'notify', 'enable'], open: 'notify' },
  { id: 'notify-kinds', label: '通知内容（三类事件开关）', group: '通知', keywords: ['通知内容', '规划完成', '后台任务', '长回复'], open: 'notify' },
  { id: 'notify-wxpusher', label: '推送渠道 · WxPusher SPT', group: '通知', keywords: ['wxpusher', 'spt', '微信推送', '微信直达'], open: 'notify' },
  { id: 'notify-pushplus', label: '推送渠道 · PushPlus（已降级）', group: '通知', keywords: ['pushplus', 'token', '微信直达', '已降级'], open: 'notify' },
  { id: 'notify-serverchan', label: '推送渠道 · Server酱 SendKey', group: '通知', keywords: ['serverchan', 'sendkey', 'server酱', 'sct'], open: 'notify' },
  { id: 'notify-bark', label: '推送渠道 · Bark Key', group: '通知', keywords: ['bark', 'bark key', 'ios 直达'], open: 'notify' },
  { id: 'notify-tg', label: '推送渠道 · Telegram', group: '通知', keywords: ['telegram', 'bot token', 'chat id', 'tg'], open: 'notify' },
  { id: 'notify-webpush', label: 'Web Push（系统推送）', group: '通知', keywords: ['web push', '系统推送', 'fcm', '代理'], open: 'notify' },
  { id: 'notify-triggers', label: '触发条件（阈值与间隔）', group: '通知', keywords: ['触发条件', '阈值', '间隔', 'cooldown'], open: 'notify' },
  { id: 'notify-privacy', label: '隐私（锁屏隐藏详情）', group: '通知', keywords: ['隐私', '锁屏隐藏', '隐藏详情'], open: 'notify' },
  { id: 'voice-add', label: '语音 · 添加/编辑转写服务', group: '语音', keywords: ['添加服务', '语音服务', 'transcribe', '转写', 'baseurl'], open: 'voice' },
  { id: 'voice-list', label: '语音 · 服务列表管理', group: '语音', keywords: ['语音列表', '排序', '上移', '下移', '删除服务'], open: 'voice' },
]

/** 主机配置各组的一句话说明（原来自动拼的标题重复、术语直出，普通用户读不懂）。 */
export const HOST_GROUP_DESC: Record<string, string> = {
  general: '语言、区域和通用偏好',
  models: '手机和子代理用哪个模型',
  search: '联网搜索、免费搜索',
  memory: '长期记忆里存了什么',
  tools: 'agent 怎么循环、子代理怎么开',
  system: '手机端能做哪些操作（发命令、改文件）',
  sidebar: '桌面端侧边栏的显示',
  remote: '从外网连回这台电脑',
}

export function hostGroupDesc(group: { id: string; title: string }): string {
  return HOST_GROUP_DESC[group.id] ?? group.title
}

/** 分组图标：按语义挑一个，不再 8 行共用一个滑杆。 */
export function hostGroupIcon(id: string): ReactNode {
  switch (id) {
    case 'general': return <TypeIcon />
    case 'models': return <GaugeIcon />
    case 'search': return <HashIcon />
    case 'memory': return <InfoIcon />
    case 'tools': return <SlidersIcon />
    case 'system': return <ShieldIcon />
    case 'sidebar': return <RowsIcon />
    default: return <UpperRightIcon />
  }
}
