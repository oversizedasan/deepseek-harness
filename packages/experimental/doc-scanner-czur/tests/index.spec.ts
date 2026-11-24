/** CZUR plugin: Config schema and registration on a real Context with the document-scanner service. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocScanner from '@deepseek-ai/dsh-doc-scanner'
import * as czur from '../src/index.ts'
import { CzurDocScannerProvider } from '../src/index.ts'
import { startFakeRuntime, type FakeRuntimeOptions } from './fake-runtime.ts'

const signal = (): AbortSignal => AbortSignal.timeout(5_000)

const fibers: Array<ReturnType<Context['plugin']>> = []
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const fiber of fibers.splice(0)) await fiber.dispose()
  for (const close of closers.splice(0)) await close()
})

/** Mount the scanner service and the CZUR plugin against a fresh fake Runtime. */
async function mount(
  config: Partial<czur.Config> = {},
  runtimeOptions: FakeRuntimeOptions = {},
): Promise<{ ctx: Context; runtime: Awaited<ReturnType<typeof startFakeRuntime>>; fiber: ReturnType<Context['plugin']> }> {
  const runtime = await startFakeRuntime(runtimeOptions)
  closers.push(runtime.close)
  const ctx = new Context()
  const scanner = ctx.plugin(DocScanner)
  fibers.push(scanner)
  await scanner
  const fiber = ctx.plugin(czur, {
    commandWsUrl: runtime.commandUrl,
    videoWsBaseUrl: runtime.videoBaseUrl,
    allowInsecureTls: true,
    ...config,
  })
  fibers.push(fiber)
  await fiber
  return { ctx, runtime, fiber }
}

describe('Config', () => {
  it('defaults to the local Runtime with strict TLS and automatic capture', () => {
    expect(czur.Config({})).toEqual({
      commandWsUrl: 'wss://sdk-runtime.localhost:18090',
      allowInsecureTls: false,
      autoCapture: true,
    })
  })

  it('keeps every configured field', () => {
    const config = {
      commandWsUrl: 'ws://127.0.0.1:1',
      videoWsBaseUrl: 'ws://127.0.0.1:2',
      preferredDeviceId: 'dev-9',
      credentialRef: 'MY_CZUR_TOKEN',
      allowInsecureTls: true,
      autoCapture: false,
    }
    expect(czur.Config(config)).toEqual(config)
  })

  it.each(['videoWsBaseUrl', 'preferredDeviceId', 'credentialRef'])('rejects an empty %s', (field) => {
    expect(() => czur.Config({ [field]: '' })).toThrow()
  })
})

describe('plugin registration', () => {
  it('declares its name and the scanner service it needs', () => {
    expect(czur.name).toBe('doc-scanner-czur')
    expect(czur.inject).toEqual(['docScanner'])
  })

  it('registers the CZUR provider and connects with the referenced credential', async () => {
    vi.stubEnv('MY_CZUR_TOKEN', 'secret-token')
    const { ctx, runtime } = await mount({ credentialRef: 'MY_CZUR_TOKEN' })
    expect(ctx.docScanner.snapshot().providers.map(provider => provider.id)).toEqual(['czur'])
    await ctx.docScanner.connect(undefined, signal())
    expect(ctx.docScanner.snapshot().connection).toMatchObject({ phase: 'ready', deviceId: 'dev-1' })
    expect(runtime.requests.find(row => row.method === 'auth.create_session')?.params).toEqual({ token: 'secret-token' })
  })

  it('falls back to CZUR_API_KEY when no credential reference is configured', async () => {
    vi.stubEnv('CZUR_API_KEY', 'default-token')
    const { ctx, runtime } = await mount()
    await ctx.docScanner.connect(undefined, signal())
    expect(runtime.requests.find(row => row.method === 'auth.create_session')?.params).toEqual({ token: 'default-token' })
  })

  it('reports an unconfigured credential as a connection error', async () => {
    vi.stubEnv('CZUR_API_KEY', '')
    const { ctx, runtime } = await mount()
    await ctx.docScanner.connect(undefined, signal())
    expect(ctx.docScanner.snapshot().connection).toMatchObject({ phase: 'error', message: expect.stringMatching(/token is not configured/) as string })
    expect(runtime.requests).toEqual([])
  })

  it('passes the preferred device and the automatic-capture switch to the provider', async () => {
    vi.stubEnv('CZUR_API_KEY', 'default-token')
    const { ctx, runtime } = await mount(
      { preferredDeviceId: 'b', autoCapture: false },
      { devices: [{ device_id: 'a' }, { device_id: 'b' }] },
    )
    await ctx.docScanner.connect(undefined, signal())
    expect(ctx.docScanner.snapshot().connection).toMatchObject({ phase: 'ready', deviceId: 'b' })
    expect(runtime.requests.map(row => row.method)).not.toContain('device.set_turn_detect')
  })

  it('derives the Video endpoint from the Command URL when none is configured', async () => {
    vi.stubEnv('CZUR_API_KEY', 'default-token')
    const { ctx } = await mount({ videoWsBaseUrl: undefined })
    await ctx.docScanner.connect(undefined, signal())
    expect(ctx.docScanner.snapshot().connection.phase).toBe('ready')
  })

  it('unregisters and closes the provider when the plugin is disposed', async () => {
    vi.stubEnv('CZUR_API_KEY', 'default-token')
    const { ctx, runtime, fiber } = await mount()
    await ctx.docScanner.connect(undefined, signal())
    await fiber.dispose()
    expect(ctx.docScanner.snapshot().providers).toEqual([])
    expect(runtime.requests.map(row => row.method)).toContain('device.close')
  })

  it('re-exports the provider class', () => {
    expect(czur.CzurDocScannerProvider).toBe(CzurDocScannerProvider)
  })
})
