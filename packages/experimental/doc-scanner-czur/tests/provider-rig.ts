/** Shared setup for provider specs: a fake Runtime plus a provider wired to it, torn down together. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { CzurDocScannerProvider, type CzurDocScannerProviderOptions } from '../src/provider.ts'
import { startFakeRuntime, type FakeRuntimeOptions } from './fake-runtime.ts'

/** Handle returned by {@link startFakeRuntime}. */
export type FakeRuntime = Awaited<ReturnType<typeof startFakeRuntime>>

/** A running fake Runtime and a provider that targets it. */
export interface ProviderRig {
  readonly runtime: FakeRuntime
  readonly provider: CzurDocScannerProvider
}

const rigs: ProviderRig[] = []
const runtimes: FakeRuntime[] = []

/**
 * Start a fake Runtime and a provider; {@link disposeRigs} closes both.
 * @param runtimeOptions - fake Runtime behavior.
 * @param providerOptions - overrides for the provider's options.
 */
export async function startRig(
  runtimeOptions: FakeRuntimeOptions = {},
  providerOptions: Partial<CzurDocScannerProviderOptions> = {},
): Promise<ProviderRig> {
  const runtime = await startFakeRuntime(runtimeOptions)
  runtimes.push(runtime)
  const provider = new CzurDocScannerProvider({
    commandWsUrl: runtime.commandUrl,
    videoWsBaseUrl: runtime.videoBaseUrl,
    allowInsecureTls: true,
    resolveToken: async () => 'test-token',
    ...providerOptions,
  })
  const rig = { runtime, provider }
  rigs.push(rig)
  return rig
}

/** Start a rig and connect its provider. */
export async function startConnectedRig(
  runtimeOptions: FakeRuntimeOptions = {},
  providerOptions: Partial<CzurDocScannerProviderOptions> = {},
): Promise<ProviderRig> {
  const rig = await startRig(runtimeOptions, providerOptions)
  await rig.provider.connect(AbortSignal.timeout(5_000))
  return rig
}

/** Close every provider and Runtime started since the last call. */
export async function disposeRigs(): Promise<void> {
  const closing = rigs.splice(0)
  for (const rig of closing) await rig.provider.close()
  await Promise.all(runtimes.splice(0).map(async (runtime) => { await runtime.close() }))
}

/** `http://127.0.0.1:<port>` for a port that was just released, so connections are refused. */
export async function refusedHttpBase(): Promise<string> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('bind failed')
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  return `http://127.0.0.1:${String(address.port)}`
}
