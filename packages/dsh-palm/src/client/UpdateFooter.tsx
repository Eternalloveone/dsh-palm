/**
 * 面板最底部的一行：版本检查 + 一键更新 + 重启倒计时。
 *
 * 打开面板时在后台查一次版本（不阻塞三步向导）；点「更新」先在面板内联
 * 确认一次，再交给宿主在后台跑；之后每秒轮询一次状态，最多 3 分钟。
 * 失败或拒绝都只在这一行用一句话说清楚，绝不弹窗。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  cancelUpdateRestart,
  fetchUpdateStatus,
  fetchUpdateVersion,
  startUpdate,
  type UpdateStatusFrame,
} from './pair-api.ts'
import { IconGitHubFill16 } from './icons.tsx'
import css from './remote.module.css'

/** 底部一行的视图状态。 */
type FooterView =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'latest'; version: string }
  | { kind: 'available'; from: string; to: string; confirming: boolean }
  | { kind: 'running'; step: string }
  | { kind: 'restarting'; to: string; restartAt: number; remaining: number }
  | { kind: 'done'; to: string; step: string }
  | { kind: 'failed'; reason: string }

/** 轮询上限：3 分钟还没结束就当超时，给一句话。 */
const MAX_POLLS_MS = 180_000

/** 状态帧 → 视图。倒计时秒数由调用方给的 now 计算。 */
function viewOfStatus(frame: UpdateStatusFrame, now: number): FooterView {
  if (frame.phase === 'restarting' && frame.restartAt !== undefined) {
    return {
      kind: 'restarting',
      to: frame.to,
      restartAt: frame.restartAt,
      remaining: Math.max(0, Math.ceil((frame.restartAt - now) / 1000)),
    }
  }
  if (frame.phase === 'running') return { kind: 'running', step: frame.step }
  if (frame.phase === 'done') return { kind: 'done', to: frame.to, step: frame.step }
  if (frame.phase === 'failed') return { kind: 'failed', reason: frame.error ?? '' }
  return { kind: 'hidden' }
}

/**
/**
 * 行尾的仓库入口：「dsh-palm 1.7.0 · 已是最新」右边那颗 octocat。
 *
 * 位置就在版本这句话旁边 —— 用户问"有没有新版本"时顺手也能去仓库看源码、提 Issue，
 * 比回设置里翻「反馈」那一行近一步。它跟着更新条一起出现/消失（查不到版本时整行
 * 按既有契约隐藏，见下面的 hidden 分支）。
 */
function RepoLink({ t }: { t: TranslateNS<'remote'> }) {
  return (
    <a
      className={css.updateRepo}
      href="https://github.com/Eternalloveone/dsh-palm"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('update.repo')}
      title={t('update.repoHint')}
    >
      <IconGitHubFill16 />
    </a>
  )
}
/** UpdateFooter 的属性。 */
export interface UpdateFooterProps {
  t: TranslateNS<'remote'>
  /** 轮询间隔（测试注入；默认 1 秒）。 */
  pollMs?: number
}

/**
 * 渲染底部更新条。
 * @param props - 文案 + 轮询间隔。
 * @returns 底部一行，或 null（版本未知 / 查不到时整行隐藏）。
 */
export function UpdateFooter({ t, pollMs = 1000 }: UpdateFooterProps) {
  const [view, setView] = useState<FooterView>({ kind: 'checking' })
  // 倒计时的本地时钟：轮询每来一帧就更新一次，让"x 秒后重启"真的在走。
  const [now, setNow] = useState(() => Date.now())
  // 第一次看到"可更新"时让圆点闪两下，之后安静下来——只闪一次，不循环。
  const [fresh, setFresh] = useState(false)
  const mounted = useRef(true)
  // 打开那一刻的已装版本：宿主说"已经是最新"时用它显示。
  const installedRef = useRef('')
  const toRef = useRef('')
  const startedAt = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 可更新状态出现时亮一次（约 2.5 秒），把"有待办"推到眼前。
  useEffect(() => {
    if (view.kind !== 'available') {
      setFresh(false)
      return
    }
    setFresh(true)
    const timer = setTimeout(() => { setFresh(false) }, 2500)
    return () => { clearTimeout(timer) }
  }, [view.kind])

  // 打开面板时后台查一次；不阻塞三步向导。
  const check = useCallback(async () => {
    const frame = await fetchUpdateVersion()
    if (!mounted.current) return
    if (frame === undefined) {
      setView({ kind: 'hidden' })
      return
    }
    installedRef.current = frame.installed
    if (frame.latest !== null && frame.isNewer) {
      toRef.current = frame.latest
      setView({ kind: 'available', from: frame.installed, to: frame.latest, confirming: false })
      return
    }
    setView({ kind: 'latest', version: frame.installed })
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  // 更新中 / 待重启：每秒（pollMs）问一次宿主，直到结束或超时。
  useEffect(() => {
    if (view.kind !== 'running' && view.kind !== 'restarting') return
    if (startedAt.current === 0) startedAt.current = Date.now()
    let cancelled = false
    const poll = async (): Promise<void> => {
      if (Date.now() - startedAt.current > MAX_POLLS_MS) {
        if (!cancelled) setView({ kind: 'failed', reason: t('update.timeout') })
        return
      }
      const frame = await fetchUpdateStatus()
      if (cancelled || frame === undefined) return
      const at = Date.now()
      if (frame.to !== '') toRef.current = frame.to
      setNow(at)
      setView(viewOfStatus(frame, at))
    }
    const timer = window.setInterval(() => { void poll() }, pollMs)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // 只跟随阶段走：视图对象每秒都会换新，整份放进依赖会把轮询重开一遍。
  }, [view.kind, pollMs])

  const confirmUpdate = useCallback(async () => {
    const result = await startUpdate(false)
    if (!mounted.current) return
    if (result === undefined) {
      setView({ kind: 'failed', reason: t('update.failedGeneric') })
      return
    }
    if (result.started) {
      startedAt.current = Date.now()
      setView({ kind: 'running', step: '' })
      return
    }
    const refuse = result.plan?.refuse
    if (refuse !== undefined && refuse !== '') {
      setView({ kind: 'failed', reason: refuse })
      return
    }
    setView({ kind: 'latest', version: installedRef.current })
  }, [t])

  const cancelCountdown = useCallback(async () => {
    const cancelled = await cancelUpdateRestart()
    if (!mounted.current) return
    setView({ kind: 'done', to: toRef.current, step: cancelled ? 'cancelled' : 'restart-uncertain' })
  }, [])

  // 版本查不到（老宿主、接口不通、还没配对）：整行不渲染 —— 这条是既有契约，
  // tests/update-footer.spec.tsx 锁着它（"hides the line entirely when the host
  // cannot answer"）。仓库入口跟着这一行一起出现/消失，不单独为它开一条空行。
  if (view.kind === 'hidden') return null
  return (
    <div className={css.updateFooter} data-testid="remote-update" aria-live="polite">
      {view.kind === 'checking' && (
        <span className={css.updateMuted}>{t('update.checking')}</span>
      )}

      {view.kind === 'latest' && (
        <span className={css.updateMuted}>{t('update.upToDate', { version: view.version })}</span>
      )}

      {view.kind === 'available' && !view.confirming && (
        <>
          <span
            className={fresh ? `${css.updateDot} ${css.updateFresh}` : css.updateDot}
            data-testid="remote-update-dot"
            aria-hidden="true"
          />
          <span className={css.updateAvailable} data-emphasis="accent">
            {t('update.available', { from: view.from, to: view.to })}
          </span>
          <button
            type="button"
            className={css.updateBtnPrimary}
            onClick={() => { setView({ ...view, confirming: true }) }}
          >
            {t('update.action')}
          </button>
        </>
      )}

      {view.kind === 'available' && view.confirming && (
        <>
          <span className={css.updateText}>{t('update.confirm', { to: view.to })}</span>
          <button
            type="button"
            className={css.updateBtnPrimary}
            onClick={() => { void confirmUpdate() }}
          >
            {t('update.confirmYes')}
          </button>
          <button
            type="button"
            className={css.updateBtn}
            onClick={() => { setView({ ...view, confirming: false }) }}
          >
            {t('update.cancel')}
          </button>
        </>
      )}

      {view.kind === 'running' && (
        <>
          <span className={css.updateText}>
            {view.step === '' ? t('update.running') : t('update.runningStep', { step: view.step })}
          </span>
          <span className={css.updateTrack} aria-hidden="true">
            <span className={css.updateBar} />
          </span>
        </>
      )}

      {view.kind === 'restarting' && (
        <>
          <span className={css.updateCountdown} data-testid="remote-update-countdown">
            {t('update.restartCountdown', { seconds: Math.max(0, Math.ceil((view.restartAt - now) / 1000)) })}
          </span>
          <button
            type="button"
            className={css.updateBtn}
            onClick={() => { void cancelCountdown() }}
          >
            {t('update.cancel')}
          </button>
        </>
      )}

      {view.kind === 'done' && (
        <span className={css.updateMuted}>
          {view.step === 'cancelled'
            ? t('update.restartCancelled')
            : t('update.done', { version: view.to })}
        </span>
      )}

      {view.kind === 'failed' && (
        <span className={css.updateReason} role="status">
          {view.reason === '' ? t('update.failedGeneric') : view.reason}
        </span>
      )}

      {/* 行尾的仓库入口：版本信息可能查不到、更新也可能失败，但「源码在哪、去哪提
          Issue」永远值得一键可达，所以它不跟着上面那些状态一起消失。 */}
      <RepoLink t={t} />
    </div>
  )
}
