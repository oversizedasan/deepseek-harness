/** In-memory document-scanner provider for registry tests. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  DocScannerConnectionState,
  DocScannerImageBytes,
  DocScannerPreviewFrame,
  DocScannerProvider,
  DocScannerProviderId,
} from '../src/index.ts'

/**
 * Build a provider that connects instantly and captures a fixed JPEG.
 * @param options - optional overrides for still push, id, and close failure.
 */
export function fakeProvider(options?: {
  subscribeStills?: DocScannerProvider['subscribeStills']
  id?: string
  closeError?: Error
}): DocScannerProvider {
  let state: DocScannerConnectionState = { phase: 'disconnected' }
  const listeners = new Set<() => void>()
  const set = (next: DocScannerConnectionState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    info: { id: brandString<DocScannerProviderId>(options?.id ?? 'fake'), name: 'Fake', kind: 'other' },
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ...options?.subscribeStills === undefined ? {} : { subscribeStills: options.subscribeStills },
    async connect() {
      set({ phase: 'ready', providerId: brandString<DocScannerProviderId>('fake'), displayName: 'Fake' })
    },
    async capture(): Promise<DocScannerImageBytes> {
      return { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg', width: 1, height: 1, name: 'x.jpg' }
    },
    async *preview(signal: AbortSignal): AsyncIterable<DocScannerPreviewFrame> {
      signal.throwIfAborted()
      yield { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg', width: 1, height: 1, ts: 1 }
    },
    async close() {
      if (options?.closeError !== undefined) throw options.closeError
      set({ phase: 'disconnected' })
    },
  }
}
