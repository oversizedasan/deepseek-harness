/** downloadBytes status handling for responses a loopback server cannot produce. */
import { EventEmitter } from 'node:events'
import { Socket } from 'node:net'
import { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { downloadBytes } from '../src/urls.ts'

const transport = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('node:http', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:http')>()
  return { ...original, request: transport.request }
})

/** Make the mocked transport answer with `statusCode` once the request ends. */
function answerWith(statusCode: number | undefined): void {
  transport.request.mockImplementation((_url: string, _options: object, callback: (res: IncomingMessage) => void) => {
    const response = new IncomingMessage(new Socket())
    response.statusCode = statusCode
    const request = Object.assign(new EventEmitter(), {
      end: () => { callback(response) },
      destroy: () => undefined,
    })
    return request
  })
}

describe('downloadBytes status handling', () => {
  it('reports an unknown status when the response carries none', async () => {
    answerWith(undefined)
    await expect(downloadBytes('http://asset.test/x', { allowInsecureTls: false })).rejects.toThrow(/HTTP unknown/)
  })

  it('rejects an informational status below 200', async () => {
    answerWith(199)
    await expect(downloadBytes('http://asset.test/x', { allowInsecureTls: false })).rejects.toThrow(/HTTP 199/)
  })
})
