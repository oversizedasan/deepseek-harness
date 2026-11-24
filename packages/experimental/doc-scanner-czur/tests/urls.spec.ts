/** Video URL derivation and Asset download behavior against loopback servers. */
import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { deriveVideoWsBaseUrl, downloadBytes, videoWsUrl } from '../src/urls.ts'
import { FAKE_JPEG } from './fake-runtime.ts'

describe('deriveVideoWsBaseUrl', () => {
  it('returns undefined for an unparsable URL and for a URL without an explicit port', () => {
    expect(deriveVideoWsBaseUrl('not a url')).toBeUndefined()
    expect(deriveVideoWsBaseUrl('wss://sdk-runtime.localhost')).toBeUndefined()
  })

  it('adds one to an unmapped port and drops path, query, and fragment', () => {
    expect(deriveVideoWsBaseUrl('ws://127.0.0.1:8080/cmd?x=1#frag')).toBe('ws://127.0.0.1:8081')
  })

  it('maps the known Command ports and drops path, query, and fragment', () => {
    expect(deriveVideoWsBaseUrl('wss://sdk-runtime.localhost:18090/cmd?x=1#frag')).toBe('wss://sdk-runtime.localhost:18091')
  })
})

describe('videoWsUrl', () => {
  it('appends the session token and stream id as query parameters', () => {
    const url = new URL(videoWsUrl('ws://127.0.0.1:18091', 'video-sess', 'stream-1'))
    expect(url.origin).toBe('ws://127.0.0.1:18091')
    expect(url.searchParams.get('session_token')).toBe('video-sess')
    expect(url.searchParams.get('stream_id')).toBe('stream-1')
  })
})

/** Serve `handler` on an ephemeral loopback port for the duration of `body`. */
async function withServer(
  handler: RequestListener,
  body: (baseUrl: string, server: Server) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('bind failed')
  try {
    await body(`http://127.0.0.1:${String(address.port)}`, server)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
}

describe('downloadBytes over HTTP', () => {
  it('downloads without an Authorization header and ignores an empty Bearer', async () => {
    const seen: (string | undefined)[] = []
    await withServer((req, res) => {
      seen.push(req.headers.authorization)
      res.writeHead(200)
      res.end(FAKE_JPEG)
    }, async (base) => {
      const bytes = await downloadBytes(`${base}/asset`, { allowInsecureTls: false })
      expect(Buffer.from(bytes).equals(FAKE_JPEG)).toBe(true)
      await downloadBytes(`${base}/asset`, { allowInsecureTls: false, authorizationBearer: '' })
      expect(seen).toEqual([undefined, undefined])
    })
  })

  it('follows a redirect and keeps the Bearer token', async () => {
    const seen: string[] = []
    await withServer((req, res) => {
      seen.push(`${req.url ?? ''} ${req.headers.authorization ?? ''}`)
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/final' })
        res.end()
        return
      }
      res.writeHead(200)
      res.end(FAKE_JPEG)
    }, async (base) => {
      const bytes = await downloadBytes(`${base}/start`, { allowInsecureTls: false, authorizationBearer: 'tok' })
      expect(bytes.byteLength).toBe(FAKE_JPEG.byteLength)
      expect(seen).toEqual(['/start Bearer tok', '/final Bearer tok'])
    })
  })

  it('rejects a redirect without a Location header as an HTTP failure', async () => {
    await withServer((_req, res) => {
      res.writeHead(302)
      res.end()
    }, async (base) => {
      await expect(downloadBytes(`${base}/x`, { allowInsecureTls: false })).rejects.toThrow(/HTTP 302/)
    })
  })

  it('rejects a non-2xx status', async () => {
    await withServer((_req, res) => {
      res.writeHead(404)
      res.end()
    }, async (base) => {
      await expect(downloadBytes(`${base}/x`, { allowInsecureTls: false })).rejects.toThrow(/HTTP 404/)
    })
  })

  it('rejects before connecting when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stop now'))
    await expect(downloadBytes('http://127.0.0.1:9/x', {
      allowInsecureTls: false,
      signal: controller.signal,
    })).rejects.toThrow('stop now')
  })

  it.each([
    { label: 'an Error reason', reason: new Error('caller cancelled'), message: 'caller cancelled' },
    { label: 'a non-Error reason', reason: 'cancelled', message: 'Aborted' },
  ])('aborts an in-flight download with $label', async ({ reason, message }) => {
    const controller = new AbortController()
    await withServer(() => {
      // Never respond; the caller cancels once the request reaches the server.
      controller.abort(reason)
    }, async (base) => {
      await expect(downloadBytes(`${base}/x`, {
        allowInsecureTls: false,
        signal: controller.signal,
      })).rejects.toThrow(message)
    })
  })

  it('rejects when the connection fails', async () => {
    let refused = ''
    await withServer(() => undefined, (base) => {
      refused = base
      return Promise.resolve()
    })
    await expect(downloadBytes(`${refused}/x`, { allowInsecureTls: false })).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('downloadBytes over HTTPS', () => {
  it.each([true, false])('selects the HTTPS transport with allowInsecureTls=%j', async (allowInsecureTls) => {
    let refused = ''
    await withServer(() => undefined, (base) => {
      refused = base.replace('http:', 'https:')
      return Promise.resolve()
    })
    await expect(downloadBytes(`${refused}/x`, { allowInsecureTls })).rejects.toThrow(/ECONNREFUSED/)
  })
})
