/** CZUR DocScannerProvider: Command WS capture plus Video WS preview. */
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
import { CzurCommandClient, CzurCommandError } from './command-client.ts'
import {
  asCaptureTask,
  CZUR_DEVICE_BUSY,
  CZUR_RATE_LIMITED,
  DEFAULT_CAPTURE_PROFILE,
  deviceOpened,
  parseDeviceList,
  pickCaptureAsset,
  type CzurCaptureTask,
  type CzurDeviceSummary,
  type CzurEvent,
} from './protocol.ts'
import { deriveVideoWsBaseUrl, downloadBytes, videoWsUrl } from './urls.ts'
import { CzurVideoClient } from './video-client.ts'
import type { CzurWebSocketConstructor } from './websocket.ts'

const PROVIDER_ID = brandString<DocScannerProviderId>('czur')
const DEVICE_BUSY_RETRY_MS = 200
/** Real CZUR page-process pipelines often exceed 20s before `capture.completed`. */
const CAPTURE_TIMEOUT_MS = 90_000

/** Construction options for the CZUR provider. */
export interface CzurDocScannerProviderOptions {
  readonly commandWsUrl: string
  readonly videoWsBaseUrl?: string | undefined
  readonly preferredDeviceId?: string | undefined
  readonly allowInsecureTls: boolean
  /**
   * When true, enable turn detection after `device.open` so hardware hardgrab
   * / page-turn stills push through {@link CzurDocScannerProvider.subscribeStills}.
   */
  readonly autoCapture?: boolean
  /**
   * Resolve the API token for `auth.create_session` on each connect.
   * Missing / empty token fails connect with error phase.
   */
  readonly resolveToken: () => Promise<string | undefined>
  readonly WebSocketImpl?: CzurWebSocketConstructor
}

/**
 * Host-local CZUR SDK Open provider.
 * Registers on `ctx.docScanner`; never opens sockets from the browser.
 */
export class CzurDocScannerProvider extends ConnectionStateStore implements DocScannerProvider {
  readonly info = {
    id: PROVIDER_ID,
    name: 'CZUR',
    kind: 'czur' as const,
  }

  private readonly options: CzurDocScannerProviderOptions
  private command: CzurCommandClient | undefined
  private video: CzurVideoClient | undefined
  private deviceId: string | undefined
  private displayName: string | undefined
  /** Connection-bound token from `auth.create_session`; required for Asset HTTP(S). */
  private sessionToken: string | undefined
  private streamId: string | undefined
  private videoStarting: Promise<CzurVideoClient> | undefined
  private readonly captureWaiters = new Map<string, {
    resolve: (task: CzurCaptureTask) => void
    reject: (error: Error) => void
  }>()
  private readonly stillListeners = new Set<(image: DocScannerImageBytes) => void>()

  constructor(options: CzurDocScannerProviderOptions) {
    super()
    this.options = options
  }

  /**
   * Observe hardware stills that were not requested by {@link capture} (hardgrab / turn detect).
   * @param listener - receives decoded still bytes.
   */
  subscribeStills(listener: (image: DocScannerImageBytes) => void): () => void {
    this.stillListeners.add(listener)
    return () => { this.stillListeners.delete(listener) }
  }

  async connect(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.teardownSession()
    this.setState({ phase: 'connecting', providerId: this.info.id })
    const token = await this.options.resolveToken()
    if (token === undefined || token.length === 0) {
      this.setState({
        phase: 'error',
        providerId: this.info.id,
        message: 'CZUR API token is not configured (set credentialRef or CZUR_API_KEY)',
      })
      return
    }
    const command = new CzurCommandClient({
      url: this.options.commandWsUrl,
      allowInsecureTls: this.options.allowInsecureTls,
      ...this.options.WebSocketImpl === undefined ? {} : { WebSocketImpl: this.options.WebSocketImpl },
      onEvent: (event) => { this.handleEvent(event) },
      onClose: () => {
        if (this.state.phase === 'disconnected' || this.state.phase === 'device_missing') return
        if (this.state.phase === 'error') return
        this.setState({
          phase: 'error',
          providerId: this.info.id,
          message: 'CZUR Command WS closed unexpectedly',
          ...this.deviceId === undefined ? {} : { deviceId: this.deviceId },
          ...this.displayName === undefined ? {} : { displayName: this.displayName },
        })
      },
    })
    this.command = command
    try {
      await command.connect(signal)
      const sessionData = await command.request('auth.create_session', { token })
      const sessionRecord = sessionData !== null && typeof sessionData === 'object'
        ? sessionData as Record<string, unknown>
        : undefined
      const sessionToken = typeof sessionRecord?.session_token === 'string'
        ? sessionRecord.session_token
        : undefined
      if (sessionToken === undefined || sessionToken.length === 0) {
        throw new Error('CZUR auth.create_session did not return session_token')
      }
      this.sessionToken = sessionToken
      const listData = await command.request('device.list', {})
      const devices = parseDeviceList(listData)
      const [firstDevice, ...otherDevices] = devices
      if (firstDevice === undefined) {
        this.setState({ phase: 'device_missing', providerId: this.info.id, message: 'No CZUR device is connected' })
        return
      }
      const preferred = this.options.preferredDeviceId
      const selected = preferred === undefined
        ? pickPreferredDevice(firstDevice, otherDevices)
        : devices.find(device => device.device_id === preferred) ?? pickPreferredDevice(firstDevice, otherDevices)
      this.deviceId = selected.device_id
      this.displayName = selected.display_name ?? selected.name ?? selected.model ?? 'CZUR'
      this.setState({
        phase: 'opening',
        providerId: this.info.id,
        deviceId: this.deviceId,
        displayName: this.displayName,
      })
      const openData = await command.request('device.open', { device_id: selected.device_id })
      if (!deviceOpened(openData) && openData !== undefined && openData !== null) {
        // Some Runtimes return empty data on success; only fail when opened is explicitly false.
        const record = openData as Record<string, unknown>
        if (record.opened === false) {
          throw new Error('CZUR device.open did not report opened')
        }
      }
      if (this.options.autoCapture !== false) {
        try {
          await command.request('device.set_turn_detect', {
            device_id: selected.device_id,
            enabled: true,
          })
        } catch (error) {
          // Turn-detect is best-effort; soft-fail keeps capture.take usable.
          void error
        }
      }
      this.setState({
        phase: 'ready',
        providerId: this.info.id,
        deviceId: this.deviceId,
        displayName: this.displayName,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.teardownSession()
      this.setState({ phase: 'error', providerId: this.info.id, message })
      if (signal.aborted) throw error
    }
  }

  async capture(signal: AbortSignal): Promise<DocScannerImageBytes> {
    signal.throwIfAborted()
    if (this.state.phase !== 'ready' || this.command === undefined || this.deviceId === undefined) {
      throw new DocScannerError('CZUR scanner is not ready', 'DOC_SCANNER_NOT_READY')
    }
    // Aura X / SDK Open finish capture.take only while a video stream is live
    // on this Command WS connection.
    await this.ensureVideo(this.command, this.deviceId, signal)
    const prior = this.state
    this.setState({ ...prior, phase: 'capturing' })
    try {
      const task = await this.takeCapture(signal)
      return await this.imageFromTask(task, signal)
    } finally {
      const phase = this.snapshot().phase
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can clear the device while capture awaits
      if (this.deviceId !== undefined && phase === 'capturing') this.setState(prior)
    }
  }

  async *preview(signal: AbortSignal): AsyncIterable<DocScannerPreviewFrame> {
    signal.throwIfAborted()
    const command = this.command
    const deviceId = this.deviceId
    if (!isPreviewPhase(this.state.phase) || command === undefined || deviceId === undefined) {
      throw new DocScannerError('CZUR scanner is not ready to preview', 'DOC_SCANNER_NOT_READY')
    }
    const video = await this.ensureVideo(command, deviceId, signal)
    try {
      for await (const frame of video.frames(signal)) {
        if (!isPreviewPhase(this.state.phase)) break
        yield frame
      }
    } catch (error) {
      if (signal.aborted) return
      throw error
    }
  }

  async close(): Promise<void> {
    await this.teardownSession()
    this.setState({ phase: 'disconnected' })
  }

  private handleEvent(event: CzurEvent): void {
    if (event.event === 'device.removed') {
      const payload = event.payload !== null && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown>
        : undefined
      const removedId = typeof payload?.device_id === 'string' ? payload.device_id : this.deviceId
      if (removedId !== undefined && removedId === this.deviceId) {
        void this.stopVideo()
        this.deviceId = undefined
        this.setState({
          phase: 'device_missing',
          providerId: this.info.id,
          message: 'CZUR device was removed',
        })
      }
      return
    }
    if (
      event.event === 'capture.completed'
      || event.event === 'capture.failed'
      || event.event === 'capture.hardgrab'
      || event.event === 'hardgrab.completed'
    ) {
      const task = asCaptureTask(event.payload)
      if (task === undefined) return
      const waiter = this.captureWaiters.get(task.task_id)
      if (waiter !== undefined) {
        this.captureWaiters.delete(task.task_id)
        if (event.event === 'capture.failed' || task.status === 'failed') {
          waiter.reject(new Error(task.error || 'CZUR capture failed'))
        } else {
          waiter.resolve(task)
        }
        return
      }
      // Hardware hardgrab / turn-detect still with no matching capture.take waiter.
      if (event.event !== 'capture.failed' && task.status !== 'failed') {
        void this.pushStillFromTask(task)
      }
    }
  }

  private async pushStillFromTask(task: CzurCaptureTask): Promise<void> {
    if (this.stillListeners.size === 0) return
    try {
      const image = await this.imageFromTask(task, AbortSignal.timeout(30_000))
      for (const listener of this.stillListeners) listener(image)
    } catch (error) {
      void error
    }
  }

  private async takeCapture(signal: AbortSignal): Promise<CzurCaptureTask> {
    const command = this.command
    const deviceId = this.deviceId
    if (command === undefined || deviceId === undefined) {
      throw new DocScannerError('CZUR scanner is not ready', 'DOC_SCANNER_NOT_READY')
    }
    let attempt = 0
    while (true) {
      signal.throwIfAborted()
      attempt += 1
      try {
        const data = await command.request('capture.take', {
          device_id: deviceId,
          profile: DEFAULT_CAPTURE_PROFILE,
          include_base64: true,
          timeout_ms: CAPTURE_TIMEOUT_MS,
        }, CAPTURE_TIMEOUT_MS + 5_000)
        const accepted = data !== null && typeof data === 'object'
          ? data as Record<string, unknown>
          : undefined
        const taskId = typeof accepted?.task_id === 'string' ? accepted.task_id : undefined
        if (taskId === undefined) {
          throw new Error('CZUR capture.take did not return task_id')
        }
        return await this.waitForCapture(command, taskId, signal)
      } catch (error) {
        if (!(error instanceof CzurCommandError) || attempt > 2) throw error
        if (error.code === CZUR_RATE_LIMITED) {
          const retryAfter = retryAfterMs(error.data) ?? 1_500
          await sleepUnlessAborted(retryAfter, signal)
          continue
        }
        if (error.code === CZUR_DEVICE_BUSY) {
          await sleepUnlessAborted(DEVICE_BUSY_RETRY_MS, signal)
          continue
        }
        throw error
      }
    }
  }

  private waitForCapture(command: CzurCommandClient, taskId: string, signal: AbortSignal): Promise<CzurCaptureTask> {
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.captureWaiters.delete(taskId)
        reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.captureWaiters.set(taskId, {
        resolve: (task) => {
          signal.removeEventListener('abort', onAbort)
          resolve(task)
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
      // Fallback poll in case the Runtime skips push events.
      void this.pollCapture(command, taskId, signal).then((task) => {
        const waiter = this.captureWaiters.get(taskId)
        if (waiter === undefined) return
        this.captureWaiters.delete(taskId)
        signal.removeEventListener('abort', onAbort)
        if (task.status === 'failed') waiter.reject(new Error(task.error || 'CZUR capture failed'))
        else waiter.resolve(task)
      }, (error: unknown) => {
        // Poll failures are ignored while the event waiter is still live.
        void error
      })
    })
  }

  private async pollCapture(command: CzurCommandClient, taskId: string, signal: AbortSignal): Promise<CzurCaptureTask> {
    const deadline = Date.now() + CAPTURE_TIMEOUT_MS
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      if (!this.captureWaiters.has(taskId)) {
        throw new Error('Capture waiter cleared')
      }
      try {
        const data = await command.request('capture.get', { task_id: taskId }, 5_000)
        const task = asCaptureTask(data)
        if (task !== undefined && (task.status === 'succeeded' || task.status === 'failed')) {
          return task
        }
      } catch (error) {
        void error
      }
      await sleepUnlessAborted(200, signal)
    }
    throw new Error(`CZUR capture timed out for task ${taskId}`)
  }

  private async imageFromTask(task: CzurCaptureTask, signal: AbortSignal): Promise<DocScannerImageBytes> {
    const inline = task.image_base64 ?? task.data_base64
      ?? pickCaptureAsset(task.assets)?.base64
      ?? pickCaptureAsset(task.assets)?.data_base64
    if (inline !== undefined && inline.length > 0) {
      const data = Buffer.from(inline, 'base64')
      const asset = pickCaptureAsset(task.assets)
      return {
        data: new Uint8Array(data),
        mimeType: mimeFromContentType(asset?.content_type),
        width: asset?.width ?? 1,
        height: asset?.height ?? 1,
        name: `czur-capture-${task.task_id}.jpg`,
      }
    }
    const asset = pickCaptureAsset(task.assets)
    const url = asset?.download_url ?? asset?.url
    if (asset === undefined || url === undefined) {
      throw new DocScannerError('CZUR capture completed without image bytes', 'DOC_SCANNER_ATTACH_FAILED')
    }
    const sessionToken = this.sessionToken
    if (sessionToken === undefined || sessionToken.length === 0) {
      throw new DocScannerError(
        'CZUR session token is missing; reconnect the document camera',
        'DOC_SCANNER_NOT_READY',
      )
    }
    let data: Uint8Array
    try {
      data = await downloadBytes(url, {
        allowInsecureTls: this.options.allowInsecureTls,
        authorizationBearer: sessionToken,
        signal,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new DocScannerError(
        `CZUR asset download failed: ${detail}`,
        'DOC_SCANNER_ATTACH_FAILED',
        { cause: error },
      )
    }
    return {
      data,
      mimeType: mimeFromContentType(asset.content_type),
      width: asset.width ?? 1,
      height: asset.height ?? 1,
      name: `czur-capture-${task.task_id}.jpg`,
    }
  }

  private async ensureVideo(command: CzurCommandClient, deviceId: string, signal: AbortSignal): Promise<CzurVideoClient> {
    if (this.video !== undefined) return this.video
    if (this.videoStarting !== undefined) return await this.videoStarting
    const run = this.startVideo(command, deviceId, signal)
    this.videoStarting = run
    try {
      return await run
    } finally {
      this.videoStarting = undefined
    }
  }

  private async startVideo(command: CzurCommandClient, deviceId: string, signal: AbortSignal): Promise<CzurVideoClient> {
    let data: unknown
    try {
      data = await command.request('video.start', {
        device_id: deviceId,
        width: 1280,
        height: 720,
        fps: 10,
        pixel_format: 'mjpeg',
      })
    } catch (error) {
      // Another connection may still own the stream; stop and retry once on this session.
      if (!(error instanceof CzurCommandError) || !/already streaming/i.test(error.message)) {
        throw error
      }
      try {
        await command.request('video.stop', { device_id: deviceId }, 5_000)
      } catch (stopError) {
        void stopError
      }
      data = await command.request('video.start', {
        device_id: deviceId,
        width: 1280,
        height: 720,
        fps: 10,
        pixel_format: 'mjpeg',
      })
    }
    const record = data !== null && typeof data === 'object' ? data as Record<string, unknown> : undefined
    const streamId = typeof record?.stream_id === 'string' ? record.stream_id : undefined
    const sessionToken = typeof record?.session_token === 'string' ? record.session_token : undefined
    if (streamId === undefined || sessionToken === undefined) {
      throw new Error('CZUR video.start did not return stream_id and session_token')
    }
    this.streamId = streamId
    const base = this.options.videoWsBaseUrl ?? deriveVideoWsBaseUrl(this.options.commandWsUrl)
    if (base === undefined) {
      throw new Error('CZUR video WebSocket base URL could not be derived; set videoWsBaseUrl')
    }
    const video = new CzurVideoClient({
      url: videoWsUrl(base, sessionToken, streamId),
      allowInsecureTls: this.options.allowInsecureTls,
      ...this.options.WebSocketImpl === undefined ? {} : { WebSocketImpl: this.options.WebSocketImpl },
    })
    await video.connect(signal)
    this.video = video
    return video
  }

  private async stopVideo(): Promise<void> {
    const streamId = this.streamId
    const deviceId = this.deviceId
    this.video?.close()
    this.video = undefined
    this.streamId = undefined
    if (this.command === undefined || streamId === undefined) return
    try {
      await this.command.request('video.stop', {
        stream_id: streamId,
        ...deviceId === undefined ? {} : { device_id: deviceId },
      }, 5_000)
    } catch (error) {
      void error
    }
  }

  private async teardownSession(): Promise<void> {
    for (const [id, waiter] of this.captureWaiters) {
      this.captureWaiters.delete(id)
      waiter.reject(new Error('CZUR session closed'))
    }
    await this.stopVideo()
    const deviceId = this.deviceId
    if (this.command !== undefined && deviceId !== undefined) {
      try {
        await this.command.request('device.close', { device_id: deviceId }, 5_000)
      } catch (error) {
        void error
      }
    }
    this.command?.close()
    this.command = undefined
    this.deviceId = undefined
    this.displayName = undefined
    this.sessionToken = undefined
  }
}

function retryAfterMs(data: unknown): number | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>).retry_after_ms
  return typeof value === 'number' && value >= 0 ? value : undefined
}

/**
 * Prefer a document-camera style device over built-in FaceTime / Continuity cameras.
 * @param first - first `device.list` summary; wins ties.
 * @param rest - remaining `device.list` summaries in list order.
 */
function pickPreferredDevice(first: CzurDeviceSummary, rest: readonly CzurDeviceSummary[]): CzurDeviceSummary {
  const score = (device: CzurDeviceSummary): number => {
    const label = `${device.display_name ?? ''} ${device.name ?? ''} ${device.model ?? ''} ${device.device_id}`.toLowerCase()
    if (/facetime|iphone|continuity|webcam/.test(label)) return 0
    if (/czur|aura|et\d|scanner|高拍/.test(label)) return 2
    if (device.device_id.includes(':')) return 1
    return 0
  }
  let best = first
  let bestScore = score(first)
  for (const device of rest) {
    const next = score(device)
    if (next > bestScore) {
      best = device
      bestScore = next
    }
  }
  return best
}

function mimeFromContentType(contentType: string | undefined): 'image/jpeg' | 'image/png' {
  if (contentType !== undefined && contentType.includes('png')) return 'image/png'
  return 'image/jpeg'
}
