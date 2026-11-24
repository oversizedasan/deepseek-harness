/** Preview feed: viewfinder frames stream only while the device is ready or capturing. */
import { describe, expect, it, onTestFinished } from 'vitest'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { observePreviewFeed } from '../src/client/preview-feed.ts'
import type { DocScannerReadiness } from '../src/client/readiness.ts'
import { createRemoteContext, flush, leakyStore, readinessIn } from './fixtures.client.ts'

const FRAME = { mimeType: 'image/jpeg' as const, width: 2, height: 2, dataBase64: 'AAEC' }
const FRAME_SRC = 'data:image/jpeg;base64,AAEC'
const IDLE = { src: null, error: null, streaming: false }

function mount(initial: DocScannerReadiness = readinessIn(null)) {
  const { ctx, remote } = createRemoteContext()
  onTestFinished(() => ctx.fiber.dispose())
  const readiness = createSnapshotStore<DocScannerReadiness>(initial)
  const feed = observePreviewFeed(ctx, readiness)
  return { feed, readiness, remote }
}

describe('observePreviewFeed', () => {
  it('stays idle and opens no stream while the device is not previewable', async () => {
    const { feed, remote } = mount(readinessIn('connecting'))
    await flush()
    expect(remote.streams).toHaveLength(0)
    expect(feed.state.getSnapshot()).toEqual(IDLE)
  })

  it('streams frames as data URLs while ready and accepts each one', async () => {
    const { feed, remote } = mount(readinessIn('ready'))
    expect(feed.state.getSnapshot()).toEqual({ src: null, error: null, streaming: true })
    const [stream] = remote.streams
    expect(stream?.options.name).toBe('Document scanner preview')
    expect(stream?.options.open(new AbortController().signal)).toBe('preview:false')

    stream?.push(FRAME)
    await flush()
    expect(feed.state.getSnapshot()).toEqual({ src: FRAME_SRC, error: null, streaming: true })
    stream?.push({ ...FRAME, mimeType: 'image/png' })
    await flush()
    expect(feed.state.getSnapshot().src).toBe('data:image/png;base64,AAEC')
    expect(stream?.accepted).toBe(2)
  })

  it('keeps one stream across ready and capturing', async () => {
    const { readiness, remote } = mount(readinessIn('ready'))
    readiness.set(readinessIn('capturing'))
    readiness.set(readinessIn('ready'))
    await flush()
    expect(remote.streams).toHaveLength(1)
  })

  it('stops the stream and clears the frame when the device leaves ready', async () => {
    const { feed, readiness, remote } = mount(readinessIn('ready'))
    remote.streams[0]?.push(FRAME)
    await flush()
    readiness.set(readinessIn('disconnected'))
    await flush()
    expect(remote.streams[0]?.disposed).toBe(true)
    expect(feed.state.getSnapshot()).toEqual(IDLE)
  })

  it('reopens a stream after the previous one ends on its own', async () => {
    const { feed, readiness, remote } = mount(readinessIn('ready'))
    remote.streams[0]?.push(FRAME)
    remote.streams[0]?.end()
    await flush()
    expect(feed.state.getSnapshot()).toEqual({ src: FRAME_SRC, error: null, streaming: false })

    readiness.set(readinessIn('capturing'))
    await flush()
    expect(remote.streams).toHaveLength(2)
    expect(feed.state.getSnapshot()).toEqual({ src: FRAME_SRC, error: null, streaming: true })
  })

  it('classifies a normal end as a carrier loss and reports a carrier failure without dropping the frame', async () => {
    const { feed, remote } = mount(readinessIn('ready'))
    const stream = remote.streams[0]
    stream?.push(FRAME)
    await flush()
    const ended = stream?.options.ended(true)
    expect(ended).toBeInstanceOf(RemoteStreamCarrierError)
    expect(ended?.message).toBe('Document scanner preview stream ended')

    stream?.options.carrierFailed?.(new RemoteStreamCarrierError('socket closed'))
    expect(feed.state.getSnapshot()).toEqual({ src: FRAME_SRC, error: 'socket closed', streaming: false })
    stream?.push(FRAME)
    await flush()
    expect(feed.state.getSnapshot()).toEqual({ src: FRAME_SRC, error: null, streaming: true })
  })

  it.each([
    ['an Error', new Error('stream broke'), 'stream broke'],
    ['a non-Error value', 'plain failure', 'plain failure'],
  ])('reports a terminal stream failure thrown as %s', async (_label, thrown, message) => {
    const { feed, remote } = mount(readinessIn('ready'))
    remote.streams[0]?.push(FRAME)
    await flush()
    remote.streams[0]?.fail(thrown)
    await flush()
    expect(feed.state.getSnapshot()).toEqual({ src: FRAME_SRC, error: message, streaming: false })
  })

  it('ignores a carrier failure from a replaced stream', async () => {
    const { feed, readiness, remote } = mount(readinessIn('ready'))
    readiness.set(readinessIn('disconnected'))
    await flush()
    readiness.set(readinessIn('ready'))
    await flush()
    expect(remote.streams).toHaveLength(2)
    remote.streams[0]?.options.carrierFailed?.(new RemoteStreamCarrierError('old stream'))
    expect(feed.state.getSnapshot().error).toBeNull()
  })

  it('drops a frame that arrives from a stream replaced in the same tick', async () => {
    const { feed, readiness, remote } = mount(readinessIn('ready'))
    const [first] = remote.streams
    first?.push(FRAME)
    readiness.set(readinessIn('disconnected'))
    readiness.set(readinessIn('ready'))
    await flush()
    expect(remote.streams).toHaveLength(2)
    expect(first?.accepted).toBe(1)
    expect(feed.state.getSnapshot().src).toBeNull()
  })

  it('drops a frame that lands while disposing and ignores later events', async () => {
    const { feed, readiness, remote } = mount(readinessIn('ready'))
    const [stream] = remote.streams
    stream?.push(FRAME)
    await feed.dispose()
    expect(stream?.disposed).toBe(true)
    expect(stream?.accepted).toBe(1)
    expect(feed.state.getSnapshot().src).toBeNull()

    stream?.options.carrierFailed?.(new RemoteStreamCarrierError('after dispose'))
    readiness.set(readinessIn('capturing'))
    await flush()
    expect(remote.streams).toHaveLength(1)
    expect(feed.state.getSnapshot().error).toBeNull()
  })

  it('ignores a stream failure that lands while disposing', async () => {
    const { feed, remote } = mount(readinessIn('ready'))
    remote.streams[0]?.fail(new Error('late failure'))
    await feed.dispose()
    expect(feed.state.getSnapshot().error).toBeNull()
  })

  it('does not reset the state after disposal when the device leaves ready mid-stop', async () => {
    const { feed, readiness, remote } = mount(readinessIn('ready'))
    remote.streams[0]?.push(FRAME)
    await flush()
    readiness.set(readinessIn('error'))
    await feed.dispose()
    expect(feed.state.getSnapshot().src).toBe(FRAME_SRC)
  })

  it('ignores a readiness notification delivered after disposal', async () => {
    const { ctx, remote } = createRemoteContext()
    onTestFinished(() => ctx.fiber.dispose())
    const readiness = leakyStore<DocScannerReadiness>(readinessIn('connecting'))
    const feed = observePreviewFeed(ctx, readiness)
    await feed.dispose()
    readiness.set(readinessIn('ready'))
    readiness.notifyStale()
    await flush()
    expect(remote.streams).toHaveLength(0)
    expect(feed.state.getSnapshot()).toEqual(IDLE)
  })

  it('disposes cleanly when no stream is active', async () => {
    const { feed, remote } = mount()
    await feed.dispose()
    expect(remote.streams).toHaveLength(0)
  })
})
