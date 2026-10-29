/**
 * 「宿主这一刻认为谁在跑」这份基线的合并规则。
 *
 * 两条教训叠在一起：
 *
 * ① 上游会话表的 `running` 字段不可信 —— 实测 40 个会话全 false，连本机正在跑的那一轮
 *    也是 false。所以它能提供的只是「额外证据」，**不能当全集**。
 * ② 早先的写法是「先 clear() 再用基线填」。既然基线恒空，这一次 clear 就等于把帧
 *    （`session/status`、`turn/start`）攒出来的运行集合整批抹掉；而被抹掉的正是
 *    「豁免三分钟静默」的那批会话 —— 手机于是把还在跑的长回合写成「已中断」，桌面还在跑。
 *
 * 因此：基线只做**并集**，删除永远由帧（turn/end、status=false）负责；另外给每一条
 * 运行记录记一个「最后一次有证据的时刻」，超过 {@link RUNNING_EVIDENCE_MAX_MS} 又不在
 * 基线里的条目才清掉，避免一次漏掉的 turn/end 让绿点挂到天荒地老。
 *
 * @module dsh-palm/running-baseline
 */

/** 没有任何证据的运行记录最多活多久（帧与基线都没有提到它）。 */
export const RUNNING_EVIDENCE_MAX_MS = 5 * 60_000

/**
 * 基线并集：把宿主枚举到的会话并进当前集合，**不删除**任何已有条目。
 *
 * @param current - 当前由帧攒出来的运行集合
 * @param ids - 宿主枚举「此刻在跑」的会话
 * @returns 合并后的会话列表（去重，保持 current 的顺序在前）
 */
export function mergeRunningBaseline(current: ReadonlySet<string>, ids: Iterable<string>): string[] {
  const merged = [...current]
  for (const id of ids) {
    if (id === '') continue
    if (!current.has(id)) merged.push(id)
  }
  return merged
}

/**
 * 该清掉哪些「没有任何证据」的运行记录。
 *
 * @param evidence - sessionId -> 最后一次有证据的时刻（毫秒）
 * @param keep - 宿主基线里出现过的会话（说明宿主还认它，不能按静默清）
 * @param now - 当前时刻
 * @param maxSilence - 静默上限，默认 {@link RUNNING_EVIDENCE_MAX_MS}
 * @returns 需要从运行集合里删掉的会话
 */
export function staleRunningEvidence(
  evidence: ReadonlyMap<string, number>,
  keep: ReadonlySet<string>,
  now: number,
  maxSilence: number = RUNNING_EVIDENCE_MAX_MS,
): string[] {
  const stale: string[] = []
  for (const [sessionId, at] of evidence) {
    if (keep.has(sessionId)) continue
    if (!Number.isFinite(at)) continue
    if (now - at >= maxSilence) stale.push(sessionId)
  }
  return stale
}
