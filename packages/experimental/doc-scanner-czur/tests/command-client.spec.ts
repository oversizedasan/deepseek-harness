/** Command WS client: connection lifecycle, request correlation, events, and teardown. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { CzurCommandClient, CzurCommandError, type CzurCommandClientOptions } from '../src/command-client.ts'
import { startFakeRuntime } from './fake-runtime.ts'
import { FakeSocket, sentRequest } from './fake-socket.ts'

function newClient(options: Partial<CzurCommandClientOptions> = {}): CzurCommandClient {
  return new CzurCommandClient({
    url: 'ws://127.0.0.1:9',
    allowInsecureTls: false,
    WebSocketImpl: FakeSocket,
    ...options,
  })
}

/** Connect a client and return it with its socket. */
async function connected(options: Partial<CzurCommandClientOptions> = {}): Promise<{ client: CzurCommandClient; socket: FakeSocket }> {
  const client = newClient(options)
  await client.connect(AbortSignal.timeout(2_000))
  const socket = FakeSocket.last
  if (socket === undefined) throw new Error('socket missing')
  return { client, socket }
}

/** Answer the first still-unanswered request with `reply`. */
function answer(socket: FakeSocket, index: number, reply: Record<string, unknown>): void {
  socket.pushJson({ request_id: sentRequest(socket, index).request_id, code: 0, message: 'ok', ...reply })
}

beforeEach(() => { FakeSocket.reset() })
afterEach(() => { vi.useRealTimers() })

describe('CzurCommandClient.connect', () => {
  it('skips certificate verification only when allowInsecureTls is set', async () => {
    const insecure = await connected({ allowInsecureTls: true })
    expect(insecure.socket.options).toEqual({ rejectUnauthorized: false })
    const strict = await connected({ allowInsecureTls: false })
    expect(strict.socket.options).toEqual({})
    insecure.client.close()
    strict.client.close()
  })

  it('opens once and ignores a second connect', async () => {
    const { client, socket } = await connected()
    await client.connect(AbortSignal.timeout(2_000))
    expect(FakeSocket.last).toBe(socket)
    client.close()
  })

  it('connects with its default timeout signal', async () => {
    const client = newClient()
    await client.connect()
    client.close()
  })

  it('opens a real server connection through the default WebSocket implementation', async () => {
    const runtime = await startFakeRuntime()
    const client = new CzurCommandClient({ url: runtime.commandUrl, allowInsecureTls: false })
    try {
      await client.connect(AbortSignal.timeout(2_000))
      await expect(client.request('device.list')).resolves.toEqual({ devices: [{ device_id: 'dev-1', display_name: 'Fake CZUR' }] })
    } finally {
      client.close()
      await runtime.close()
    }
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('too late'))
    await expect(newClient().connect(controller.signal)).rejects.toThrow('too late')
    expect(FakeSocket.last).toBeUndefined()
  })

  it.each([
    { label: 'an Error reason', reason: new Error('caller cancelled'), message: 'caller cancelled' },
    { label: 'a non-Error reason', reason: 'cancelled', message: 'Aborted' },
  ])('closes the socket when $label aborts the handshake', async ({ reason, message }) => {
    FakeSocket.script = { autoOpen: false }
    const controller = new AbortController()
    const pending = newClient().connect(controller.signal)
    const socket = FakeSocket.last
    controller.abort(reason)
    await expect(pending).rejects.toThrow(message)
    expect(socket?.readyState).toBe(WebSocket.CLOSED)
  })

  it('still rejects the handshake when closing the socket throws', async () => {
    FakeSocket.script = {
      autoOpen: false,
      onClose: () => { throw new Error('already connecting') },
    }
    const controller = new AbortController()
    const pending = newClient().connect(controller.signal)
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
  })

  it('closes the socket when the signal aborts while the socket is being constructed', async () => {
    const controller = new AbortController()
    FakeSocket.script = {
      autoOpen: false,
      onConstruct: () => { controller.abort(new Error('aborted during construction')) },
    }
    await expect(newClient().connect(controller.signal)).rejects.toThrow('aborted during construction')
    expect(FakeSocket.last?.readyState).toBe(WebSocket.CLOSED)
  })

  it('rejects with the socket error raised before open', async () => {
    FakeSocket.script = { autoOpen: false }
    const pending = newClient().connect(AbortSignal.timeout(2_000))
    FakeSocket.last?.emit('error', new Error('handshake refused'))
    await expect(pending).rejects.toThrow('handshake refused')
  })
})

describe('CzurCommandClient.request', () => {
  it('refuses to send before connect, after close, and while the socket is not open', async () => {
    const idle = newClient()
    await expect(idle.request('device.list')).rejects.toThrow('not connected')

    const { client, socket } = await connected()
    socket.readyState = WebSocket.CONNECTING
    await expect(client.request('device.list')).rejects.toThrow('not connected')
    socket.readyState = WebSocket.OPEN

    client.close()
    await expect(client.request('device.list')).rejects.toThrow('not connected')
  })

  it('sends the method, params, and client identity and resolves with the matching response data', async () => {
    const { client, socket } = await connected()
    const pending = client.request('auth.create_session', { token: 't' })
    const frame = sentRequest(socket)
    expect(frame).toMatchObject({ method: 'auth.create_session', params: { token: 't' }, client: { name: 'dsh-doc-scanner-czur' } })
    answer(socket, 0, { data: { session_token: 's' } })
    await expect(pending).resolves.toEqual({ session_token: 's' })
    client.close()
  })

  it('defaults params to an empty object', async () => {
    const { client, socket } = await connected()
    const pending = client.request('device.list')
    expect(sentRequest(socket).params).toEqual({})
    answer(socket, 0, {})
    await expect(pending).resolves.toBeUndefined()
    client.close()
  })

  it('ignores responses for unknown request ids, non-JSON frames, and JSON that is neither response nor event', async () => {
    const { client, socket } = await connected()
    const pending = client.request('device.list')
    socket.pushJson({ request_id: 'someone-else', code: 0, message: 'ok' })
    socket.push('not json at all')
    socket.pushJson({ unrelated: true })
    socket.pushJson(null)
    answer(socket, 0, { data: 1 })
    await expect(pending).resolves.toBe(1)
    client.close()
  })

  it('throws a CzurCommandError carrying the code, message, and data of a failed response', async () => {
    const { client, socket } = await connected()
    const pending = client.request('capture.take')
    answer(socket, 0, { code: 1004, message: 'RateLimited', data: { retry_after_ms: 5 } })
    const error: unknown = await pending.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CzurCommandError)
    expect(error).toMatchObject({ name: 'CzurCommandError', message: 'RateLimited', code: 1004, data: { retry_after_ms: 5 } })
    client.close()
  })

  it('falls back to a generic message when a failed response has an empty one', async () => {
    const { client, socket } = await connected()
    const pending = client.request('capture.take')
    answer(socket, 0, { code: 7, message: '' })
    await expect(pending).rejects.toMatchObject({ message: 'CZUR capture.take failed', code: 7 })
    client.close()
  })

  it('rejects with a timeout error and discards a late response', async () => {
    vi.useFakeTimers()
    const { client, socket } = await connected()
    const pending = client.request('device.list', {}, 50)
    const settled = expect(pending).rejects.toThrow('timed out: device.list')
    await vi.advanceTimersByTimeAsync(50)
    await settled
    answer(socket, 0, { data: 'late' })
    client.close()
  })

  it('waits without a timer when the timeout is zero', async () => {
    vi.useFakeTimers()
    const { client, socket } = await connected()
    const pending = client.request('device.list', {}, 0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    answer(socket, 0, { data: 'eventually' })
    await expect(pending).resolves.toBe('eventually')
    client.close()
  })

  it('does not time out a request that already completed', async () => {
    vi.useFakeTimers()
    const { client, socket } = await connected()
    const pending = client.request('device.list', {}, 50)
    answer(socket, 0, { data: 'fast' })
    await expect(pending).resolves.toBe('fast')
    expect(vi.getTimerCount()).toBe(0)
    client.close()
  })

  it.each([
    { label: 'an Error', failure: new Error('socket jammed'), message: 'socket jammed', timeoutMs: 30_000 },
    { label: 'a non-Error value', failure: 'jammed', message: 'jammed', timeoutMs: 30_000 },
    { label: 'an Error without a request timeout', failure: new Error('socket jammed'), message: 'socket jammed', timeoutMs: 0 },
  ])('rejects and clears the timer when send throws $label', async ({ failure, message, timeoutMs }) => {
    vi.useFakeTimers()
    const { client } = await connected()
    FakeSocket.script.onSend = () => {
      throw failure
    }
    await expect(client.request('device.list', {}, timeoutMs)).rejects.toThrow(message)
    expect(vi.getTimerCount()).toBe(0)
    client.close()
  })
})

describe('CzurCommandClient events', () => {
  it('delivers push events to onEvent and tolerates a missing handler', async () => {
    const onEvent = vi.fn()
    const withHandler = await connected({ onEvent })
    withHandler.socket.pushJson({ event: 'device.removed', payload: { device_id: 'd' } })
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ event: 'device.removed', payload: { device_id: 'd' } })
    withHandler.client.close()

    const without = await connected()
    expect(() => { without.socket.pushJson({ event: 'device.removed' }) }).not.toThrow()
    without.client.close()
  })

  it('decodes Buffer, Buffer list, and ArrayBuffer frames and skips other payload kinds', async () => {
    const onEvent = vi.fn()
    const { client, socket } = await connected({ onEvent })
    const text = JSON.stringify({ event: 'e' })
    socket.push(Buffer.from(text))
    socket.push([Buffer.from(text.slice(0, 5)), Buffer.from(text.slice(5))])
    socket.push(Uint8Array.from(Buffer.from(text)).buffer)
    expect(onEvent).toHaveBeenCalledTimes(3)
    socket.emit('message', 42, false)
    expect(onEvent).toHaveBeenCalledTimes(3)
    client.close()
  })
})

describe('CzurCommandClient teardown', () => {
  it('rejects in-flight requests and clears their timers on close', async () => {
    vi.useFakeTimers()
    const { client } = await connected()
    const pending = client.request('device.list')
    const noTimer = client.request('device.open', {}, 0)
    const settled = Promise.all([
      expect(pending).rejects.toThrow('Command WS closed'),
      expect(noTimer).rejects.toThrow('Command WS closed'),
    ])
    client.close()
    await settled
    expect(vi.getTimerCount()).toBe(0)
  })

  it('treats a second close as a no-op', async () => {
    const { client, socket } = await connected()
    client.close()
    const closes = vi.spyOn(socket, 'close')
    client.close()
    expect(closes).not.toHaveBeenCalled()
  })

  it('closes cleanly before it ever connected', () => {
    expect(() => { newClient().close() }).not.toThrow()
  })

  it('swallows a failure from the socket while closing', async () => {
    const { client } = await connected()
    FakeSocket.script.onClose = () => { throw new Error('already gone') }
    expect(() => { client.close() }).not.toThrow()
  })

  it('fails pending requests and reports onClose when the server closes the socket', async () => {
    const onClose = vi.fn()
    const { client, socket } = await connected({ onClose })
    const pending = client.request('device.list', {}, 0)
    const settled = expect(pending).rejects.toThrow('Command WS closed (4001): server restart')
    socket.close(4001, 'server restart')
    await settled
    expect(onClose).toHaveBeenCalledExactlyOnceWith(4001, 'server restart')
  })

  it('names a missing close reason and tolerates a missing onClose handler', async () => {
    const { client, socket } = await connected()
    const pending = client.request('device.list')
    const settled = expect(pending).rejects.toThrow('Command WS closed (1006): no reason')
    socket.close(1006)
    await settled
    client.close()
  })
})
