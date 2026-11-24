/** Hardware still stream mirrored from the document-scanner Remote into the batch tray. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DocScannerCaptureResult } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type {} from '@deepseek-ai/dsh-api-doc-scanner/remote'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from './batch-limit.ts'
import type { DocScannerReadiness } from './readiness.ts'
import type { DocScannerSessionUi } from './session-ui.ts'

/**
 * Append provider-pushed stills to the session tray while the device is ready or capturing.
 * @param ctx - mounted document-scanner Remote owner.
 * @param readiness - connection mirror shared with the preview pane.
 * @param sessionUi - tray store that receives stills and supplies `batchId`.
 * @returns `dispose`, which stops observing and the stills stream and waits for it to end.
 *   The stream restarts when `batchId` or `archiveSessionId` changes;
 *   stills beyond the per-message image limit are dropped.
 */
export function observeStillsFeed(
  ctx: Context,
  readiness: SnapshotStore<DocScannerReadiness>,
  sessionUi: SnapshotStore<DocScannerSessionUi>,
): { dispose: () => Promise<void> } {
  let disposed = false
  let generation = 0
  let active: { dispose: () => Promise<void>; done: Promise<void> } | undefined
  let activeBatchId: string | undefined
  let activeSessionId: string | null | undefined

  const stop = async (): Promise<void> => {
    const current = active
    active = undefined
    activeBatchId = undefined
    activeSessionId = undefined
    if (current === undefined) return
    await current.dispose()
    await current.done
  }

  const start = (batchId: string, sessionId: string | null): void => {
    if (disposed || active !== undefined) return
    const token = ++generation
    activeBatchId = batchId
    activeSessionId = sessionId
    const sessionScoped = sessionId === null ? {} : { sessionId }
    const stream = ctx.remote.$stream<DocScannerCaptureResult>({
      name: 'Document scanner stills',
      open: signal => ctx.remote.docScanner.followStills({ batchId, ...sessionScoped }, signal),
      ended: () => new RemoteStreamCarrierError('Document scanner stills stream ended'),
      carrierFailed: (error) => {
        if (disposed || token !== generation) return
        sessionUi.set({
          ...sessionUi.getSnapshot(),
          message: error.message,
        })
      },
    })
    const done = (async () => {
      try {
        for await (const item of stream) {
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() or a restart can change these between awaits
          if (disposed || token !== generation) {
            item.accept()
            break
          }
          const current = sessionUi.getSnapshot()
          if (current.captures.length >= DOC_SCANNER_MAX_IMAGES_PER_MESSAGE) {
            item.accept()
            continue
          }
          sessionUi.set({
            ...current,
            captures: [...current.captures, item.value],
            message: null,
          })
          item.accept()
        }
      } catch (error) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() or a restart can change these between awaits
        if (!disposed && token === generation) {
          sessionUi.set({
            ...sessionUi.getSnapshot(),
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        if (token === generation) active = undefined
      }
    })()
    active = { dispose: () => stream.dispose(), done }
  }

  const sync = (): void => {
    if (disposed) return
    const phase = readiness.getSnapshot().snapshot?.connection.phase
    const streaming = phase === 'ready' || phase === 'capturing'
    const ui = sessionUi.getSnapshot()
    const batchId = ui.batchId
    const sessionId = ui.archiveSessionId
    if (streaming) {
      if (active !== undefined && activeBatchId === batchId && activeSessionId === sessionId) return
      void stop().then(() => {
        if (!disposed) start(batchId, sessionId)
      })
      return
    }
    void stop()
  }

  const unsubReady = readiness.subscribe(sync)
  const unsubUi = sessionUi.subscribe(sync)
  sync()

  return {
    dispose: async () => {
      disposed = true
      unsubReady()
      unsubUi()
      generation += 1
      await stop()
    },
  }
}
