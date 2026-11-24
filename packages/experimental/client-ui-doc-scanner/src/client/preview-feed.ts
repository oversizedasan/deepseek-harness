/** Live viewfinder frames mirrored from the document-scanner Remote. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DocScannerPreviewFrameWire } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type {} from '@deepseek-ai/dsh-api-doc-scanner/remote'
import type { DocScannerReadiness } from './readiness.ts'

/** Latest viewfinder image as a data URL, with a separate transport failure. */
export interface DocScannerPreviewFeed {
  readonly src: string | null
  readonly error: string | null
  readonly streaming: boolean
}

/**
 * Drive a preview pane from readiness: stream frames only while the device is ready or capturing.
 * @param ctx - mounted document-scanner Remote owner.
 * @param readiness - connection mirror shared with the activity bar.
 * @returns `state` with the latest frame data URL, transport error, and streaming flag;
 *   `dispose` stops the stream and waits for it to end.
 *   The stream stops and `state` resets when the phase leaves `ready`/`capturing`.
 */
export function observePreviewFeed(
  ctx: Context,
  readiness: SnapshotStore<DocScannerReadiness>,
): { state: SnapshotStore<DocScannerPreviewFeed>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<DocScannerPreviewFeed>({ src: null, error: null, streaming: false })
  let disposed = false
  let generation = 0
  let active: { dispose: () => Promise<void>; done: Promise<void> } | undefined

  const stop = async (): Promise<void> => {
    const current = active
    active = undefined
    if (current === undefined) return
    await current.dispose()
    await current.done
  }

  const start = (): void => {
    if (disposed || active !== undefined) return
    const token = ++generation
    state.set({ ...state.getSnapshot(), streaming: true, error: null })
    const stream = ctx.remote.$stream<DocScannerPreviewFrameWire>({
      name: 'Document scanner preview',
      open: signal => ctx.remote.docScanner.preview(signal),
      ended: () => new RemoteStreamCarrierError('Document scanner preview stream ended'),
      carrierFailed: (error) => {
        if (disposed || token !== generation) return
        state.set({
          src: state.getSnapshot().src,
          streaming: false,
          error: error.message,
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
          state.set({
            src: `data:${item.value.mimeType};base64,${item.value.dataBase64}`,
            error: null,
            streaming: true,
          })
          item.accept()
        }
      } catch (error) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() or a restart can change these between awaits
        if (!disposed && token === generation) {
          state.set({
            src: state.getSnapshot().src,
            streaming: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        if (token === generation) {
          active = undefined
          state.set({ ...state.getSnapshot(), streaming: false })
        }
      }
    })()
    active = { dispose: () => stream.dispose(), done }
  }

  const sync = (): void => {
    if (disposed) return
    const phase = readiness.getSnapshot().snapshot?.connection.phase
    const previewable = phase === 'ready' || phase === 'capturing'
    if (previewable) start()
    else void stop().then(() => {
      if (!disposed) state.set({ src: null, error: null, streaming: false })
    })
  }

  const unsubscribe = readiness.subscribe(sync)
  sync()

  return {
    state,
    dispose: async () => {
      disposed = true
      unsubscribe()
      generation += 1
      await stop()
    },
  }
}
