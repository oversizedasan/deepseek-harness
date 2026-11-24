/** One reconnecting Host readiness mirror for document-scanner UI. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DocScannerSnapshot } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type {} from '@deepseek-ai/dsh-api-doc-scanner/remote'

/** Complete scanner snapshot, with a separate transport failure. */
export interface DocScannerReadiness {
  readonly snapshot: DocScannerSnapshot | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Subscribe once per Client plugin for scanner connection snapshots.
 * @param ctx - mounted document-scanner Remote owner.
 * @returns `state` with the latest snapshot, connection flag, and transport error;
 *   `dispose` stops the stream and waits for the observer to finish.
 */
export function observeReadiness(ctx: Context): { state: SnapshotStore<DocScannerReadiness>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<DocScannerReadiness>({ snapshot: null, connected: false, error: null })
  let disposed = false
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  const stream = ctx.remote.$stream<DocScannerSnapshot>({
    name: 'Document scanner readiness',
    open: signal => ctx.remote.docScanner.follow(signal),
    ended: () => new RemoteStreamCarrierError('Document scanner readiness stream ended'),
    carrierFailed: fail,
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        state.set({ snapshot: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run while the stream awaits
      if (!disposed) fail(error)
    }
  })()
  return {
    state,
    dispose: async () => {
      disposed = true
      await stream.dispose()
      await observing
    },
  }
}
