// @vitest-environment jsdom

/** Preview pane: live viewfinder, connection controls, shutter, and batch strip. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocScannerCaptureResult } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from '../src/client/batch-limit.ts'
import { DocScannerPreviewBody, stepLightboxIndex, type DocScannerPreviewBodyProps } from '../src/client/DocScannerPreviewBody.tsx'
import { DocScannerPreviewTitle, type DocScannerPreviewTitleProps } from '../src/client/DocScannerPreviewTitle.tsx'
import type { DocScannerPreviewFeed } from '../src/client/preview-feed.ts'
import type { DocScannerReadiness } from '../src/client/readiness.ts'
import { createSessionUiStore } from '../src/client/session-ui.ts'
import { readinessIn, selectorHook, still, translate, useTabInfo } from './fixtures.client.ts'

const SESSION = 's1' as SessionId
const FRAME_SRC = 'data:image/jpeg;base64,AAEC'
const IDLE_FEED: DocScannerPreviewFeed = {
  src: null,
  error: null,
  streaming: false,
  rects: [],
  frameWidth: 0,
  frameHeight: 0,
}

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
    setCaptureProfile: vi.fn<(profile: unknown) => Promise<void>>(() => Promise.resolve()),
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
    mount(readinessIn('ready'), { ...IDLE_FEED, src: FRAME_SRC, streaming: true, frameWidth: 2, frameHeight: 2 })
    expect(screen.getByAltText('Document camera live preview').getAttribute('src')).toBe(FRAME_SRC)
    expect(screen.queryByText('Starting preview…')).toBeNull()
  })

  it.each([
    ['a transport error from readiness', readinessIn('ready', { error: 'down' }), IDLE_FEED, 'down'],
    ['a preview error', readinessIn('ready'), { ...IDLE_FEED, error: 'feed broke' }, 'feed broke'],
    ['no device connection', readinessIn('disconnected'), IDLE_FEED, 'Connect a document camera to show the live preview'],
    ['a preview that is starting', readinessIn('ready'), { ...IDLE_FEED, streaming: true }, 'Starting preview…'],
    ['an idle ready preview', readinessIn('ready'), IDLE_FEED, 'Waiting for preview…'],
  ] as const)('explains %s', (_label, readinessState, feedState, expected) => {
    mount(readinessState, feedState)
    expect(screen.getByText(expected, { selector: 'p' })).toBeTruthy()
  })

  it('draws the recognition pill only when the latest frame has boxes', () => {
    const { feed } = mount(readinessIn('ready'), {
      ...IDLE_FEED,
      src: FRAME_SRC,
      streaming: true,
      frameWidth: 200,
      frameHeight: 100,
    })
    expect(screen.queryByText('Recognized')).toBeNull()
    act(() => {
      feed.set({
        ...IDLE_FEED,
        src: FRAME_SRC,
        streaming: true,
        frameWidth: 200,
        frameHeight: 100,
        rects: [{ x: 10, y: 20, width: 30, height: 40 }],
      })
    })
    expect(screen.getByText('Recognized')).toBeTruthy()
  })

  it('draws a rectangle without corners and a polyline when four corners are present', () => {
    vi.spyOn(HTMLImageElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLImageElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    try {
      const h = mount(readinessIn('ready'), {
        ...IDLE_FEED,
        src: FRAME_SRC,
        streaming: true,
        frameWidth: 200,
        frameHeight: 100,
        rects: [{ x: 10, y: 20, width: 30, height: 40 }],
      })
      expect(screen.queryByLabelText('Page treatment')).toBeNull()
      expect(screen.queryByLabelText('Color mode')).toBeNull()
      const box = screen.getByTestId('detect-box')
      expect(box.style.left).toBe('10px')
      expect(box.style.top).toBe('20px')
      expect(box.style.width).toBe('30px')
      expect(screen.queryByTestId('detect-polygon')).toBeNull()
      act(() => {
        h.feed.set({
          ...IDLE_FEED,
          src: FRAME_SRC,
          streaming: true,
          frameWidth: 200,
          frameHeight: 100,
          rects: [{
            x: 10,
            y: 20,
            width: 30,
            height: 40,
            corners: {
              leftTop: { x: 10, y: 20 },
              rightTop: { x: 40, y: 20 },
              rightDown: { x: 40, y: 60 },
              leftDown: { x: 10, y: 60 },
            },
          }],
        })
      })
      expect(screen.queryByTestId('detect-box')).toBeNull()
      expect(screen.getByTestId('detect-polygon').querySelector('polygon')?.getAttribute('points')).toBe('10,20 40,20 40,60 10,60')
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('shows the phase and the camera hint', () => {
    mount(readinessIn('capturing'))
    expect(screen.getByText('Document camera capturing…')).toBeTruthy()
    expect(screen.getByLabelText(translate('czurHint'))).toBeTruthy()
  })

  it('banners a preview error and an action failure over a live frame', () => {
    const h = mount(readinessIn('ready'), { ...IDLE_FEED, src: FRAME_SRC, error: 'frame dropped' })
    expect(screen.getByText('frame dropped', { selector: 'p' })).toBeTruthy()
    h.setUi({ message: 'capture failed' })
    expect(screen.getAllByText('capture failed')).toHaveLength(2)
  })

  it('does not banner a preview error when no frame is shown', () => {
    mount(readinessIn('ready'), { ...IDLE_FEED, error: 'feed broke' })
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

  it('switches the open still and wraps at either end of the batch', () => {
    const h = mount()
    act(() => {
      h.sessionUi.set({
        ...h.sessionUi.getSnapshot(),
        captures: [
          { ...still('one.jpg'), dataBase64: 'ONE' },
          { ...still('two.jpg'), dataBase64: 'TWO' },
          { ...still('three.jpg'), dataBase64: 'THREE' },
        ],
      })
    })
    const open = screen.getAllByRole('button', { name: 'View batch photo' })
    const second = open[1]
    if (second === undefined) throw new Error('missing thumbnail')
    fireEvent.click(second)
    const dialog = screen.getByRole('dialog', { name: 'Batch photo preview' })
    expect(within(dialog).getByAltText('two.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,TWO')
    expect(within(dialog).getByText('2 / 3')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next photo' }))
    expect(within(dialog).getByAltText('three.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,THREE')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(within(dialog).getByAltText('one.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,ONE')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous photo' }))
    expect(within(dialog).getByAltText('three.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,THREE')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(within(dialog).getByAltText('two.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,TWO')
  })

  it('hides switching controls for a single still and closes when the batch becomes empty', () => {
    const h = mount()
    h.setCaptures(1)
    fireEvent.click(button('View batch photo'))
    const dialog = screen.getByRole('dialog', { name: 'Batch photo preview' })
    expect(within(dialog).queryByRole('button', { name: 'Next photo' })).toBeNull()
    h.setCaptures(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the last remaining still when earlier ones leave while the lightbox is open', () => {
    const h = mount()
    act(() => {
      h.sessionUi.set({
        ...h.sessionUi.getSnapshot(),
        captures: [
          { ...still('one.jpg'), dataBase64: 'ONE' },
          { ...still('two.jpg'), dataBase64: 'TWO' },
        ],
      })
    })
    const open = screen.getAllByRole('button', { name: 'View batch photo' })
    const second = open[1]
    if (second === undefined) throw new Error('missing thumbnail')
    fireEvent.click(second)
    act(() => {
      h.sessionUi.set({
        ...h.sessionUi.getSnapshot(),
        captures: [{ ...still('one.jpg'), dataBase64: 'ONE' }],
      })
    })
    const dialog = screen.getByRole('dialog', { name: 'Batch photo preview' })
    expect(within(dialog).getByAltText('one.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,ONE')
    expect(within(dialog).queryByRole('button', { name: 'Next photo' })).toBeNull()
  })

  it('steps a closed or empty lightbox without moving', () => {
    expect(stepLightboxIndex(null, 3, 1)).toBeNull()
    expect(stepLightboxIndex(1, 0, 1)).toBeNull()
    expect(stepLightboxIndex(0, 2, -1)).toBe(1)
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
