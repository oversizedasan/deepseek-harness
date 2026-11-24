/** CZUR SDK Open document-scanner provider (Command WS + Video WS). */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, resolveCredentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { CzurDocScannerProvider } from './provider.ts'

export { CzurDocScannerProvider } from './provider.ts'
export type { CzurDocScannerProviderOptions } from './provider.ts'

export const name = 'doc-scanner-czur'
export const inject = ['docScanner']

/** Default ambient / credentials reference when Config omits `credentialRef`. */
const DEFAULT_CREDENTIAL_REF = 'CZUR_API_KEY'

/** Host-local CZUR Runtime settings; credentials stay out of source control. */
export interface Config {
  /** Command WebSocket URL for the local CZUR SDK Runtime. */
  commandWsUrl: string
  /**
   * Optional Video WebSocket base URL (without query).
   * When omitted, derived from `commandWsUrl` (`18090→18091`, `17090→17091`).
   */
  videoWsBaseUrl?: string | undefined
  /** Optional preferred device id after `device.list`. */
  preferredDeviceId?: string | undefined
  /** Optional credential reference name resolved by the Host credentials seam. */
  credentialRef?: string | undefined
  /**
   * When true, Command/Video/Asset TLS skips certificate verification; defaults to false,
   * the bundled patches set true for the local self-signed Runtime.
   */
  allowInsecureTls: boolean
  /**
   * When true, enable page-turn detection after open. The Runtime does not apply
   * `auto_capture: true`, so `capture.turn_detected` makes this connection call
   * `capture.take`. A hardware-button event with no deliverable still does the same.
   */
  autoCapture: boolean
}

export const Config: z<Partial<Config>, Config> = z.object({
  commandWsUrl: z.string().default('wss://sdk-runtime.localhost:18090'),
  videoWsBaseUrl: z.union([z.string().min(1), z.const(undefined)]),
  preferredDeviceId: z.union([z.string().min(1), z.const(undefined)]),
  credentialRef: z.union([z.string().min(1), z.const(undefined)]),
  allowInsecureTls: z.boolean().default(false),
  autoCapture: z.boolean().default(true),
})

/**
 * Register the CZUR document camera on `ctx.docScanner`.
 * @param ctx - Host composition with the scanner service.
 * @param config - validated Runtime settings.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const refName = config.credentialRef ?? DEFAULT_CREDENTIAL_REF
    const provider = new CzurDocScannerProvider({
      commandWsUrl: config.commandWsUrl,
      allowInsecureTls: config.allowInsecureTls,
      autoCapture: config.autoCapture,
      resolveToken: async () => await resolveCredentialRef(ctx, credentialRef(refName)),
      ...config.videoWsBaseUrl === undefined ? {} : { videoWsBaseUrl: config.videoWsBaseUrl },
      ...config.preferredDeviceId === undefined ? {} : { preferredDeviceId: config.preferredDeviceId },
    })
    const dispose = ctx.docScanner.register(provider)
    return async () => { await dispose() }
  })
}
