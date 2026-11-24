// @vitest-environment jsdom

/** Preview pane: live viewfinder, connection controls, shutter, and batch strip. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocScannerCaptureResult } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from '../src/client/batch-limit.ts'
import { DocScannerPreviewBody, type DocScannerPreviewBodyProps } from '../src/client/DocScannerPreviewBody.tsx'
import { DocScannerPreviewTitle, type DocScannerPreviewTitleProps } from '../src/client/DocScannerPreviewTitle.tsx'
import type { DocScannerPreviewFeed } from '../src/client/preview-feed.ts'
import type { DocScannerReadiness } from '../src/client/readiness.ts'
import { createSessionUiStore } from '../src/client/session-ui.ts'
import { readinessIn, selectorHook, still, translate, useTabInfo } from './fixtures.client.ts'

const SESSION = 's1' as SessionId
const FRAME_SRC = 'data:image/jpeg;base64,AAEC'
const IDLE_FEED: DocScannerPreviewFeed = { src: null, error: null, streaming: false }

afterEach(cleanup)

function mount(
  readinessState: DocScannerReadiness = readinessIn('ready'),
  feedState: DocScannerPreviewFeed = IDLE_FEED,
) {
  const readiness = createSnapshotStore<DocScannerReadiness>(readinessState)
  const feed = createSnapshotStore<DocScannerPreviewFeed>(feedState)
  const sessionUi = createSessionUiStore()
  const failures: unknown[] = []
  const actions = {
    connect: vi.fn<(signal: AbortSignal) => Promise<void>>(() => Promise.resolve()),
    capture: vi.fn<() => Promise<{ ok: true; value: DocScannerCaptureResult } | { ok: false; error: RemoteError }>>(
      () => Promise.resolve({ ok: true, value: still('a.jpg') }),
    ),
    close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    openPreview: vi.fn<(sessionId: SessionId) => void>(),
    removeCapture: vi.fn<(index: number) => void>(),
    clearBatch: vi.fn<() => void>(),
    openBatchInFiles: vi.fn<(sessionId: SessionId) => void>(),
    bindArchiveSession: vi.fn<(sessionId: SessionId) => void>(),
    run: vi.fn(async (action: () => Promise<void>) => {
      try {
        await action()
      } catch (error) {
        failures.push(error)
      }
    }),
  }
  const props = {
    ...actions,
    sessionId: SESSION,
    t: translate,
    useTabInfo,
    useDocScannerReadiness: selectorHook(readiness),
    useDocScannerPreview: selectorHook(feed),
    useDocScannerSessionUi: selectorHook(sessionUi),
  }
  // The slot renderer supplies the Session-standard hooks, which this pane never calls.
  const view = render(<DocScannerPreviewBody {...props as DocScannerPreviewBodyProps} />)
  const setCaptures = (count: number): void => {
    act(() => {
      sessionUi.set({
        ...sessionUi.getSnapshot(),
        captures: Array.from({ length: count }, (_, index) => still(`s${String(index)}.jpg`)),
      })
    })
  }
  const setUi = (patch: Partial<ReturnType<typeof sessionUi.getSnapshot>>): void => {
    act(() => { sessionUi.set({ ...sessionUi.getSnapshot(), ...patch }) })
  }
  return { readiness, feed, sessionUi, actions, failures, view, setCaptures, setUi }
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name })
}

describe('DocScannerPreviewTitle', () => {
  it('renders the localized tab title', () => {
    const props = { t: translate, sessionId: SESSION, useTabInfo }
    render(<DocScannerPreviewTitle {...props as DocScannerPreviewTitleProps} />)
    expect(screen.getByText('Document camera')).toBeTruthy()
  })
})

describe('DocScannerPreviewBody viewfinder', () => {
  it('binds the archive Session on mount', () => {
    const h = mount()
    expect(h.actions.bindArchiveSession).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('shows the live frame instead of a status line', () => {
    mount(readinessIn('ready'), { src: FRAME_SRC, error: null, streaming: true })
    expect(screen.getByAltText('Document camera live preview').getAttribute('src')).toBe(FRAME_SRC)
    expect(screen.queryByText('Starting preview…')).toBeNull()
  })

  it.each([
    ['a transport error from readiness', readinessIn('ready', { error: 'down' }), IDLE_FEED, 'down'],
    ['a preview error', readinessIn('ready'), { src: null, error: 'feed broke', streaming: false }, 'feed broke'],
    ['no device connection', readinessIn('disconnected'), IDLE_FEED, 'Connect a document camera to show the live preview'],
    ['a preview that is starting', readinessIn('ready'), { src: null, error: null, streaming: true }, 'Starting preview…'],
    ['an idle ready preview', readinessIn('ready'), IDLE_FEED, 'Waiting for preview…'],
  ] as const)('explains %s', (_label, readinessState, feedState, expected) => {
    mount(readinessState, feedState)
    expect(screen.getByText(expected, { selector: 'p' })).toBeTruthy()
  })

  it('shows the phase and the camera hint', () => {
    mount(readinessIn('capturing'))
    expect(screen.getByText('Document camera capturing…')).toBeTruthy()
    expect(screen.getByLabelText(translate('czurHint'))).toBeTruthy()
  })

  it('banners a preview error and an action failure over a live frame', () => {
    const h = mount(readinessIn('ready'), { src: FRAME_SRC, error: 'frame dropped', streaming: false })
    expect(screen.getByText('frame dropped', { selector: 'p' })).toBeTruthy()
    h.setUi({ message: 'capture failed' })
    expect(screen.getAllByText('capture failed')).toHaveLength(2)
  })

  it('does not banner a preview error when no frame is shown', () => {
    mount(readinessIn('ready'), { src: null, error: 'feed broke', streaming: false })
    expect(screen.getAllByText('feed broke')).toHaveLength(1)
  })
})

describe('DocScannerPreviewBody connection controls', () => {
  it.each([['disconnected'], [null]] as const)('hides Disconnect while %s', (phase) => {
    mount(readinessIn(phase))
    expect(screen.queryByRole('button', { name: 'Disconnect camera' })).toBeNull()
  })

  it('disconnects through the shared action runner', () => {
    const h = mount()
    fireEvent.click(button('Disconnect camera'))
    expect(h.actions.run).toHaveBeenCalledOnce()
    expect(h.actions.close).toHaveBeenCalledOnce()
  })

  it('connects, then opens the preview, when the device is not ready', async () => {
    const h = mount(readinessIn('disconnected'))
    expect(button('Connect and preview').disabled).toBe(false)
    fireEvent.click(button('Connect and preview'))
    await waitFor(() => { expect(h.actions.openPreview).toHaveBeenCalledExactlyOnceWith(SESSION) })
    expect(h.actions.connect).toHaveBeenCalledOnce()
    expect(h.actions.connect.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
  })

  it('reports a failed connect through the runner and does not open the preview', async () => {
    const h = mount(readinessIn('disconnected'))
    h.actions.connect.mockRejectedValueOnce(new Error('no device'))
    fireEvent.click(button('Connect and preview'))
    await waitFor(() => { expect(h.failures).toHaveLength(1) })
    expect(h.actions.openPreview).not.toHaveBeenCalled()
  })

  it('shows Working… and disables controls while an action runs and the device is not ready', () => {
    const h = mount(readinessIn('disconnected'))
    h.setUi({ working: true })
    expect(button('Working…').disabled).toBe(true)
  })

  it.each(['connecting', 'opening', 'capturing'] as const)('disables the shutter while %s', (phase) => {
    mount(readinessIn(phase))
    const primary = screen.getByRole<HTMLButtonElement>('button', { name: /Connect and preview|Take a photo/ })
    expect(primary.disabled).toBe(true)
  })

  it('disables Disconnect while an action runs', () => {
    const h = mount()
    h.setUi({ working: true })
    expect(button('Disconnect camera').disabled).toBe(true)
  })
})

describe('DocScannerPreviewBody shutter', () => {
  it('captures with a timeout signal when the device is ready', async () => {
    const h = mount()
    fireEvent.click(button('Take a photo'))
    await waitFor(() => { expect(h.actions.capture).toHaveBeenCalledOnce() })
    expect(h.actions.capture.mock.calls[0]).toEqual([expect.any(AbortSignal)])
    expect(h.actions.connect).not.toHaveBeenCalled()
    expect(h.failures).toEqual([])
  })

  it('surfaces a failed capture result as an action failure', async () => {
    const h = mount()
    const error = new RemoteError('doc-scanner/not-ready', 'not ready', { reason: 'closed' })
    h.actions.capture.mockResolvedValueOnce({ ok: false, error })
    fireEvent.click(button('Take a photo'))
    await waitFor(() => { expect(h.failures).toEqual([error]) })
  })

  it('is disabled with the limit message once the batch is full', () => {
    const h = mount()
    h.setCaptures(DOC_SCANNER_MAX_IMAGES_PER_MESSAGE)
    const full = button(translate('batchAtLimit', { max: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE }))
    expect(full.disabled).toBe(true)
  })
})

describe('DocScannerPreviewBody batch strip', () => {
  it('has no strip while the batch is empty', () => {
    mount()
    expect(screen.queryByText(/^Batch · /)).toBeNull()
  })

  it('counts stills and runs the Files and clear actions', () => {
    const h = mount()
    h.setCaptures(2)
    expect(screen.getByText('Batch · 2')).toBeTruthy()

    fireEvent.click(button('Show in files'))
    expect(h.actions.run).toHaveBeenCalledOnce()
    expect(h.actions.openBatchInFiles).toHaveBeenCalledExactlyOnceWith(SESSION)

    fireEvent.click(button('Clear batch'))
    expect(h.actions.clearBatch).toHaveBeenCalledOnce()
  })

  it('removes the still at the clicked index', () => {
    const h = mount()
    h.setCaptures(3)
    const removes = screen.getAllByRole('button', { name: 'Remove from batch' })
    expect(removes).toHaveLength(3)
    const second = removes[1]
    if (second === undefined) throw new Error('missing remove control')
    fireEvent.click(second)
    expect(h.actions.removeCapture).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('opens a still in the lightbox and closes it from the dialog', () => {
    const h = mount()
    h.setCaptures(1)
    fireEvent.click(button('View batch photo'))
    const dialog = screen.getByRole('dialog', { name: 'Batch photo preview' })
    expect(within(dialog).getByAltText('s0.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,AAEC')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close preview' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.actions.removeCapture).not.toHaveBeenCalled()
  })

  it('titles an unnamed still in the lightbox with the generic batch alt text', () => {
    const h = mount()
    act(() => {
      h.sessionUi.set({
        ...h.sessionUi.getSnapshot(),
        captures: [{ mimeType: 'image/png', width: 1, height: 1, dataBase64: 'AAEC' }],
      })
    })
    fireEvent.click(button('View batch photo'))
    const dialog = screen.getByRole('dialog', { name: 'Batch photo preview' })
    expect(within(dialog).getByAltText('Batch thumbnail').getAttribute('src')).toBe('data:image/png;base64,AAEC')
  })

  it('disables the strip actions while an action runs', () => {
    const h = mount()
    h.setCaptures(1)
    h.setUi({ working: true })
    expect(button('Show in files').disabled).toBe(true)
    expect(button('Clear batch').disabled).toBe(true)
    expect(button('Remove from batch').disabled).toBe(true)
  })
})
