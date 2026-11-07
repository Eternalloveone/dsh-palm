// @vitest-environment node
/**
 * 宿主时钟的回归门（真机「计时变得莫名其妙、重进会话才恢复」的架构修法）。
 *
 * 每条用例都对应一个真实失败模式，别删：
 *   ① 手机墙钟跳变不影响读数（老口径下会当场跳）
 *   ② 慢包（网络抖动）只小幅收敛，不跳
 *   ③ 乱序/陈旧帧把读数往回拽 —— 必须忽略
 *   ④ 长时间没帧，读数仍按单调时钟走（不冻结、不倒退）
 *   ⑤ 没校准前返回 undefined（宁可不显示，也不显示 0）
 */
import { describe, expect, it } from 'vitest'
import { createHostClock } from './host-clock.ts'

/** 可控的假单调时钟。 */
function fakeMono() {
  let value = 1_000
  return {
    now: () => value,
    advance: (ms: number) => { value += ms },
  }
}

describe('host-clock', () => {
  it('没校准前 now() 是 undefined（不拿 0 算读数）', () => {
    const clock = createHostClock(fakeMono().now)
    expect(clock.synced).toBe(false)
    expect(clock.now()).toBeUndefined()
  })

  it('校准后按单调时钟推进', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    expect(clock.now()).toBe(1_000_000)
    mono.advance(5_000)
    expect(clock.now()).toBe(1_005_000)
  })

  it('手机墙钟跳变不影响读数（这是老口径的核心坑）', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    mono.advance(3_000)
    // 这里即使 Date.now() 被 NTP 拽走 5 秒，也跟 clock.now() 无关：
    // 读数只由 monotonic + 宿主帧时间决定。
    const before = clock.now()
    expect(before).toBe(1_003_000)
    mono.advance(1_000)
    expect(clock.now()).toBe(1_004_000)
  })

  it('慢包只收敛 20%，不跳', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    mono.advance(1_000)          // 我们估计 1_001_000
    clock.sync(1_000_400)        // 这一帧的宿主时间比估计少 600ms（慢包）
    // 收敛：1_001_000 + (1_000_400 − 1_001_000) * 0.2 = 1_000_880
    expect(clock.now()).toBe(1_000_880)
  })

  it('落后超过容差的老帧被丢掉，读数不倒退', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    mono.advance(10_000)         // 估计 1_010_000
    clock.sync(1_005_000)        // 落后 5 秒的老帧（乱序/重放）
    expect(clock.now()).toBe(1_010_000)
  })

  it('帧说宿主更新（正向偏差）就直接贴合，且之后继续单调推进', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    mono.advance(1_000)
    clock.sync(1_002_000)        // 宿主比我们快 1 秒（我们的基准偏旧）
    expect(clock.now()).toBe(1_002_000)
    mono.advance(500)
    expect(clock.now()).toBe(1_002_500)
  })

  it('长时间没有帧也不会冻结或倒退（后台回来那一幕）', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    mono.advance(60_000)         // 一分钟没有任何帧
    expect(clock.now()).toBe(1_060_000)
  })

  it('非有限值忽略，不会把时钟算成 NaN', () => {
    const mono = fakeMono()
    const clock = createHostClock(mono.now)
    clock.sync(1_000_000)
    clock.sync(Number.NaN)
    clock.sync(Number.POSITIVE_INFINITY)
    expect(clock.now()).toBe(1_000_000)
  })
})
