// @vitest-environment jsdom
/**
 * 「最近通知」的类别徽章（2026-11-10，390px 实拍发现问题）。
 *
 * 实拍时一条 `approval` 通知读作「**回复** 需要你批准：run_command」—— 徽章把审批
 * 也说成"回复"。徽章是"这条通知属于哪一类"的唯一线索，错一个字，用户就会以为
 * 那是一条已经回答过的消息。这里按 kind 逐个钉住。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NotifyPage } from './notify-page.tsx'
import { mobileCss } from '../../mobile-styles.ts'

afterEach(cleanup)

/** 只填本用例用得到的字段，其余按组件现有签名占位。 */
function props(inbox: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    setNotifyOpen: () => undefined,
    inboxStats: undefined,
    inboxDeliveries: [],
    inboxBusy: false,
    inbox,
    locateProps: () => ({}),
    notifyPermission: 'granted',
    notifyDesc: '系统通知已开启',
    notifyBusy: false,
    handleNotifyClick: () => Promise.resolve(),
    notifyConfig: undefined,
    kindsOn: { jobs: false, todo: false, turns: false, approvals: false },
    handleKindToggle: () => undefined,
    wxpusherSpt: '', setWxpusherSpt: () => undefined,
    serverchanKey: '', setServerchanKey: () => undefined,
    barkKey: '', setBarkKey: () => undefined,
    tgToken: '', setTgToken: () => undefined,
    tgChatId: '', setTgChatId: () => undefined,
    pushplusToken: '', setPushplusToken: () => undefined,
    handleTestNotify: () => Promise.resolve(),
    saveChannels: () => Promise.resolve(),
    webPushOn: false, handleWebPushToggle: () => undefined,
    thresholdInput: '', setThresholdInput: () => undefined,
    cooldownInput: '', setCooldownInput: () => undefined,
    saveNotifyTriggers: () => Promise.resolve(),
    hideDetailsOn: false, handleHideDetailsToggle: () => undefined,
    confirmClearChannels: false, setConfirmClearChannels: () => undefined,
    persistChannels: () => Promise.resolve(),
  }
}

function event(kind: string, title: string): Record<string, unknown> {
  return { id: `${kind}-1`, kind, title, body: '正文', sessionId: 's-1', ts: Date.now() }
}

describe('最近通知的类别徽章', () => {
  it('审批说「审批」，不说「回复」', () => {
    render(<NotifyPage {...(props([event('approval', '需要你批准：run_command')]) as unknown as Parameters<typeof NotifyPage>[0])} />)
    const row = screen.getByText('需要你批准：run_command').closest('button')!
    expect(row.textContent).toContain('审批')
    expect(row.textContent).not.toContain('回复')
  })

  it('提问说「提问」', () => {
    render(<NotifyPage {...(props([event('question', '需要你回答：部署到哪')]) as unknown as Parameters<typeof NotifyPage>[0])} />)
    const row = screen.getByText('需要你回答：部署到哪').closest('button')!
    expect(row.textContent).toContain('提问')
  })

  it('回合完成仍说「回复」（回答本身）', () => {
    render(<NotifyPage {...(props([event('turn-done', '会话「重构」完成')]) as unknown as Parameters<typeof NotifyPage>[0])} />)
    const row = screen.getByText('会话「重构」完成').closest('button')!
    expect(row.textContent).toContain('回复')
  })
})

describe('送达失败要看得出来是失败（2026-11-10 双皮肤实拍）', () => {
  // 原来失败/已过滤的记录和"共 24 次推送尝试"这种中性统计用同一个 .settings-note，
  // 截图里「失败 · HTTP 400 设备 token 已失效」和上面两行灰字长得一模一样。
  it('失败行带自己的类名，已过滤行也带', () => {
    const { container } = render(
      <NotifyPage
        {...({
          ...props([]),
          // 有 stats 才会画「送达情况」整块（日志行在里面）。
          inboxStats: { total: 2, sent: 0, failed: 1, dropped: 1, byChannel: [] },
          inboxDeliveries: [
            { at: Date.now(), eventId: 'e1', channel: 'bark', status: 'failed', detail: 'HTTP 400 设备 token 已失效' },
            { at: Date.now(), eventId: 'e2', channel: 'wxpusher', status: 'dropped' },
          ],
        } as unknown as Parameters<typeof NotifyPage>[0])}
      />,
    )
    const failLine = Array.from(container.querySelectorAll('.settings-note')).find((el) => el.textContent?.includes('HTTP 400'))
    expect(failLine?.className).toContain('notify-delivery-fail')
    const dropLine = Array.from(container.querySelectorAll('.settings-note')).find((el) => el.textContent?.includes('wxpusher') && el.textContent?.includes('已过滤'))
    expect(dropLine?.className).toContain('notify-delivery-drop')
  })

  it('样式表用复合选择器给失败行上警示色（同权重不会被子规则盖掉）', () => {
    const css = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toContain('.settings-note.notify-delivery-fail')
    const rule = css.slice(css.indexOf('.settings-note.notify-delivery-fail'), css.indexOf('}', css.indexOf('.settings-note.notify-delivery-fail')))
    expect(rule).toContain('var(--palm-danger)')
  })
})
