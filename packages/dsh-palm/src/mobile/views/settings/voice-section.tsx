/**
 * 「语音」分组行与语音服务子页：桌面端只读行、手机端可编辑列表、添加/编辑表单。
 * 列表存储与表单 state 留在 SettingsView，这里只渲染与调用动作。
 */
import { ChevronUpIcon, MicIcon, PencilIcon, PlusIcon, TrashIcon } from '../../components/icons.tsx'
import { Sheet } from '../../ui/sheet.tsx'
import { moveVoiceServiceDown, moveVoiceServiceUp, removeVoiceService, upsertVoiceService, type VoiceService } from '../../platform/voice-services.ts'
import { RowChevron, SettingsRow } from './settings-shared.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface VoiceSectionProps {
  show: boolean
  voiceServices: VoiceService[]
  hostVoiceServices: Array<{ name: string; baseURL: string; model: string }>
  openVoicePage: () => void
}

export function VoiceSection({ show, voiceServices, hostVoiceServices, openVoicePage }: VoiceSectionProps) {
  return (
        <ul className="settings-group">
          <li className="settings-groupTitle">语音 <span className="settings-groupDesc">语音输入与转写</span></li>
          {show && (
            <SettingsRow
              icon={<MicIcon />}
              title="语音服务"
              desc={voiceServices.length === 0
                ? (hostVoiceServices.length > 0 ? `桌面端已配置 ${hostVoiceServices.length} 个转写服务` : '语音转写服务，按序回退')
                : `${voiceServices.length} 个服务 · 按序回退`}
              action={<RowChevron />}
              onClick={() => { openVoicePage() }}
            />
          )}
        </ul>
  )
}

export interface VoicePageProps {
  setVoiceOpen: (open: boolean) => void
  hostVoiceServices: Array<{ name: string; baseURL: string; model: string }>
  locateProps: (id: string) => Record<string, string>
  voiceServices: VoiceService[]
  setEditingService: (service: VoiceService | undefined) => void
  setFormName: (value: string) => void
  setFormBaseURL: (value: string) => void
  setFormApiKey: (value: string) => void
  setFormModel: (value: string) => void
  setVoiceSheet: (sheet: 'list' | 'form' | null) => void
  voiceSheet: 'list' | 'form' | null
  editingService: VoiceService | undefined
  formName: string
  formBaseURL: string
  formApiKey: string
  formModel: string
}

export function VoicePage({
  setVoiceOpen, hostVoiceServices, locateProps, voiceServices,
  setEditingService, setFormName, setFormBaseURL, setFormApiKey, setFormModel,
  setVoiceSheet, voiceSheet, editingService, formName, formBaseURL, formApiKey, formModel,
}: VoicePageProps) {
  return (
      <div className="mobile">
        <header className="mobile-header">
          <div className="mobile-headerSlot">
            <Button type="button" className="mobile-back" aria-label="返回" onClick={() => { setVoiceOpen(false) }}>‹</Button>
          </div>
          <h1 className="mobile-title">语音服务</h1>
          <div className="mobile-headerSlot mobile-headerSlot-right" />
        </header>
        <div className="mobile-scroll">
          <p className="settings-note">语音转写按列表顺序尝试，失败自动回退到下一个服务。</p>
          {hostVoiceServices.length > 0 && (
            <p className="settings-hostNote">
              ✓ 桌面端已配置 {hostVoiceServices.length} 个转写服务，手机语音输入将自动使用，无需重复配置。
            </p>
          )}
          {hostVoiceServices.length > 0 && (
            <>
              <div className="settings-subhead">桌面端配置（只读）</div>
              <div className="settings-card">
                {hostVoiceServices.map(service => (
                  <div key={service.name} className="voice-service-row">
                    <span className="voice-service-copy">
                      <span className="voice-service-name">
                        {service.name} <span className="settings-roTag">桌面端</span>
                      </span>
                      <span className="voice-service-desc">{service.model} · {service.baseURL}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="settings-subhead">手机端服务</div>
          <div className="settings-card" {...locateProps('voice-list')}>
            {voiceServices.length === 0 && (
              <p className="settings-note">尚未配置服务 — 点击下方「添加服务」。</p>
            )}
            {voiceServices.map((service, index) => (
              <div key={service.id} className="voice-service-row">
                <span className="voice-service-copy">
                  <span className="voice-service-name">{service.name !== '' ? service.name : service.model}</span>
                  <span className="voice-service-desc">{service.model} · {service.baseURL}</span>
                </span>
                <span className="voice-service-actions">
                  <Button
                    type="button"
                    className="voice-service-btn"
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => { moveVoiceServiceUp(service.id) }}
                  ><ChevronUpIcon /></Button>
                  <Button
                    type="button"
                    className="voice-service-btn voice-service-btn-down"
                    aria-label="下移"
                    disabled={index === voiceServices.length - 1}
                    onClick={() => { moveVoiceServiceDown(service.id) }}
                  ><ChevronUpIcon /></Button>
                  <Button
                    type="button"
                    className="voice-service-btn"
                    aria-label="编辑"
                    onClick={() => {
                      setEditingService(service)
                      setFormName(service.name)
                      setFormBaseURL(service.baseURL)
                      setFormApiKey(service.apiKey)
                      setFormModel(service.model)
                      setVoiceSheet('form')
                    }}
                  ><PencilIcon /></Button>
                  <Button
                    type="button"
                    className="voice-service-btn voice-service-btn-danger"
                    aria-label="删除"
                    onClick={() => { removeVoiceService(service.id) }}
                  ><TrashIcon /></Button>
                </span>
              </div>
            ))}
          </div>
          <div className="sheet-confirm-actions" {...locateProps('voice-add')}>
            <Button
              type="button"
              className="mobile-button"
              onClick={() => {
                setEditingService(undefined)
                setFormName('')
                setFormBaseURL('')
                setFormApiKey('')
                setFormModel('')
                setVoiceSheet('form')
              }}
            ><PlusIcon /> 添加服务</Button>
          </div>
        </div>
        {voiceSheet === 'form' && (
          <Sheet title={editingService === undefined ? '添加服务' : '编辑服务'} onClose={() => { setVoiceSheet(null) }}>
            <div className="voice-form">
              <label className="voice-form-field">
                <span className="voice-form-label">名称</span>
                <input
                  className="voice-form-input"
                  value={formName}
                  placeholder="如：硅基流动"
                  onChange={(event) => { setFormName(event.target.value) }}
                />
              </label>
              <label className="voice-form-field">
                <span className="voice-form-label">API 地址（baseURL）</span>
                <input
                  className="voice-form-input"
                  value={formBaseURL}
                  placeholder="https://api.siliconflow.cn/v1"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => { setFormBaseURL(event.target.value) }}
                />
              </label>
              <label className="voice-form-field">
                <span className="voice-form-label">API Key</span>
                <input
                  className="voice-form-input"
                  value={formApiKey}
                  placeholder="sk-…"
                  type="password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => { setFormApiKey(event.target.value) }}
                />
              </label>
              <label className="voice-form-field">
                <span className="voice-form-label">模型</span>
                <input
                  className="voice-form-input"
                  value={formModel}
                  placeholder="FunAudioLLM/SenseVoiceSmall"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => { setFormModel(event.target.value) }}
                />
              </label>
              <p className="sheet-note">支持任意 OpenAI 兼容的 /audio/transcriptions 服务。</p>
              <div className="sheet-confirm-actions">
                <Button type="button" className="mobile-button" onClick={() => { setVoiceSheet(null) }}>取消</Button>
                <Button
                  type="button"
                  className="mobile-button mobile-button-primary"
                  disabled={formBaseURL.trim() === '' || formApiKey.trim() === '' || formModel.trim() === ''}
                  onClick={() => {
                    upsertVoiceService({
                      id: editingService?.id
                        ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                          ? crypto.randomUUID()
                          : `svc-${Date.now()}`),
                      name: formName.trim(),
                      baseURL: formBaseURL.trim(),
                      apiKey: formApiKey.trim(),
                      model: formModel.trim(),
                    })
                    setVoiceSheet(null)
                  }}
                >保存</Button>
              </div>
            </div>
          </Sheet>
        )}
      </div>
  )
}
