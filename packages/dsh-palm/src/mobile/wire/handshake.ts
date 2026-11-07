/**
 * **版本握手**（W4-6）：宿主说自己支持什么，客户端据此决定走哪条路。
 *
 * 验收标准只有一条：**降级不报错**。宿主是老的、握手字段缺失、能力位不认识——都不能
 * 让界面炸掉或者弹红条，只能让某些功能"不存在"。用户看到的是少了几个按钮，
 * 不是"出错了"。
 *
 * 策略：**缺省即关闭**（fail-closed）。凡是"宿主说了才算"的能力，没听到就当没有；
 * 每一处用能力位的地方都必须自带 fallback（老路径）。
 *
 * @module dsh-palm/mobile/wire/handshake
 */
import { WIRE_CAPABILITIES, WIRE_VERSION, type WireCapability } from './version.ts'

/** 宿主握手时声明的内容（缺字段是常态：老宿主什么都不发）。 */
export interface HostHandshake {
  /** 宿主实现的协议版本。 */
  readonly wireVersion?: number
  /** 宿主开启的能力位。 */
  readonly capabilities?: readonly string[]
}

/** 一个能力位为什么没开。 */
export type DegradeReason =
  /** 宿主没声明这个能力位（老宿主 / 该功能关着）。 */
  | 'unsupported'
  /** 宿主协议版本比客户端老，某些帧的语义可能不同。 */
  | 'version-mismatch'
  /** 这个能力位名字客户端不认识（宿主比客户端新）。 */
  | 'unknown-capability'

/** 降级记录：给诊断页/日志看，**不弹窗**。 */
export interface DegradedCapability {
  readonly capability: WireCapability
  readonly reason: DegradeReason
}

/** 握手结论。 */
export interface HandshakePlan {
  /** 可以用哪些能力位。 */
  readonly enabled: ReadonlySet<WireCapability>
  /** 没开的能力位及原因。 */
  readonly degraded: readonly DegradedCapability[]
  /** 宿主版本（没声明就是 `undefined`）。 */
  readonly hostVersion: number | undefined
  /** 宿主协议比客户端**新**：可能收到更多未知帧（忽略即可，但值得记一笔）。 */
  readonly hostNewer: boolean
  /** 宿主协议比客户端**老**：能力位即使开了，也要按老语义兜底。 */
  readonly hostOlder: boolean
}

const ALL_CAPABILITIES: readonly WireCapability[] = Object.values(WIRE_CAPABILITIES)

/**
 * 从握手里算出该开哪些能力、哪些降级。
 *
 * @param input - 宿主给的任意值（HTTP 头、首帧、URL 参数解析出来的都行）
 * @param clientVersion - 客户端自己的协议版本；默认取 `WIRE_VERSION`，测试里可以传
 *   一个更大的值来覆盖"宿主比我们老"这条路径（否则 `WIRE_VERSION = 1` 时永远走不到）
 */
export function planHandshake(input: unknown, clientVersion: number = WIRE_VERSION): HandshakePlan {
  const source = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const rawVersion = source.wireVersion
  const hostVersion = typeof rawVersion === 'number' && Number.isFinite(rawVersion) && rawVersion > 0
    ? rawVersion
    : undefined
  const declared = Array.isArray(source.capabilities)
    ? source.capabilities.filter((item): item is string => typeof item === 'string')
    : []
  const declaredSet = new Set(declared)

  const enabled = new Set<WireCapability>()
  const degraded: DegradedCapability[] = []

  for (const capability of ALL_CAPABILITIES) {
    if (!declaredSet.has(capability)) {
      // 没声明就是没有。注意这里**不区分**"老宿主"和"该功能关着"：对客户端来说
      // 两者要做的事情一样（走 fallback），区别只在日志里说得清说不清。
      degraded.push({ capability, reason: 'unsupported' })
      continue
    }
    enabled.add(capability)
  }

  const hostOlder = hostVersion !== undefined && hostVersion < clientVersion
  const hostNewer = hostVersion !== undefined && hostVersion > clientVersion

  // 宿主协议更老：即使它声明了能力位，帧的语义也可能不同，按"开了但按老语义兜底"
  // 处理——所以额外记一条 version-mismatch，让诊断页能解释"为什么这个功能表现不一样"。
  if (hostOlder) {
    for (const capability of enabled) degraded.push({ capability, reason: 'version-mismatch' })
  }

  // 宿主声明了客户端不认识的能力位：宿主比客户端新，不是错误。
  for (const capability of declaredSet) {
    if (!(ALL_CAPABILITIES as readonly string[]).includes(capability)) {
      // 认不出来的名字没法放进 WireCapability 集合，只能记在降级说明里。
      degraded.push({ capability: capability as WireCapability, reason: 'unknown-capability' })
    }
  }

  return { enabled, degraded, hostVersion, hostNewer, hostOlder }
}

/** 这个能力位能不能用（`planHandshake` 结论的便捷读法）。 */
export function hasCapability(plan: HandshakePlan, capability: WireCapability): boolean {
  return plan.enabled.has(capability)
}
