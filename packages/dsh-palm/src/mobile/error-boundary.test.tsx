// @vitest-environment jsdom
/**
 * error-boundary.tsx — the render-crash guard.
 *
 * The whole point: a component that throws during render must surface a
 * readable error page instead of a blank document, and 重试 must remount the
 * subtree (no page reload) so the app can recover if the throw was transient.
 * A render throw must ALSO reach the existing always-on error ring via
 * componentDidCatch, so the reporter and manual paths see it like any other
 * failure.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './error-boundary.tsx'
import { errorClear, errorSnapshot } from './errors.ts'

/** A child that intentionally throws while rendering until told otherwise. */
function Bomb({ armed }: { armed: () => boolean }): JSX.Element {
  if (armed()) throw new Error('render boom')
  return <div data-testid="recovered">alive</div>
}

/** A throw site that records its message so we can assert the reason text. */
function Thrower(): JSX.Element {
  throw new Error('layout blew up')
}

beforeEach(() => {
  errorClear()
})

afterEach(() => {
  cleanup()
})

describe('ErrorBoundary', () => {
  it('renders the error page, not a blank screen, when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb armed={() => true} />
      </ErrorBoundary>,
    )
    // The readable error page is present — never the empty document.
    expect(screen.getByText('页面出错了')).toBeTruthy()
    expect(screen.getByText('render boom')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
    // The crashed subtree is not rendered.
    expect(screen.queryByTestId('recovered')).toBeNull()
  })

  it('hands the render failure to the always-on error ring', () => {
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    )
    const [record] = errorSnapshot()
    expect(record?.kind).toBe('error')
    expect(record?.message).toContain('layout blew up')
  })

  it('重试 remounts the subtree without a page reload and recovery renders', () => {
    let armed = true
    render(
      <ErrorBoundary>
        <Bomb armed={() => armed} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('页面出错了')).toBeTruthy()
    expect(screen.queryByTestId('recovered')).toBeNull()
    // The throw becomes transient; 重试 clears the boundary state and
    // re-renders the child, which now survives.
    armed = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByTestId('recovered')).toBeTruthy()
    expect(screen.queryByText('页面出错了')).toBeNull()
  })

  it('truncates an excessive reason to a single readable line', () => {
    function LongBomb({ boom }: { boom: boolean }): JSX.Element {
      if (boom) throw new Error('x'.repeat(2000))
      return <div>ok</div>
    }
    render(
      <ErrorBoundary>
        <LongBomb boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('页面出错了')).toBeTruthy()
    const reasonLine = Array.from(document.querySelectorAll('.errorpage-reason'))
    expect(reasonLine.length).toBe(1)
    const text = reasonLine[0]?.textContent ?? ''
    expect(text.length).toBeLessThanOrEqual(240)
  })
})
