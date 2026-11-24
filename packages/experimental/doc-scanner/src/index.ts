/** Document-scanner provider registry with live connection snapshots and capture coordination. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import { archiveCapture } from './archive.ts'
import { DocScannerError } from './error.ts'
import type {
  DocScannerCaptureOptions,
  DocScannerCaptureResult,
  DocScannerConnectionState,
  DocScannerImageBytes,
  DocScannerPreviewFrame,
  DocScannerProvider,
  DocScannerProviderId,
  DocScannerSnapshot,
} from './types.ts'

export type * from './types.ts'
export { DocScannerError } from './error.ts'
export { archiveCapture, DOC_SCANNER_CAPTURES_DIR } from './archive.ts'
export { ConnectionStateStore, isPreviewPhase, sleepUnlessAborted } from './provider-support.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental document-scanner provider registry. */
    docScanner: DocScanner
  }
}

interface Registration {
  readonly provider: DocScannerProvider
  readonly unsubscribe: () => void
  readonly unsubscribeStills: (() => void) | undefined
}

const DISCONNECTED: DocScannerConnectionState = { phase: 'disconnected' }

/** Registry shared by Host Remotes and provider plugins in one composition. */
export default class DocScanner extends Service {
  private readonly providers = new Map<DocScannerProviderId, Registration>()
  private readonly listeners = new Set<() => void>()
  private readonly stillListeners = new Set<(image: DocScannerImageBytes) => void>()
  private readonly lifetime = new AbortController()
  private activeId: DocScannerProviderId | undefined

  constructor(ctx: Context) {
    super(ctx, 'docScanner')
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Document scanner disposed'))
      await Promise.all([...this.providers].map(([id, registration]) => this.remove(id, registration)))
      this.listeners.clear()
      this.stillListeners.clear()
      this.activeId = undefined
    })
  }

  /**
   * Register one scanner backend; duplicate ids fail without replacing the original.
   * @param provider - backend owned by the contributing fiber.
   * @returns disposer that closes the provider when it is still registered.
   */
  register(provider: DocScannerProvider): () => Promise<void> {
    this.lifetime.signal.throwIfAborted()
    const { id } = provider.info
    if (this.providers.has(id)) {
      throw new DocScannerError(`Document scanner provider already registered: ${id}`, 'DOC_SCANNER_DUPLICATE_PROVIDER')
    }
    const unsubscribe = provider.subscribe(() => { this.changed() })
    const unsubscribeStills = provider.subscribeStills?.((image) => { this.emitStill(image) })
    const registration: Registration = { provider, unsubscribe, unsubscribeStills }
    this.providers.set(id, registration)
    this.changed()
    return async () => { await this.remove(id, registration) }
  }

  private async remove(id: DocScannerProviderId, registration: Registration): Promise<void> {
    if (this.providers.get(id) !== registration) return
    this.providers.delete(id)
    registration.unsubscribe()
    registration.unsubscribeStills?.()
    if (this.activeId === id) this.activeId = undefined
    try {
      await registration.provider.close()
    } catch (error) {
      // Provider close failures must not block fiber unload.
      void error
    }
    this.changed()
  }

  private changed(): void { for (const listener of this.listeners) listener() }

  private emitStill(image: DocScannerImageBytes): void {
    for (const listener of this.stillListeners) listener(image)
  }

  /**
   * Observe complete snapshots; a slow reader coalesces intermediate progress.
   * @param caller - observer lifetime.
   * @returns a stream that yields the current snapshot first, then one per change, ending when `caller` aborts or the service is disposed.
   */
  async *follow(caller: AbortSignal): AsyncIterable<DocScannerSnapshot> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted) {
        if (!changed) await wake.promise
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while awaiting the wake promise
        if (signal.aborted) break
        wake = Promise.withResolvers<undefined>()
        changed = false
        yield this.snapshot()
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /**
   * Persist provider-pushed hardware stills (hardgrab / auto-capture) for Client trays.
   * @param caller - observer lifetime.
   * @param options - optional batch folder and Session for disk archival.
   * @returns a stream with one persisted result per pushed still, ending when `caller` aborts or the service is disposed.
   */
  async *followStills(
    caller: AbortSignal,
    options: DocScannerCaptureOptions = {},
  ): AsyncIterable<DocScannerCaptureResult> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    const queue: DocScannerImageBytes[] = []
    let wake = Promise.withResolvers<undefined>()
    const onStill = (image: DocScannerImageBytes): void => {
      queue.push(image)
      wake.resolve(undefined)
    }
    const onAbort = (): void => { wake.resolve(undefined) }
    this.stillListeners.add(onStill)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!signal.aborted) {
        const image = queue.shift()
        if (image === undefined) {
          wake = Promise.withResolvers<undefined>()
          await wake.promise
          continue
        }
        yield await this.persistImage(image, options)
      }
    } finally {
      this.stillListeners.delete(onStill)
      signal.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Read the provider roster and active connection together.
   * @returns one detached observation.
   */
  snapshot(): DocScannerSnapshot {
    const providers = [...this.providers.values()].map(({ provider }) => provider.info)
    const active = this.activeId === undefined ? undefined : this.providers.get(this.activeId)?.provider
    return {
      providers,
      connection: active?.snapshot() ?? DISCONNECTED,
      ...this.activeId === undefined ? {} : { activeProviderId: this.activeId },
    }
  }

  private selected(id?: DocScannerProviderId): Registration {
    const resolved = id ?? this.activeId ?? (this.providers.size === 1 ? [...this.providers.keys()][0] : undefined)
    if (resolved === undefined) {
      throw new DocScannerError('No document scanner provider is selected', 'DOC_SCANNER_NO_PROVIDER')
    }
    const registration = this.providers.get(resolved)
    if (!registration) {
      throw new DocScannerError(`Document scanner provider is unavailable: ${resolved}`, 'DOC_SCANNER_PROVIDER_UNAVAILABLE')
    }
    return registration
  }

  /**
   * Connect through the selected provider until ready, device_missing, or error.
   * @param providerId - exact registered id; omitted when exactly one provider is registered or one is already active.
   * @param signal - caller cancellation.
   */
  async connect(providerId?: DocScannerProviderId, signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<void> {
    signal.throwIfAborted()
    const registration = this.selected(providerId)
    this.activeId = registration.provider.info.id
    this.changed()
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    await registration.provider.connect(combined)
    this.changed()
  }

  /**
   * Capture one still image from the active ready provider and optionally persist it.
   * @param signal - caller cancellation.
   * @param options - optional Client batch id and Session for workspace archival.
   * @returns the captured image with base64 bytes, and its attachment id and workspace path when saved.
   */
  async capture(
    signal: AbortSignal = AbortSignal.timeout(30_000),
    options: DocScannerCaptureOptions = {},
  ): Promise<DocScannerCaptureResult> {
    signal.throwIfAborted()
    const registration = this.selected()
    const connection = registration.provider.snapshot()
    if (connection.phase !== 'ready') {
      throw new DocScannerError('Document scanner is not ready to capture', 'DOC_SCANNER_NOT_READY')
    }
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    const image = await registration.provider.capture(combined)
    combined.throwIfAborted()
    return await this.persistImage(image, options)
  }

  /**
   * Stream viewfinder frames from the active provider while it is ready or capturing.
   * Frames stay out of {@link follow} snapshots.
   * @param signal - caller cancellation.
   * @returns a stream of viewfinder frames from the provider.
   */
  async *preview(signal: AbortSignal = AbortSignal.timeout(3_600_000)): AsyncIterable<DocScannerPreviewFrame> {
    signal.throwIfAborted()
    const registration = this.selected()
    const phase = registration.provider.snapshot().phase
    if (phase !== 'ready' && phase !== 'capturing') {
      throw new DocScannerError('Document scanner is not ready to preview', 'DOC_SCANNER_NOT_READY')
    }
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    yield * registration.provider.preview(combined)
  }

  /**
   * Close the active provider connection.
   * @returns after the provider releases the device.
   */
  async close(): Promise<void> {
    if (this.activeId === undefined) return
    // An active id always names a registered provider: remove() clears it first.
    const registration = this.selected(this.activeId)
    this.activeId = undefined
    await registration.provider.close()
    this.changed()
  }

  /**
   * Resolve the disk root for batch archival.
   * Prefers the live Session workspace via sandboxPolicy; falls back to process cwd.
   * @param sessionId - optional Session identity from the Client request.
   */
  private archiveRoot(sessionId: string | undefined): string {
    if (sessionId === undefined || sessionId.length === 0) return process.cwd()
    const sessions = this.ctx.get('sessions') as { get(id: string): object | undefined } | undefined
    const policy = this.ctx.get('sandboxPolicy') as {
      resolve(request?: { session?: object }): { workspaceRoot: string }
      workspaceRoot: string
    } | undefined
    const live = sessions?.get(sessionId)
    if (live !== undefined && policy !== undefined) {
      return policy.resolve({ session: live }).workspaceRoot
    }
    return policy?.workspaceRoot ?? process.cwd()
  }

  /**
   * Persist still bytes to optional attachments and optional batch disk archive.
   * @param image - raw provider still.
   * @param options - batch folder and optional Session for the archive root.
   */
  private async persistImage(
    image: DocScannerImageBytes,
    options: DocScannerCaptureOptions,
  ): Promise<DocScannerCaptureResult> {
    const dataBase64 = Buffer.from(image.data).toString('base64')
    const named = image.name === undefined ? {} : { name: image.name }
    let workspacePath: string | undefined
    const batchId = options.batchId
    if (batchId !== undefined && batchId.length > 0) {
      workspacePath = await archiveCapture(batchId, image, this.archiveRoot(options.sessionId))
    }
    const archived = workspacePath === undefined ? {} : { workspacePath }
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) {
      return {
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        dataBase64,
        ...named,
        ...archived,
      }
    }
    const refs = await attachments.saveImages([{
      data: image.data,
      mediaType: image.mimeType,
      ...named,
    }])
    const ref = refs[0]
    if (ref === undefined) {
      throw new DocScannerError('Attachment store returned no image reference', 'DOC_SCANNER_ATTACH_FAILED')
    }
    return {
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      attachmentId: ref.attachmentId,
      dataBase64,
      ...named,
      ...archived,
    }
  }
}
