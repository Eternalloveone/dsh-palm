/**
 * 通知子页的「推送渠道」「Web Push」「触发条件」「隐私」四张卡与清空渠道确认。
 * 所有输入状态与保存动作由 SettingsView 持有，这里只渲染与转发事件。
 */
import type { NotifyConfigView } from '../../api.ts'
import { webPushSupported } from '../../notify.ts'
import { ConfirmDialog } from '../../dialog.tsx'
import { ChannelState, ScopeBadge } from './settings-shared.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface NotifyChannelsProps {
  locateProps: (id: string) => Record<string, string>
  notifyConfig: NotifyConfigView | undefined
  notifyBusy: boolean
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
}

export function NotifyChannels({
  locateProps, notifyConfig, notifyBusy,
  wxpusherSpt, setWxpusherSpt, serverchanKey, setServerchanKey, barkKey, setBarkKey,
  tgToken, setTgToken, tgChatId, setTgChatId, pushplusToken, setPushplusToken,
  handleTestNotify, saveChannels, webPushOn, handleWebPushToggle,
  thresholdInput, setThresholdInput, cooldownInput, setCooldownInput, saveNotifyTriggers,
  hideDetailsOn, handleHideDetailsToggle,
}: NotifyChannelsProps) {
  return (
    <>
          {/* L3 推送渠道（重点：关页面也能收） */}
          <div className="settings-card" {...locateProps('notify-wxpusher')}>
            <div className="settings-cardHead">
              <span className="settings-cardTitle">推送渠道</span>
              <ScopeBadge scope="sync" />
            </div>
            <p className="settings-note">页面关闭时也能收到，通过第三方应用直达（微信 / iOS / Telegram）。国内网络可用，任选其一即可；留空保存将清除该渠道。</p>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">WxPusher SPT</span>
                <ScopeBadge scope="recommend" />
              </div>
              <input
                type="text"
                className="settings-input"
                value={wxpusherSpt}
                placeholder="SPT_…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setWxpusherSpt(event.target.value) }}
              />
              <p className="settings-fieldDesc">微信直达 · 免费 · 国内直连。推荐首选。 <ChannelState configured={notifyConfig?.channels.wxpusher.configured === true} /></p>
              <details className="settings-details">
                <summary>如何获取 SPT（2 步）</summary>
                <div className="settings-detailsBody">
                  1. 打开 wxpusher.zjiecode.com/docs 的「极简推送 SPT」一节，手机微信扫码<br />
                  2. 复制 SPT_ 开头的令牌，粘贴到上方并保存
                </div>
              </details>
            </div>
            <div className="settings-field" {...locateProps('notify-serverchan')}>
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Server酱 SendKey</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={serverchanKey}
                placeholder="SCT…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setServerchanKey(event.target.value) }}
              />
              <p className="settings-fieldDesc">微信直达 · 国内直连（免费版每日条数有限）。 <ChannelState configured={notifyConfig?.channels.serverchan.configured === true} /></p>
            </div>
            <div className="settings-field" {...locateProps('notify-bark')}>
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Bark Key</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={barkKey}
                placeholder="…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setBarkKey(event.target.value) }}
              />
              <p className="settings-fieldDesc">iOS 直达：iPhone / iPad 装 Bark 应用后获取 Key。 <ChannelState configured={notifyConfig?.channels.bark.configured === true} /></p>
            </div>
            <div className="settings-field" {...locateProps('notify-tg')}>
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Telegram Bot Token</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={tgToken}
                placeholder="123456:ABC…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setTgToken(event.target.value) }}
              />
            </div>
            <div className="settings-field">
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">Telegram Chat ID</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={tgChatId}
                placeholder="…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setTgChatId(event.target.value) }}
              />
              <p className="settings-fieldDesc">Telegram 需要能访问境外网络。 <ChannelState configured={notifyConfig?.channels.telegram.configured === true} /></p>
            </div>
            {/* 降级渠道：放在最后，不给推荐徽章，仅保证旧 Token 继续能发 */}
            <div className="settings-field" {...locateProps('notify-pushplus')}>
              <div className="settings-fieldHead">
                <span className="settings-fieldLabel">PushPlus Token（已降级）</span>
              </div>
              <input
                type="text"
                className="settings-input"
                value={pushplusToken}
                placeholder="…（到 pushplus.plus 复制）"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => { setPushplusToken(event.target.value) }}
              />
              <p className="settings-fieldDesc">微信直达 · 国内直连。pushplus 现已要求付费认证，故降级为兼容保留（旧 Token 仍可发）；新配置请用上方 WxPusher。 <ChannelState configured={notifyConfig?.channels.pushplus.configured === true} /></p>
            </div>
            <div className="sheet-confirm-actions">
              <Button
                type="button"
                className="mobile-button"
                disabled={notifyBusy}
                onClick={() => { void handleTestNotify() }}
              >发送测试</Button>
              <Button
                type="button"
                className="mobile-button mobile-button-primary"
                aria-label="保存推送渠道"
                disabled={notifyBusy}
                onClick={() => { void saveChannels() }}
              >保存</Button>
            </div>
          </div>

          {/* L2 Web Push（可选，大陆受限） */}
          {webPushSupported() && (
            <div className="settings-card" {...locateProps('notify-webpush')}>
              <div className="settings-cardHead">
                <span className="settings-cardTitle">Web Push</span>
                <ScopeBadge scope="sync" />
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">启用</span>
                </div>
                <Button
                  type="button"
                  role="switch"
                  aria-label="Web Push"
                  aria-checked={webPushOn === true}
                  className={`settings-switch${webPushOn === true ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleWebPushToggle(!(webPushOn === true)) }}
                />
                <p className="settings-fieldDesc">页面关闭时由浏览器系统推送。推送服务（FCM）在大陆网络不可直连，开启需要代理；大陆用户建议用上方「推送渠道」代替。</p>
              </div>
            </div>
          )}

          {/* 高级：触发条件 */}
          {notifyConfig !== undefined && (
            <div className="settings-card" {...locateProps('notify-triggers')}>
              <div className="settings-cardHead">
                <span className="settings-cardTitle">触发条件（可选）</span>
                <ScopeBadge scope="sync" />
              </div>
              <p className="settings-note">默认：仅当回复耗时超过阈值时才提醒，避免被打断。</p>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">回复时长阈值（秒）</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className="settings-input"
                  aria-label="回复时长阈值"
                  value={thresholdInput}
                  onChange={(event) => { setThresholdInput(event.target.value) }}
                />
                <p className="settings-fieldDesc">超过此时长的回复完成时通知</p>
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">通知间隔（分钟）</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className="settings-input"
                  aria-label="通知间隔"
                  value={cooldownInput}
                  onChange={(event) => { setCooldownInput(event.target.value) }}
                />
                <p className="settings-fieldDesc">同一会话两次通知的最小间隔</p>
              </div>
              <div className="sheet-confirm-actions">
                <Button
                  type="button"
                  className="mobile-button mobile-button-primary"
                  aria-label="保存触发条件"
                  disabled={notifyBusy}
                  onClick={() => { void saveNotifyTriggers() }}
                >保存</Button>
              </div>
            </div>
          )}

          {/* 隐私：锁屏不泄露标题/任务名 */}
          {notifyConfig !== undefined && (
            <div className="settings-card" {...locateProps('notify-privacy')}>
              <div className="settings-cardHead">
                <span className="settings-cardTitle">隐私</span>
                <ScopeBadge scope="sync" />
              </div>
              <div className="settings-field">
                <div className="settings-fieldHead">
                  <span className="settings-fieldLabel">锁屏隐藏通知详情</span>
                </div>
                <Button
                  type="button"
                  role="switch"
                  aria-label="锁屏隐藏通知详情"
                  aria-checked={hideDetailsOn}
                  className={`settings-switch${hideDetailsOn ? ' settings-switch-on' : ''}`}
                  disabled={notifyBusy}
                  onClick={() => { void handleHideDetailsToggle(!hideDetailsOn) }}
                />
                <p className="settings-fieldDesc">通知不显示会话标题与任务名，避免锁屏时被旁人看到内容</p>
              </div>
            </div>
          )}
    </>
  )
}

export interface NotifyClearConfirmProps {
  confirmClearChannels: boolean
  setConfirmClearChannels: (value: boolean) => void
  persistChannels: () => Promise<void>
}

export function NotifyClearConfirm({
  confirmClearChannels, setConfirmClearChannels, persistChannels,
}: NotifyClearConfirmProps) {
  return (
    <>
        {confirmClearChannels && (
          <ConfirmDialog
            title="清除已配置的推送渠道？"
            body="输入框均为空，保存将清除电脑端已保存的通道凭据（Server酱 / Bark / Telegram / WxPusher / PushPlus），之后这些渠道将收不到通知。如果要保留，请取消后不要点保存。"
            confirmLabel="清除"
            tone="danger"
            onCancel={() => { setConfirmClearChannels(false) }}
            onConfirm={() => { setConfirmClearChannels(false); void persistChannels() }}
          />
        )}
    </>
  )
}
