/**
 * 通知子页（整页）：三条通道引导、送达情况、最近通知、浏览器通知、通知内容，
 * 后半段（推送渠道 / Web Push / 触发条件 / 隐私）在 notify-channels.tsx。
 */
import type { DeliveryRecordView, DeliveryStatsView, NotifyConfigView, NotifyEventView } from '../../api.ts'
import { ScopeBadge, formatInboxTime } from './settings-shared.tsx'
import { NotifyChannels, NotifyClearConfirm } from './notify-channels.tsx'

export interface NotifyPageProps {
  setNotifyOpen: (open: boolean) => void
  inboxStats: DeliveryStatsView | undefined
  inboxDeliveries: DeliveryRecordView[] | undefined
  inboxBusy: boolean
  inbox: NotifyEventView[]
  locateProps: (id: string) => Record<string, string>
  notifyPermission: NotificationPermission | 'unsupported'
  notifyDesc: string
  notifyBusy: boolean
  handleNotifyClick: () => Promise<void>
  notifyConfig: NotifyConfigView | undefined
  kindsOn: NotifyConfigView['kinds']
  handleKindToggle: (kind: 'jobs' | 'todo' | 'turns' | 'approvals', next: boolean) => Promise<void>
  wxpusherSpt: string
  setWxpusherSpt: (value: string) => void
  serverchanKey: string
  setServerchanKey: (value: string) => void
  barkKey: string
  setBarkKey: (value: string) => void
  tgToken: string
  setTgToken: (value: string) => void
  tgChatId: string
  setTgChatId: (value: string) => void
  pushplusToken: string
  setPushplusToken: (value: string) => void
  handleTestNotify: () => Promise<void>
  saveChannels: () => Promise<void>
  webPushOn: boolean | undefined
  handleWebPushToggle: (next: boolean) => Promise<void>
  thresholdInput: string
  setThresholdInput: (value: string) => void
  cooldownInput: string
  setCooldownInput: (value: string) => void
  saveNotifyTriggers: () => Promise<void>
  hideDetailsOn: boolean
  handleHideDetailsToggle: (next: boolean) => Promise<void>
  confirmClearChannels: boolean
  setConfirmClearChannels: (value: boolean) => void
  persistChannels: () => Promise<void>
}

export function NotifyPage({
  setNotifyOpen, inboxStats, inboxDeliveries, inboxBusy, inbox, locateProps,
  notifyPermission, notifyDesc, notifyBusy, handleNotifyClick, notifyConfig, kindsOn, handleKindToggle,
  wxpusherSpt, setWxpusherSpt, serverchanKey, setServerchanKey, barkKey, setBarkKey,
  tgToken, setTgToken, tgChatId, setTgChatId, pushplusToken, setPushplusToken,
  handleTestNotify, saveChannels, webPushOn, handleWebPushToggle,
  thresholdInput, setThresholdInput, cooldownInput, setCooldownInput, saveNotifyTriggers,
  hideDetailsOn, handleHideDetailsToggle,
  confirmClearChannels, setConfirmClearChannels, persistChannels,
}: NotifyPageProps) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <div className="mobile-headerSlot">
            <button type="button" className="mobile-back" aria-label="返回" onClick={() => { setNotifyOpen(false) }}>‹</button>
          </div>
          <h1 className="mobile-title">通知</h1>
          <div className="mobile-headerSlot mobile-headerSlot-right" />
        </header>
        <div className="mobile-scroll">
          {/* 引导：三种通道怎么选（先看这里） */}
          <div className="settings-card">
            <div className="settings-cardHead">
              <span className="settings-cardTitle">该开哪个？</span>
            </div>
            <p className="settings-note">任务完成提醒有三条通道，从上到下生效范围越来越广：</p>
            <div className="settings-field">
              <p className="settings-fieldDesc">
                <b>① 浏览器通知</b>：只在你刚切到后台的短暂窗口内兜底（页面在前台时不弹）。安卓/iOS 都需要系统授权，iOS 还需先"添加到主屏"。<br />
                <b>② 推送渠道</b>：页面关闭也能收，微信/iOS 直达、国内可靠。推荐任填一个（WxPusher 或 Server酱）。<br />
                <b>③ Web Push</b>：系统级推送，但服务（FCM）在大陆不可直连，需代理才可用。大陆用户可不开。
              </p>
            </div>
          </div>

          {/* 送达情况：手机没响的时候，先看这里分清"没发"还是"没送到" */}
          {inboxStats !== undefined && inboxStats.total > 0 && (
            <div className="settings-card">
              <div className="settings-cardHead">
                <span className="settings-cardTitle">送达情况</span>
              </div>
              <p className="settings-note">
                共 {inboxStats.total} 次推送尝试 · 成功 {inboxStats.sent} · 失败 {inboxStats.failed} · 已过滤 {inboxStats.dropped}
              </p>
              {inboxStats.byChannel.length > 0 && (
                <p className="settings-note">
                  {inboxStats.byChannel.map(channel => `${channel.channel} ${channel.sent}/${channel.sent + channel.failed + channel.dropped}`).join(' · ')}
                </p>
              )}
              {(inboxDeliveries ?? []).filter(record => record.status !== 'sent').slice(0, 8).map(record => (
                <p className="settings-note" key={`${record.at}-${record.eventId}-${record.channel}`}>
                  {new Date(record.at).toLocaleTimeString()} · {record.channel} · {record.status === 'dropped' ? '已过滤' : '失败'}
                  {record.detail !== undefined ? ` · ${record.detail}` : ''}
                </p>
              ))}
            </div>
          )}

          {/* 最近通知：主机的判定记录（错过即丢的兜底） */}
          <div className="settings-card">
            <div className="settings-cardHead">
              <span className="settings-cardTitle">最近通知</span>
            </div>
            {inboxBusy ? (
              <p className="settings-note">加载中…</p>
            ) : inbox.length === 0 ? (
              <p className="settings-note">暂无通知——任务完成或长回复结束时，这里会留下记录可回看。</p>
            ) : (
              <div className="settings-inbox">
                {inbox.slice(0, 20).map(item => (
                  <button
                    type="button"
                    key={item.id}
                    className="settings-inboxRow"
                    onClick={() => {
                      // 通知里不一定带 workspaceId（宿主没给时就空）：以前这种行是
                      // disabled 的，点了没反应。现在照样能跳——没工作区就只带会话 id，
                      // 反而不要把空的 workspace 参数写进去（会被当成「未分组」）。
                      const url = new URL(window.location.href)
                      if (item.workspaceId === undefined || item.workspaceId === '') url.searchParams.delete('workspace')
                      else url.searchParams.set('workspace', item.workspaceId)
                      url.searchParams.set('session', item.sessionId)
                      window.location.href = `${url.pathname}${url.search}`
                    }}
                  >
                    <span className="settings-inboxLine">
                      <span className={`settings-inboxKind settings-inboxKind-${item.kind}`}>
                        {item.kind === 'task-done' ? '完成' : item.kind === 'task-failed' ? '失败' : item.kind === 'todo-done' ? '规划' : '回复'}
                      </span>
                      <span className="settings-inboxTitle">{item.title}</span>
                      <span className="settings-inboxTime">{formatInboxTime(item.ts)}</span>
                    </span>
                    <span className="card-desc">{item.body}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* L1 浏览器通知（页内提醒） */}
          <div className="settings-card" {...locateProps('notify-browser')}>
            <div className="settings-cardHead">
              <span className="settings-cardTitle">浏览器通知</span>
              <ScopeBadge scope="sync" />
            </div>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">启用</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="浏览器通知"
                aria-checked={notifyPermission === 'granted'}
                className={`settings-switch${notifyPermission === 'granted' ? ' settings-switch-on' : ''}`}
                disabled={notifyBusy}
                onClick={() => { void handleNotifyClick() }}
              />
              <p className="settings-fieldDesc">{notifyDesc}</p>
            </div>
          </div>

          {/* 通知内容：三类事件分别开关（先决定通知什么） */}
          {notifyConfig !== undefined && (
            <div className="settings-card" {...locateProps('notify-kinds')}>
              <div className="settings-cardHead">
                <span className="settings-cardTitle">通知内容</span>
                <ScopeBadge scope="sync" />
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">规划完成</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="规划完成"
                  aria-checked={kindsOn.todo}
                  className={`settings-switch${kindsOn.todo ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleKindToggle('todo', !kindsOn.todo) }}
                />
                <p className="settings-fieldDesc">任务规划全部完成时通知（推荐开启）</p>
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">后台任务</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="后台任务"
                  aria-checked={kindsOn.jobs}
                  className={`settings-switch${kindsOn.jobs ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleKindToggle('jobs', !kindsOn.jobs) }}
                />
                <p className="settings-fieldDesc">每个命令 / 子任务完成或失败都会提醒，容易打扰（默认关闭）</p>
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">长回复</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="长回复"
                  aria-checked={kindsOn.turns}
                  className={`settings-switch${kindsOn.turns ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleKindToggle('turns', !kindsOn.turns) }}
                />
                <p className="settings-fieldDesc">超过时长阈值的回复完成时提醒（默认关闭）</p>
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">审批与提问</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="审批与提问"
                  aria-checked={kindsOn.approvals}
                  className={`settings-switch${kindsOn.approvals ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleKindToggle('approvals', !kindsOn.approvals) }}
                />
                <p className="settings-fieldDesc">需要你批准或回答时提醒（默认开启，建议保留）</p>
              </div>
            </div>
          )}
        <NotifyChannels
          locateProps={locateProps}
          notifyConfig={notifyConfig}
          notifyBusy={notifyBusy}
          wxpusherSpt={wxpusherSpt}
          setWxpusherSpt={setWxpusherSpt}
          serverchanKey={serverchanKey}
          setServerchanKey={setServerchanKey}
          barkKey={barkKey}
          setBarkKey={setBarkKey}
          tgToken={tgToken}
          setTgToken={setTgToken}
          tgChatId={tgChatId}
          setTgChatId={setTgChatId}
          pushplusToken={pushplusToken}
          setPushplusToken={setPushplusToken}
          handleTestNotify={handleTestNotify}
          saveChannels={saveChannels}
          webPushOn={webPushOn}
          handleWebPushToggle={handleWebPushToggle}
          thresholdInput={thresholdInput}
          setThresholdInput={setThresholdInput}
          cooldownInput={cooldownInput}
          setCooldownInput={setCooldownInput}
          saveNotifyTriggers={saveNotifyTriggers}
          hideDetailsOn={hideDetailsOn}
          handleHideDetailsToggle={handleHideDetailsToggle}
        />
        </div>
        <NotifyClearConfirm
          confirmClearChannels={confirmClearChannels}
          setConfirmClearChannels={setConfirmClearChannels}
          persistChannels={persistChannels}
        />
      </div>
    )
}
