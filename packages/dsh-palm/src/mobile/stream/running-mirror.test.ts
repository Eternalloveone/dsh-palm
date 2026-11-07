/** 运行中镜像：漏帧不常挂、探针抖一下不闪、没人提的最终会被清掉。 */
import { describe, expect, it } from 'vitest'
import { MIRROR_MAX_SILENCE_MS, ROSTER_ABSENT_GRACE_MS, RunningMirror } from './running-mirror.ts'

describe('RunningMirror', () => {
  it('follows turn boundaries', () => {
    const mirror = new RunningMirror()
    mirror.observeFrame('turn/start', 's-1', 0)
    expect(mirror.snapshot()).toEqual(['s-1'])
    mirror.observeFrame('turn/end', 's-1', 1_000)
    expect(mirror.snapshot()).toEqual([])
  })

  it('adopts sessions the host reports as running', () => {
    // 页面打开前就开跑的会话：turn/start 帧早就没了，只能靠宿主集合。
    const mirror = new RunningMirror()
    mirror.observeRoster(['s-host'], 0)
    expect(mirror.snapshot()).toEqual(['s-host'])
  })

  it('does not blink a session out on one empty roster', () => {
    // 宿主花名册 30 秒 TTL：到期一瞬会返回空集合。此时绿点不能消失再回来。
    const mirror = new RunningMirror()
    mirror.observeRoster(['s-1'], 0)
    mirror.observeRoster([], 30_000)
    expect(mirror.snapshot()).toEqual(['s-1'])
  })

  it('drops a session once the host has denied it for the whole grace window', () => {
    const mirror = new RunningMirror()
    mirror.observeRoster(['s-1'], 0)
    mirror.observeRoster([], 30_000)
    mirror.observeRoster([], 30_000 + ROSTER_ABSENT_GRACE_MS)
    expect(mirror.snapshot()).toEqual([])
  })

  it('keeps a turn that started after the roster snapshot', () => {
    // 帧比花名册新：快照里没有它不代表它没在跑。
    const mirror = new RunningMirror()
    mirror.observeFrame('turn/start', 's-new', 10_000)
    mirror.observeRoster([], 5_000)
    expect(mirror.snapshot()).toEqual(['s-new'])
  })

  it('forgets a session nobody confirms for five minutes', () => {
    // 断线漏了 turn/end、探针又一直失败：不能让「进行中」永远挂着。
    const mirror = new RunningMirror()
    mirror.observeFrame('turn/start', 's-ghost', 0)
    mirror.prune(MIRROR_MAX_SILENCE_MS - 1)
    expect(mirror.snapshot()).toEqual(['s-ghost'])
    mirror.prune(MIRROR_MAX_SILENCE_MS)
    expect(mirror.snapshot()).toEqual([])
  })

  it('a fresh roster confirmation resets the silence clock', () => {
    const mirror = new RunningMirror()
    mirror.observeFrame('turn/start', 's-1', 0)
    mirror.observeRoster(['s-1'], 4 * 60_000)
    mirror.prune(5 * 60_000 + 1)
    expect(mirror.snapshot()).toEqual(['s-1'])
  })
})
