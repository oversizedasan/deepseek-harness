/** Readiness mirror: scanner snapshots, transport failures, and disposal. */
import { describe, expect, it, onTestFinished } from 'vitest'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { observeReadiness } from '../src/client/readiness.ts'
import { createRemoteContext, flush, snapshotIn } from './fixtures.client.ts'

function mount() {
  const { ctx, remote } = createRemoteContext()
  onTestFinished(() => ctx.fiber.dispose())
  const observer = observeReadiness(ctx)
  const [stream] = remote.streams
  if (stream === undefined) throw new Error('readiness stream was not opened')
  return { observer, stream, remote }
}

describe('observeReadiness', () => {
  it('starts disconnected with no snapshot', () => {
    expect(mount().observer.state.getSnapshot()).toEqual({ snapshot: null, connected: false, error: null })
  })

  it('opens the follow stream and classifies its normal end as a carrier loss', () => {
    const { stream } = mount()
    expect(stream.options.name).toBe('Document scanner readiness')
    expect(stream.options.open(new AbortController().signal)).toBe('follow:false')
    const ended = stream.options.ended(true)
    expect(ended).toBeInstanceOf(RemoteStreamCarrierError)
    expect(ended.message).toBe('Document scanner readiness stream ended')
  })

  it('mirrors each snapshot as connected and accepts it', async () => {
    const { observer, stream } = mount()
    stream.push(snapshotIn('connecting'))
    await flush()
    stream.push(snapshotIn('ready'))
    await flush()
    expect(observer.state.getSnapshot()).toEqual({ snapshot: snapshotIn('ready'), connected: true, error: null })
    expect(stream.accepted).toBe(2)
  })

  it('reports a carrier loss, keeps the last snapshot, and clears the error on the next snapshot', async () => {
    const { observer, stream } = mount()
    stream.push(snapshotIn('ready'))
    await flush()
    stream.options.carrierFailed?.(new RemoteStreamCarrierError('socket closed'))
    expect(observer.state.getSnapshot()).toEqual({
      snapshot: snapshotIn('ready'),
      connected: false,
      error: 'socket closed',
    })
    stream.push(snapshotIn('opening'))
    await flush()
    expect(observer.state.getSnapshot()).toEqual({ snapshot: snapshotIn('opening'), connected: true, error: null })
  })

  it.each([
    ['an Error', new Error('stream broke'), 'stream broke'],
    ['a non-Error value', 'plain failure', 'plain failure'],
  ])('reports a terminal stream failure thrown as %s', async (_label, thrown, message) => {
    const { observer, stream } = mount()
    stream.fail(thrown)
    await flush()
    expect(observer.state.getSnapshot()).toMatchObject({ connected: false, error: message })
  })

  it('disposes the stream and ignores a failure that lands while disposing', async () => {
    const { observer, stream } = mount()
    stream.fail(new Error('late failure'))
    await observer.dispose()
    expect(stream.disposed).toBe(true)
    expect(observer.state.getSnapshot().error).toBeNull()
  })

  it('disposes an idle stream', async () => {
    const { observer, stream } = mount()
    await observer.dispose()
    expect(stream.disposed).toBe(true)
  })
})
