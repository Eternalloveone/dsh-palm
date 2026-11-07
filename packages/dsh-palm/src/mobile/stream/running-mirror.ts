/**
 * 「正在运行」镜像：手机端那张绿点/角标背后的事实来源。
 *
 * 两条证据会打架，这里负责裁定：
 *
 * - **mux 帧**（turn/start、turn/end）是实时的，但断线期间漏掉的 turn/end 永远不会
 *   重放 —— 只靠帧攒集合，会话会一直挂着「进行中」。
 * - **宿主的运行集合**（`mobile.runningSessions`）是权威的，但它背后是一份 30 秒 TTL
 *   的花名册：TTL 到期的那一瞬、或者宿主刚重启还没填满时，它可能**短暂返回空/不全**。
 *   直接拿它覆盖镜像，绿点会闪一下又回来——用户看到的是「它自己跳了」。
 *
 * 所以这里的三条口径是：
 * ① 宿主说「在跑」→ 立刻加，并记账；
 * ② 宿主这次**没提到**某个会话 → 不立刻删，先记「从这一刻起没人提到它」，
 *   连续缺席满 {@link ROSTER_ABSENT_GRACE_MS}（两轮探针）才删；
 * ③ 谁都提不到的会话（断线漏帧 + 探针也读不到）最多挂 {@link MIRROR_MAX_SILENCE_MS}
 *   就被清掉，避免「永远在运行」。
 *
 * turn/end 帧例外：它是明确的终态，一到就删，不给宽限。
 *
 * @module dsh-palm/mobile/running-mirror
 */

/** 宿主集合里缺席多久才认「真结束了」（30 秒一轮探针 ⇒ 两轮）。 */
export const ROSTER_ABSENT_GRACE_MS = 65_000

/** 没有任何证据（帧与探针都没有）时，「运行中」最多挂多久。 */
export const MIRROR_MAX_SILENCE_MS = 5 * 60_000

interface Tracked {
  /** 最后一次「有证据说它在跑」的时刻（帧或探针）。 */
  lastEvidenceAt: number
  /** 探针从哪一刻开始不再提到它（undefined = 上一次探针还提到）。 */
  absentSince: number | undefined
}

/** 运行中镜像：喂帧、喂宿主集合，取当前集合。 */
export class RunningMirror {
  private readonly tracked = new Map<string, Tracked>()

  /** 一条 turn 边界帧。turn/end 是明确终态，立即生效。 */
  observeFrame(eventType: string | undefined, sessionId: string, at: number): void {
    if (eventType === 'turn/start') {
      this.tracked.set(sessionId, { lastEvidenceAt: at, absentSince: undefined })
      return
    }
    if (eventType === 'turn/end') this.tracked.delete(sessionId)
  }

  /**
   * 宿主探针结果。
   *
   * @param sessionIds - 宿主此刻认为在运行的会话
   * @param at - 这次探针的时间点（用它比较缺席时长，测试可注入）
   */
  observeRoster(sessionIds: Iterable<string>, at: number): void {
    const host = new Set(sessionIds)
    for (const sessionId of host) {
      this.tracked.set(sessionId, { lastEvidenceAt: at, absentSince: undefined })
    }
    for (const [sessionId, entry] of [...this.tracked]) {
      if (host.has(sessionId)) continue
      // 探针快照之后才开始的 turn：帧比这份花名册新，不能拿旧花名册否认它。
      if (entry.lastEvidenceAt > at) continue
      const absentSince = entry.absentSince ?? at
      if (at - absentSince >= ROSTER_ABSENT_GRACE_MS) {
        this.tracked.delete(sessionId)
        continue
      }
      this.tracked.set(sessionId, { lastEvidenceAt: entry.lastEvidenceAt, absentSince })
    }
  }

  /** 清掉太久没有任何证据的条目（探针失败、断线漏帧时的兜底）。 */
  prune(at: number): void {
    for (const [sessionId, entry] of [...this.tracked]) {
      if (at - entry.lastEvidenceAt >= MIRROR_MAX_SILENCE_MS) this.tracked.delete(sessionId)
    }
  }

  /** 当前认为在运行的会话（插入顺序稳定，方便界面/测试断言）。 */
  snapshot(): string[] {
    return [...this.tracked.keys()]
  }

  /**
   * 某个会话「最后一次有证据」距今多久（毫秒）；没跟踪过返回 undefined。
   *
   * 花名册页拿它决定要不要向宿主逐条复核：刚看到 turn/start 的会话不必再问，
   * 只剩「很久没人提」的那些才值得花一次往返。
   */
  evidenceAge(sessionId: string, at: number): number | undefined {
    const entry = this.tracked.get(sessionId)
    return entry === undefined ? undefined : at - entry.lastEvidenceAt
  }

  /** 立刻忘掉一个会话：宿主逐条复核判定它其实早就没在跑了。 */
  forget(sessionId: string): void {
    this.tracked.delete(sessionId)
  }

  has(sessionId: string): boolean {
    return this.tracked.has(sessionId)
  }
}
