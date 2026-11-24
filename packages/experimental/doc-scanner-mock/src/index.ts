/** Mock document-camera provider for connection-state and capture demos. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  DocScannerError,
  ConnectionStateStore,
  isPreviewPhase,
  sleepUnlessAborted,
  type DocScannerImageBytes,
  type DocScannerPreviewFrame,
  type DocScannerProvider,
  type DocScannerProviderId,
} from '@deepseek-ai/dsh-doc-scanner'
import type {} from '@deepseek-ai/dsh-doc-scanner'

export const name = 'doc-scanner-mock'
export const inject = ['docScanner']

/** 1×1 JPEG used only for demos; not a student paper. */
const MOCK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
  'base64',
)

const PROVIDER_ID = brandString<DocScannerProviderId>('mock-czur')
const CONNECT_DELAY_MS = 300
const CAPTURE_DELAY_MS = 150
/** ~4 fps mock viewfinder. */
const PREVIEW_INTERVAL_MS = 250

/** In-memory mock that reaches ready after a short delay and returns a fixed JPEG. */
export class MockDocScannerProvider extends ConnectionStateStore implements DocScannerProvider {
  readonly info = {
    id: PROVIDER_ID,
    name: 'Mock CZUR',
    kind: 'mock' as const,
  }


  async connect(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.setState({ phase: 'connecting', providerId: this.info.id })
    await sleepUnlessAborted(CONNECT_DELAY_MS, signal)
    this.setState({ phase: 'opening', providerId: this.info.id, displayName: 'Mock CZUR' })
    await sleepUnlessAborted(CONNECT_DELAY_MS, signal)
    this.setState({
      phase: 'ready',
      providerId: this.info.id,
      deviceId: 'mock-device-01',
      displayName: 'Mock CZUR',
    })
  }

  async capture(signal: AbortSignal): Promise<DocScannerImageBytes> {
    signal.throwIfAborted()
    if (this.state.phase !== 'ready') {
      throw new DocScannerError('Mock scanner is not ready', 'DOC_SCANNER_NOT_READY')
    }
    const prior = this.state
    this.setState({ ...prior, phase: 'capturing' })
    try {
      await sleepUnlessAborted(CAPTURE_DELAY_MS, signal)
      return {
        data: new Uint8Array(MOCK_JPEG),
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        name: 'mock-capture.jpg',
      }
    } finally {
      this.setState({
        phase: 'ready',
        providerId: this.info.id,
        deviceId: 'mock-device-01',
        displayName: 'Mock CZUR',
      })
    }
  }

  async *preview(signal: AbortSignal): AsyncIterable<DocScannerPreviewFrame> {
    signal.throwIfAborted()
    if (!isPreviewPhase(this.state.phase)) {
      throw new DocScannerError('Mock scanner is not ready to preview', 'DOC_SCANNER_NOT_READY')
    }
    while (!signal.aborted && isPreviewPhase(this.state.phase)) {
      yield {
        data: new Uint8Array(MOCK_JPEG),
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        ts: Date.now(),
      }
      try {
        await sleepUnlessAborted(PREVIEW_INTERVAL_MS, signal)
      } catch (error) {
        // Abort ends the preview loop; do not surface cancellation as a stream failure.
        void error
        break
      }
    }
  }

  close(): Promise<void> {
    this.setState({ phase: 'disconnected' })
    return Promise.resolve()
  }
}

/**
 * Register the mock document camera on `ctx.docScanner`.
 * @param ctx - Host composition with the scanner service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const provider = new MockDocScannerProvider()
    const dispose = ctx.docScanner.register(provider)
    return async () => { await dispose() }
  })
}
