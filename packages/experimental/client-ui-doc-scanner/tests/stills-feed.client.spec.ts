/** Stills feed: provider-pushed stills land in the tray while the device is ready or capturing. */
import { describe, expect, it, onTestFinished } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from '../src/client/batch-limit.ts'
import type { DocScannerReadiness } from '../src/client/readiness.ts'
import { createSessionUiStore } from '../src/client/session-ui.ts'
import { observeStillsFeed } from '../src/client/stills-feed.ts'
import { createRemoteContext, flush, leakyStore, readinessIn, still } from './fixtures.client.ts'

const SESSION = 's1' as SessionId

function mount(initial: DocScannerReadiness = readinessIn('ready')) {
  const { ctx, remote } = createRemoteContext()
  onTestFinished(() => ctx.fiber.dispose())
  const readiness = createSnapshotStore<DocScannerReadiness>(initial)
  const sessionUi = createSessionUiStore()
  const feed = observeStillsFeed(ctx, readiness, sessionUi)
  return { feed, readiness, sessionUi, remote }
}

function setBatch(sessionUi: ReturnType<typeof createSessionUiStore>, batchId: string): void {
  sessionUi.set({ ...sessionUi.getSnapshot(), batchId })
}

describe('observeStillsFeed', () => {
  it('opens no stream while the device is not ready', async () => {
    const { remote } = mount(readinessIn('opening'))
    await flush()
    expect(remote.streams).toHaveLength(0)
  })

  it('follows stills for the current batch and omits the session when none is bound', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    const [stream] = remote.streams
    expect(stream?.options.name).toBe('Document scanner stills')
    const batchId = sessionUi.getSnapshot().batchId
    expect(stream?.options.open(new AbortController().signal)).toBe(`stills:${batchId}:-:false`)
    const ended = stream?.options.ended(false)
    expect(ended).toBeInstanceOf(RemoteStreamCarrierError)
    expect(ended?.message).toBe('Document scanner stills stream ended')
  })

  it('scopes the stream to the bound archive session', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    sessionUi.set({ ...sessionUi.getSnapshot(), archiveSessionId: SESSION })
    await flush()
    expect(remote.streams).toHaveLength(2)
    expect(remote.streams[0]?.disposed).toBe(true)
    const batchId = sessionUi.getSnapshot().batchId
    expect(remote.streams[1]?.options.open(new AbortController().signal)).toBe(`stills:${batchId}:s1:false`)
  })

  it('appends each pushed still to the tray, clears the notice, and accepts it', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    sessionUi.set({ ...sessionUi.getSnapshot(), message: 'old failure' })
    const stream = remote.streams[0]
    stream?.push(still('a.jpg'))
    await flush()
    stream?.push(still('b.jpg'))
    await flush()
    expect(sessionUi.getSnapshot().captures.map(item => item.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(sessionUi.getSnapshot().message).toBeNull()
    expect(stream?.accepted).toBe(2)
    expect(remote.streams).toHaveLength(1)
  })

  it('accepts but drops stills once the tray is at the per-message limit', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    const full = Array.from({ length: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE }, (_, index) => still(`s${String(index)}.jpg`))
    sessionUi.set({ ...sessionUi.getSnapshot(), captures: full })
    remote.streams[0]?.push(still('overflow.jpg'))
    await flush()
    expect(sessionUi.getSnapshot().captures).toEqual(full)
    expect(remote.streams[0]?.accepted).toBe(1)
  })

  it('restarts on a new batch id and keeps the stream when other tray fields change', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    sessionUi.set({ ...sessionUi.getSnapshot(), working: true })
    await flush()
    expect(remote.streams).toHaveLength(1)

    setBatch(sessionUi, '2030-01-01_000000')
    await flush()
    expect(remote.streams).toHaveLength(2)
    expect(remote.streams[0]?.disposed).toBe(true)
    expect(remote.streams[1]?.options.open(new AbortController().signal)).toBe('stills:2030-01-01_000000:-:false')
  })

  it('opens one stream when the batch changes twice before the old stream stops', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    setBatch(sessionUi, '2030-01-01_000001')
    setBatch(sessionUi, '2030-01-01_000002')
    await flush()
    expect(remote.streams).toHaveLength(2)
  })

  it('stops when the device leaves ready', async () => {
    const { readiness, remote } = mount()
    await flush()
    readiness.set(readinessIn('error'))
    await flush()
    expect(remote.streams[0]?.disposed).toBe(true)
    readiness.set(readinessIn('capturing'))
    await flush()
    expect(remote.streams).toHaveLength(2)
  })

  it('reopens after the stream ends on its own', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    remote.streams[0]?.end()
    await flush()
    setBatch(sessionUi, '2030-01-01_000003')
    await flush()
    expect(remote.streams).toHaveLength(2)
  })

  it('shows a carrier failure as the tray notice', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    remote.streams[0]?.options.carrierFailed?.(new RemoteStreamCarrierError('socket closed'))
    expect(sessionUi.getSnapshot().message).toBe('socket closed')
  })

  it.each([
    ['an Error', new Error('stream broke'), 'stream broke'],
    ['a non-Error value', 'plain failure', 'plain failure'],
  ])('shows a terminal stream failure thrown as %s as the tray notice', async (_label, thrown, message) => {
    const { remote, sessionUi } = mount()
    await flush()
    remote.streams[0]?.fail(thrown)
    await flush()
    expect(sessionUi.getSnapshot().message).toBe(message)
  })

  it('ignores a carrier failure from a replaced stream', async () => {
    const { remote, sessionUi } = mount()
    await flush()
    setBatch(sessionUi, '2030-01-01_000004')
    await flush()
    remote.streams[0]?.options.carrierFailed?.(new RemoteStreamCarrierError('old stream'))
    expect(sessionUi.getSnapshot().message).toBeNull()
  })

  it('drops a still that arrives from a stream replaced in the same tick', async () => {
    const { readiness, remote, sessionUi } = mount()
    await flush()
    const [first] = remote.streams
    first?.push(still('stale.jpg'))
    readiness.set(readinessIn('disconnected'))
    readiness.set(readinessIn('ready'))
    await flush()
    expect(first?.accepted).toBe(1)
    expect(sessionUi.getSnapshot().captures).toEqual([])
  })

  it('does not start a replacement stream when disposed while the old one stops', async () => {
    const { feed, remote, sessionUi } = mount()
    await flush()
    setBatch(sessionUi, '2030-01-01_000005')
    await feed.dispose()
    await flush()
    expect(remote.streams).toHaveLength(1)
    expect(remote.streams[0]?.disposed).toBe(true)
  })

  it('drops a still and ignores a failure that land while disposing, and ignores later events', async () => {
    const { feed, readiness, remote, sessionUi } = mount()
    await flush()
    const [stream] = remote.streams
    stream?.push(still('late.jpg'))
    await feed.dispose()
    expect(stream?.accepted).toBe(1)
    expect(sessionUi.getSnapshot().captures).toEqual([])

    stream?.options.carrierFailed?.(new RemoteStreamCarrierError('after dispose'))
    readiness.set(readinessIn('capturing'))
    setBatch(sessionUi, '2030-01-01_000006')
    await flush()
    expect(remote.streams).toHaveLength(1)
    expect(sessionUi.getSnapshot().message).toBeNull()
  })

  it('ignores a stream failure that lands while disposing', async () => {
    const { feed, remote, sessionUi } = mount()
    await flush()
    remote.streams[0]?.fail(new Error('late failure'))
    await feed.dispose()
    expect(sessionUi.getSnapshot().message).toBeNull()
  })

  it('ignores a readiness notification delivered after disposal', async () => {
    const { ctx, remote } = createRemoteContext()
    onTestFinished(() => ctx.fiber.dispose())
    const readiness = leakyStore<DocScannerReadiness>(readinessIn('connecting'))
    const feed = observeStillsFeed(ctx, readiness, createSessionUiStore())
    await feed.dispose()
    readiness.set(readinessIn('ready'))
    readiness.notifyStale()
    await flush()
    expect(remote.streams).toHaveLength(0)
  })
})
