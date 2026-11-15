/**
 * 抽屉「用量」行的数字从哪来（2026-11-14）。
 *
 * ## 三条要求，一个短语
 *
 * ①用户第一版：「显示当前模型所在的 coding plan 或者 api 接口的具体余额或者用量
 *   数字」→ 得先知道**当前模型是哪家**（`session.models` 的 `current.provider`）；
 * ②用户第二版：「本周 32% 不够明显」→ 短语里必须写方向（「已用」）；
 * ③用户第三版（本文件这条链路的关键）：「我在输入框下方切换完模型之后，侧边栏的
 *   『用量』也要**同时**切换成当前模型的本周或者本月已用值」→ 换模型的那一刻就要
 *   跟上，不能等我下次开抽屉、更不能等那 3.8 秒的宿主查询。
 *
 * ## 怎么做到"同时"
 *
 * 换模型只有一条路：`data/impl/settings.ts` 的 `selectModel()`，它在成功后广播
 * `platform/model-switch.ts` 的一次事实。这里订阅它，并且**手里已经有上一份用量面**
 * （`lastView`，一次查询就把所有提供方都带回来了）—— 换家的那一刻不需要任何网络，
 * 直接从内存里换一行、换一个窗口，React 立刻重渲染。
 *
 * ## 为什么抽屉不等它
 *
 * 宿主那趟查询实测 3.8 秒（5 家各发 HTTP）。抽屉是导航，不能为了一个字挂在那里转圈：
 * 所以先给上一次存下的短语（localStorage，跨启动），后台补一次新的。
 *
 * @module dsh-palm/mobile/views/use-usage-chip
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { models } from '../data/settings.ts'
import { fetchUsage } from '../data/usage.ts'
import type { UsageView } from '../mobile-types.ts'
import { lastModelSwitch, subscribeModelSwitch } from '../platform/model-switch.ts'
import {
  pickUsageProvider,
  readCachedUsageChip,
  usageChipText,
  writeCachedUsageChip,
} from './drawer-usage.ts'

/**
 * 两次**例行**查询之间的最小间隔。
 *
 * 宿主自己有 60 秒缓存，比这还长的间隔只会多打一次 RPC 不产生新数字；但手机端
 * 反复开抽屉（看列表→关→再开）也不该每次都问一遍。
 */
const MIN_INTERVAL_MS = 20_000

/**
 * 换模型触发的补查询之间的最小间隔。
 *
 * 用户可能在选模型面板里连点两三家：第一次立刻算（内存里的数据够用），后面这几次
 * 只合并成一次真查询，别把宿主当压力测试。
 */
const SWITCH_MIN_INTERVAL_MS = 1_500

/**
 * 换模型后的这么长时间里，以广播的那家为准（不采信可能还没落盘的会话目录）。
 *
 * 宿主把 `selectModel` 落盘、再让 `session.models` 反映出来之间有一个空窗；1 分钟
 * 足够跨过它，又不会长到"用户真在别处改了模型而这边还认旧的"。
 */
const SWITCH_TRUST_MS = 60_000

/** 预热延迟：等首屏（会话正文/列表）先落地，别和金贵的前几百毫秒抢带宽。 */
const WARM_DELAY_MS = 3_000

/** 上一次真查询的时刻（模块级：跨抽屉开关，不跨页面刷新）。 */
let lastFetchAt = 0
/** 最后一次换模型的时刻（节流用）。 */
let lastSwitchAt = 0
/**
 * 最近一份用量面。
 *
 * 它是"换模型能瞬间生效"的全部秘密：一次 `mobile.usage` 就把**所有**提供方的余额/
 * 配额都带回来了，换一家只是换一行取值，不需要再问宿主。
 */
let lastView: UsageView | undefined

/**
 * 真查一次：会话模型目录（拿 provider）+ 用量面（拿数字）。
 *
 * @returns 短语；`{ known: false }` = 这条链路啥也没拿到（调用方保留旧值）
 */
async function measure(
  sessionId: string,
  providerOverride?: string,
): Promise<{ known: boolean; text: string | undefined }> {
  // 两件事互不依赖：模型目录失败（新会话/宿主抖动）时仍然按「只有一家查得到数字」
  // 的规则兜底，不能因为拿不到 provider 就整块放弃。
  const [catalog, view] = await Promise.all([
    models(sessionId).catch(() => undefined),
    fetchUsage().catch(() => undefined),
  ])
  if (view !== undefined) lastView = view
  // 一条都没拿到（网络/宿主拒绝）：保留上次的数字，不动界面。
  if (lastView === undefined) return { known: false, text: undefined }
  /*
   * 广播来的 provider **优先**于会话目录。
   *
   * 实测（2026-11-14 计时探针）：点完模型 104ms 小字已经换成新那家，随后换模型触发的
   * 那次真查询把数字**顶回了旧那家** —— 因为宿主的 `session.models` 在切换落盘前
   * 还答旧 provider。刚点的那一下是当事人的意愿，目录是滞后的事实；几百毫秒内以广播
   * 为准，之后目录自然会追上来。
   */
  const provider = providerOverride ?? catalog?.current.provider
  return { known: true, text: usageChipText(pickUsageProvider(lastView, provider)) }
}

/** 这个会话最近一次换模型（1 分钟内）切到了哪家；没有给 undefined。 */
function recentSwitchProvider(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) return undefined
  const last = lastModelSwitch()
  if (last === undefined || last.sessionId !== sessionId) return undefined
  return Date.now() - lastSwitchAt < SWITCH_TRUST_MS ? last.provider : undefined
}

/**
 * 当前会话模型所在提供方的用量短语。
 *
 * @param sessionId - 抽屉里那个会话（抽屉打开时传，关闭时 undefined）
 * @param warmSessionId - 预热用的会话 id（App 当前会话）：只在从没查过时用一次
 * @returns 短语（`本月已用 96%` / `余额 ¥23.05` / `已用 $0.49`）；undefined = 还没有
 *   可显示的数字，调用方退回「余额」
 */
export function useUsageChip(sessionId: string | undefined, warmSessionId?: string): string | undefined {
  const [chip, setChip] = useState<string | undefined>(() => readCachedUsageChip())
  /** 当前"这行小字为谁而算"：换模型广播与迟到结果都要靠它对上会话。 */
  const targetRef = useRef<string | undefined>(undefined)
  /** `chip` 的同步镜像（effect 里要读最新值，但不能把 chip 放进依赖）。 */
  const chipRef = useRef<string | undefined>(chip)
  /** 预热只做一次（App 挂载后会话可能被换几次，不该每次都查一遍）。 */
  const warmedRef = useRef(false)

  const apply = useCallback((text: string | undefined): void => {
    chipRef.current = text
    setChip(text)
    writeCachedUsageChip(text)
  }, [])

  /** 查一次并落地（节流由调用方决定）。 */
  const refresh = useCallback((target: string, providerOverride?: string): void => {
    const startedAt = Date.now()
    lastFetchAt = startedAt
    warmedRef.current = true
    void measure(target, providerOverride).then(
      (measured) => {
        // 期间又换了会话/模型：这次的结果已经不指向当前那一行了，丢掉。
        if (targetRef.current !== target) return
        // 这次查询还没出发，用户就已经换了模型（例：预热在飞行中）：旧口径一律作废，
        // 否则它会把刚点出来的新数字顶回去。
        if (lastSwitchAt > startedAt) return
        // 什么都没拿到：保留旧值（宁可旧数字，也不闪成「余额」）。
        if (!measured.known) return
        // 查到了但没有可显示的数字（不支持/未配置/失败）：如实退回「余额」，
        // 不留着上一家的旧数字冒充这一家。
        apply(measured.text)
      },
    )
  }, [apply])

  // ①抽屉开了 → 量一次；抽屉关着 → 只预热一次（省得首次开抽屉先空几秒）。
  useEffect(() => {
    const warming = sessionId === undefined
    const target = sessionId !== undefined
      ? sessionId
      : (warmedRef.current ? undefined : warmSessionId)
    /*
     * 这里必须记 `target` 而不是 `sessionId`：预热时 `sessionId` 是 undefined，
     * 记成 undefined 会让预热的结果在 `refresh` 里被"这已经不是当前那一行"挡掉 ——
     * 表现就是永远停在「余额」（2026-11-14 实测踩过）。
     */
    targetRef.current = target
    if (target === undefined || target === '') return
    // 手里已经有数字才节流；一个数字都没有时必须真去问一次，不能干等下一次。
    if (!warming && chipRef.current !== undefined && Date.now() - lastFetchAt < MIN_INTERVAL_MS) return
    if (warming) {
      const timer = setTimeout(() => { refresh(target) }, WARM_DELAY_MS)
      return () => { clearTimeout(timer) }
    }
    // 抽屉刚好在换模型之后打开：这一趟也按广播那家算，免得被滞后的目录顶回旧数字。
    refresh(target, recentSwitchProvider(target))
    return undefined
  }, [sessionId, warmSessionId, refresh])

  // ②换模型 → 立刻按新提供方重算（内存里就有那家那一行），再补一次真查询。
  useEffect(() => subscribeModelSwitch((change) => {
    const target = targetRef.current
    // 抽屉开在别的会话上：这条广播跟当前这一行无关，别乱改。
    if (target !== undefined && target !== '' && target !== change.sessionId) return
    // 手里有旧用量面就瞬间换行 —— 这一步不碰网络，所以"同时"是真同时。
    if (lastView !== undefined) apply(usageChipText(pickUsageProvider(lastView, change.provider)))
    // 补一次真查询（新模型可能刚跨过限额、或这家余额刚变过）；连点时合并。
    const now = Date.now()
    if (now - lastSwitchAt < SWITCH_MIN_INTERVAL_MS) return
    lastSwitchAt = now
    refresh(change.sessionId, change.provider)
  }), [apply, refresh])

  // ③挂载时如果已经有广播历史（抽屉后打开），先按它把短语对齐一次。
  useEffect(() => {
    if (lastView === undefined) return
    const last = lastModelSwitch()
    if (last === undefined || sessionId === undefined) return
    if (last.sessionId !== sessionId) return
    apply(usageChipText(pickUsageProvider(lastView, last.provider)))
  }, [sessionId, apply])

  return chip
}

/**
 * 只给测试用：清掉模块级节流与缓存。
 *
 * 那三个变量是**跨组件实例**的（正是「换模型能瞬间生效」的前提），所以一个用例跑完
 * 会把节流窗口留给下一个用例 —— 不重置的话第二个用例压根不会发起查询。
 */
export function resetUsageChipForTests(): void {
  lastFetchAt = 0
  lastSwitchAt = 0
  lastView = undefined
}
