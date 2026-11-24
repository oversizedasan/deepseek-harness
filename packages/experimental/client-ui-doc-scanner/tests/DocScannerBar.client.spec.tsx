// @vitest-environment jsdom

/** Composer status chip: opens the camera, or attaches the batch once stills exist. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DocScannerBar } from '../src/client/DocScannerBar.tsx'
import type { DocScannerReadiness } from '../src/client/readiness.ts'
import { createSessionUiStore } from '../src/client/session-ui.ts'
import { readinessIn, selectorHook, still, translate } from './fixtures.client.ts'

const SESSION = 's1' as SessionId
type Rehydrate = (sessionId: SessionId) => Promise<'restored' | 'ready' | 'pending-draft' | 'unavailable'>

function mount(initial: DocScannerReadiness = readinessIn('ready'), rehydrate?: Rehydrate) {
  const readiness = createSnapshotStore<DocScannerReadiness>(initial)
  const sessionUi = createSessionUiStore()
  const openPreview = vi.fn<(sessionId: SessionId) => void>()
  const attachBatchToDraft = vi.fn<(sessionId: SessionId) => void>()
  const rehydrateArchiveAttachments = vi.fn<Rehydrate>(rehydrate ?? (() => Promise.resolve('ready')))
  const run = vi.fn(async (action: () => Promise<void>) => { await action() })
  const view = render(
    <DocScannerBar
      sessionId={SESSION}
      t={translate}
      useDocScannerReadiness={selectorHook(readiness)}
      useDocScannerSessionUi={selectorHook(sessionUi)}
      openPreview={openPreview}
      attachBatchToDraft={attachBatchToDraft}
      rehydrateArchiveAttachments={rehydrateArchiveAttachments}
      run={run}
    />,
  )
  return { readiness, sessionUi, openPreview, attachBatchToDraft, rehydrateArchiveAttachments, run, view }
}

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DocScannerBar without a batch', () => {
  it('shows the phase and opens the preview for the current Session', () => {
    const h = mount()
    const chip = screen.getByRole<HTMLButtonElement>('button', { name: 'Open document camera' })
    expect(chip.textContent).toBe('Document camera connected')
    fireEvent.click(chip)
    expect(h.openPreview).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('shows the disconnected phase before any snapshot arrives', () => {
    mount(readinessIn(null))
    expect(screen.getByRole('button', { name: 'Open document camera' }).textContent)
      .toBe('Document camera disconnected')
  })

  it('shows a transport failure and an action failure in place of the phase', () => {
    const h = mount(readinessIn('ready', { error: 'down' }))
    expect(screen.getByRole('button').textContent).toBe(translate('transportError'))
    act(() => { h.sessionUi.set({ ...h.sessionUi.getSnapshot(), message: 'capture failed' }) })
    expect(screen.getByRole('button').textContent).toBe('capture failed')
  })

  it('is disabled while an action runs', () => {
    const h = mount()
    act(() => { h.sessionUi.set({ ...h.sessionUi.getSnapshot(), working: true }) })
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
  })
})

describe('DocScannerBar with a batch', () => {
  function withBatch(count: number, initial?: DocScannerReadiness) {
    const h = mount(initial)
    act(() => {
      h.sessionUi.set({
        ...h.sessionUi.getSnapshot(),
        captures: Array.from({ length: count }, (_, index) => still(`s${String(index)}.jpg`)),
      })
    })
    return h
  }

  it('offers the preview through the status dot and attaches through the batch label', () => {
    const h = withBatch(2)
    const dot = screen.getByRole<HTMLButtonElement>('button', { name: 'Open document camera' })
    const label = screen.getByRole<HTMLButtonElement>('button', { name: 'Attach batch · 2' })
    expect(label.textContent).toBe('Attach batch · 2')

    fireEvent.click(dot)
    expect(h.openPreview).toHaveBeenCalledExactlyOnceWith(SESSION)

    fireEvent.click(label)
    expect(h.run).toHaveBeenCalledOnce()
    expect(h.attachBatchToDraft).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('keeps the batch label over a transport failure', () => {
    withBatch(1, readinessIn('ready', { error: 'down' }))
    expect(screen.getByRole('button', { name: 'Attach batch · 1' })).toBeTruthy()
  })

  it('disables both controls while an action runs', () => {
    const h = withBatch(1)
    act(() => { h.sessionUi.set({ ...h.sessionUi.getSnapshot(), working: true }) })
    for (const button of screen.getAllByRole<HTMLButtonElement>('button')) expect(button.disabled).toBe(true)
  })
})

describe('DocScannerBar draft restore', () => {
  it('asks once and stops when the draft is already restorable', async () => {
    const h = mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('retries every 50 ms while the folder chip is not in the draft yet', async () => {
    const results: Awaited<ReturnType<Rehydrate>>[] = ['pending-draft', 'pending-draft', 'restored']
    const h = mount(readinessIn('ready'), () => Promise.resolve(results.shift() ?? 'ready'))
    await act(async () => { await vi.advanceTimersByTimeAsync(49) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledTimes(3)
  })

  it('gives up after 40 pending attempts', async () => {
    const h = mount(readinessIn('ready'), () => Promise.resolve('pending-draft'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledTimes(40)
  })

  it('stops retrying once the chip unmounts', async () => {
    const h = mount(readinessIn('ready'), () => Promise.resolve('pending-draft'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledTimes(1)
    h.view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(h.rehydrateArchiveAttachments).toHaveBeenCalledTimes(1)
  })
})
