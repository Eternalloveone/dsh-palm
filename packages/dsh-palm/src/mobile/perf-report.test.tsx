// @vitest-environment jsdom
/**
 * The 上报性能数据 row: it exists only while the instrumentation is armed,
 * reports the aggregate (摘要) or the raw ring (原始), warns before sending a
 * capture that holds no marks, and — because a capture lives in the page's memory
 * alone — falls back to the clipboard when the host write fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ reportPerf: vi.fn() }))
vi.mock('./api.ts', () => ({ reportPerf: api.reportPerf }))
const perf = vi.hoisted(() => ({ enabled: true }))
vi.mock('./perf.ts', () => ({ perfEnabled: () => perf.enabled }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock('./toast.tsx', () => ({ toast: toastMock }))

import { PerfReportRow } from './perf-report.tsx'

const aggregate = {
  marks: 118,
  anomalies: [],
  frames: { sampled: 900, long: 2 },
  spans: { toState: { p50: 1.2 }, toCommit: { p50: 4.5 } },
}
const raw = {
  marks: 2048,
  stamps: [{ t: 1, stage: 'recv' }, { t: 2, stage: 'commit' }],
  frames: { sampled: 900, long: 2 },
}

/** Point the row at a hook that answers with these two captures. */
function armHook(stats: unknown = aggregate, toJSON: unknown = raw): void {
  ;(window as unknown as { __dshPalmPerf?: unknown }).__dshPalmPerf = { stats: () => stats, toJSON: () => toJSON }
}

describe('perf report row', () => {
  beforeEach(() => {
    perf.enabled = true
    api.reportPerf.mockReset()
    toastMock.mockReset()
    armHook()
    vi.spyOn(window, 'prompt').mockReturnValue('android-lan')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing while the instrumentation is off', () => {
    perf.enabled = false
    const { container } = render(<PerfReportRow />)
    expect(container.firstChild).toBeNull()
  })

  it('shows how much has been collected', () => {
    render(<PerfReportRow />)
    expect(screen.getByText(/已采集 118 标记 · 900 帧/)).toBeTruthy()
  })

  it('reports the aggregate to the host under the environment label', async () => {
    api.reportPerf.mockResolvedValue({ file: 'capture-x-android-lan-aggregate.json', bytes: 512 })
    render(<PerfReportRow />)

    fireEvent.click(screen.getByRole('button', { name: '上报摘要' }))

    await waitFor(() => expect(api.reportPerf).toHaveBeenCalledWith(aggregate, 'android-lan'))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('capture-x-android-lan-aggregate.json')))
    // The clipboard stays untouched when the host accepted the capture.
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('hands over the raw ring when 原始 is pressed', async () => {
    api.reportPerf.mockResolvedValue({ file: 'capture-x-android-lan-raw.json', bytes: 4096 })
    render(<PerfReportRow />)

    fireEvent.click(screen.getByRole('button', { name: '上报原始' }))

    await waitFor(() => expect(api.reportPerf).toHaveBeenCalledWith(raw, 'android-lan'))
    expect(window.prompt).toHaveBeenCalled()
  })

  it('asks first when the capture holds no marks, and obeys a refusal', async () => {
    armHook({ ...aggregate, marks: 0 })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PerfReportRow />)

    fireEvent.click(screen.getByRole('button', { name: '上报摘要' }))

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('先跑一轮')))
    expect(window.confirm).toHaveBeenCalled()
    expect(api.reportPerf).not.toHaveBeenCalled()
  })

  it('still sends a no-mark capture when the user insists (frame stats matter)', async () => {
    armHook({ ...aggregate, marks: 0 })
    api.reportPerf.mockResolvedValue({ file: 'capture-frames-only-aggregate.json', bytes: 120 })
    render(<PerfReportRow />)

    fireEvent.click(screen.getByRole('button', { name: '上报摘要' }))

    await waitFor(() => expect(api.reportPerf).toHaveBeenCalledTimes(1))
  })

  it('falls back to the clipboard when the host write fails', async () => {
    api.reportPerf.mockRejectedValue(new Error('tunnel down'))
    render(<PerfReportRow />)

    fireEvent.click(screen.getByRole('button', { name: '上报摘要' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(aggregate)))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('剪贴板')))
  })
})
