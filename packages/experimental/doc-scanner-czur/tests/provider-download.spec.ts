/** Provider asset download failures that carry a non-Error value. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBytes } from '../src/urls.ts'
import { disposeRigs, startConnectedRig } from './provider-rig.ts'

vi.mock('../src/urls.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/urls.ts')>()
  return { ...original, downloadBytes: vi.fn() }
})

afterEach(async () => {
  await disposeRigs()
})

describe('asset download failures', () => {
  it('reports a non-Error rejection by its text and keeps it as the cause', async () => {
    vi.mocked(downloadBytes).mockRejectedValue('disk on fire')
    const { provider } = await startConnectedRig({ assetViaHttp: true })
    // The default fake capture points at the Asset HTTP server, which the mocked download never reaches.
    const error: unknown = await provider.capture(AbortSignal.timeout(5_000)).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'DOC_SCANNER_ATTACH_FAILED',
      message: 'CZUR asset download failed: disk on fire',
      cause: 'disk on fire',
    })
  })
})
