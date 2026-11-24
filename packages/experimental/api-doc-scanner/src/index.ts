/** Authenticated Client access to the document-scanner capability. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-doc-scanner'
import { DocScannerError } from '@deepseek-ai/dsh-doc-scanner'
import type {
  DocScannerCaptureResult,
  DocScannerPreviewFrameWire,
  DocScannerProviderId,
  DocScannerSnapshot,
} from '@deepseek-ai/dsh-doc-scanner'
import type { DocScannerCaptureRequest, DocScannerConnectRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental document-scanner Remote controller. */
    docScannerController: DocScannerController
  }
}

/** Document-scanner calls never activate or submit to an Agent. */
export default class DocScannerController extends TypertRemoteService {
  static inject = ['docScanner', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'docScannerController', { namespace: 'docScanner' })
  }

  /**
   * Read the provider roster and connection state.
   * @returns one detached snapshot.
   */
  @Remote
  snapshot(): DocScannerSnapshot {
    return this.ctx.docScanner.snapshot()
  }

  /**
   * Follow connection snapshots for the Client status UI.
   * @param signal - Client observation lifetime.
   * @returns a stream of complete snapshots that ends when `signal` aborts.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<DocScannerSnapshot> {
    yield * this.ctx.docScanner.follow(signal)
  }

  /**
   * Connect the selected or sole provider.
   * @param request - optional provider id.
   * @param signal - Client cancellation.
   */
  @Remote
  async connect(request: DocScannerConnectRequest, signal: AbortSignal): Promise<void> {
    try {
      await this.ctx.docScanner.connect(request.providerId, signal)
    } catch (error) {
      signal.throwIfAborted()
      throw mapError(error)
    }
  }

  /**
   * Capture one image while the scanner is ready.
   * @param request - optional batch id and Session for workspace archival.
   * @param signal - Client cancellation.
   * @returns the captured image with base64 bytes, and its attachment id and workspace path when saved.
   */
  @Remote
  async capture(request: DocScannerCaptureRequest, signal: AbortSignal): Promise<DocScannerCaptureResult> {
    try {
      return await this.ctx.docScanner.capture(signal, request)
    } catch (error) {
      signal.throwIfAborted()
      throw mapError(error)
    }
  }

  /**
   * Stream hardware-pushed stills (hardgrab / auto-capture) into the Client tray.
   * @param request - optional batch id and Session for workspace archival.
   * @param signal - Client observation lifetime.
   * @returns a stream with one result per pushed still, ending when `signal` aborts.
   */
  @Remote({ mode: 'stream' })
  async *followStills(request: DocScannerCaptureRequest, signal: AbortSignal): AsyncIterable<DocScannerCaptureResult> {
    try {
      yield * this.ctx.docScanner.followStills(signal, request)
    } catch (error) {
      signal.throwIfAborted()
      throw mapError(error)
    }
  }

  /**
   * Stream viewfinder frames for the Client preview pane.
   * @param signal - Client observation lifetime.
   * @returns a stream of base64-encoded viewfinder frames, ending when `signal` aborts.
   */
  @Remote({ mode: 'stream' })
  async *preview(signal: AbortSignal): AsyncIterable<DocScannerPreviewFrameWire> {
    try {
      for await (const frame of this.ctx.docScanner.preview(signal)) {
        signal.throwIfAborted()
        yield {
          dataBase64: Buffer.from(frame.data).toString('base64'),
          mimeType: frame.mimeType,
          width: frame.width,
          height: frame.height,
          ...frame.ts === undefined ? {} : { ts: frame.ts },
        }
      }
    } catch (error) {
      signal.throwIfAborted()
      throw mapError(error)
    }
  }

  /**
   * Close the active device connection.
   * @returns after the provider releases the device.
   */
  @Remote
  async close(): Promise<void> {
    try {
      await this.ctx.docScanner.close()
    } catch (error) {
      throw mapError(error)
    }
  }
}

function mapError(error: unknown): RemoteError {
  if (error instanceof DocScannerError) {
    switch (error.code) {
      case 'DOC_SCANNER_NOT_READY':
        return new RemoteError('doc-scanner/not-ready', error.message, { reason: error.code })
      case 'DOC_SCANNER_NO_PROVIDER':
        return new RemoteError('doc-scanner/no-provider', error.message, { reason: error.code })
      case 'DOC_SCANNER_PROVIDER_UNAVAILABLE':
        return new RemoteError('doc-scanner/provider-unavailable', error.message, { reason: error.code })
      case 'DOC_SCANNER_DUPLICATE_PROVIDER':
        return new RemoteError('doc-scanner/duplicate-provider', error.message, { reason: error.code })
      case 'DOC_SCANNER_ATTACH_FAILED':
        return new RemoteError('doc-scanner/attach-failed', error.message, { reason: error.code })
      default:
        return new RemoteError('doc-scanner/failed', error.message, { reason: error.code })
    }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return new RemoteError('doc-scanner/failed', reason, { reason })
}

export type { DocScannerProviderId }
