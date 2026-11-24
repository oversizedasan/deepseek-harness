/** Command / Video URL helpers and Asset HTTP download. */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'

const COMMAND_TO_VIDEO_PORT: Readonly<Record<string, string>> = {
  '18090': '18091',
  '17090': '17091',
}

/**
 * Derive the Video WS base URL from the Command WS URL when Config omits `videoWsBaseUrl`.
 * @param commandWsUrl - Command endpoint such as `wss://sdk-runtime.localhost:18090`.
 * @returns Video base without query, or undefined when the port cannot be mapped.
 */
export function deriveVideoWsBaseUrl(commandWsUrl: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(commandWsUrl)
  } catch {
    return undefined
  }
  const mapped = COMMAND_TO_VIDEO_PORT[parsed.port]
  if (mapped === undefined) {
    if (parsed.port === '') return undefined
    parsed.port = String(Number(parsed.port) + 1)
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  }
  parsed.port = mapped
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

/**
 * Build the Video WS URL with session and stream query parameters.
 * @param baseUrl - Video base from Config or {@link deriveVideoWsBaseUrl}.
 * @param sessionToken - token from `video.start`.
 * @param streamId - stream id from `video.start`.
 * @returns `baseUrl` with the `session_token` and `stream_id` query parameters set.
 */
export function videoWsUrl(baseUrl: string, sessionToken: string, streamId: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('session_token', sessionToken)
  url.searchParams.set('stream_id', streamId)
  return url.toString()
}

/** Options for {@link downloadBytes}. */
export interface DownloadBytesOptions {
  /** When true, `rejectUnauthorized` is false for https (local Runtime TLS). */
  readonly allowInsecureTls: boolean
  /**
   * Session token from `auth.create_session`.
   * Asset HTTPS requires `Authorization: Bearer <session_token>`.
   */
  readonly authorizationBearer?: string | undefined
  /** Caller cancellation. */
  readonly signal?: AbortSignal | undefined
}

/**
 * Download asset bytes over HTTP(S), optionally skipping TLS verification for local Runtime.
 * @param url - asset `download_url` or `url`.
 * @param options - TLS, session Bearer, and cancellation.
 * @returns the complete response body.
 */
export async function downloadBytes(
  url: string,
  options: DownloadBytesOptions,
): Promise<Uint8Array> {
  const signal = options.signal ?? AbortSignal.timeout(30_000)
  signal.throwIfAborted()
  const parsed = new URL(url)
  const transport = parsed.protocol === 'http:' ? httpRequest : httpsRequest
  const headers: Record<string, string> = {}
  if (options.authorizationBearer !== undefined && options.authorizationBearer.length > 0) {
    headers.Authorization = `Bearer ${options.authorizationBearer}`
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const onAbort = (): void => {
      req.destroy()
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    }
    const req = transport(url, {
      method: 'GET',
      headers,
      ...parsed.protocol === 'https:' ? { rejectUnauthorized: !options.allowInsecureTls } : {},
    }, (res: IncomingMessage) => {
      if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && typeof res.headers.location === 'string') {
        res.resume()
        void downloadBytes(new URL(res.headers.location, url).toString(), options).then(resolve, reject)
        return
      }
      if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        reject(new Error(`Asset download failed with HTTP ${String(res.statusCode ?? 'unknown')}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => { resolve(new Uint8Array(Buffer.concat(chunks))) })
      res.on('error', reject)
    })
    req.on('error', reject)
    signal.addEventListener('abort', onAbort, { once: true })
    req.end()
  })
}
