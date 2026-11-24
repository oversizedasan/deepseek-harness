/** CZUR DocScannerProvider: Command WS capture plus Video WS preview. */
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  DocScannerError,
  ConnectionStateStore,
  isPreviewPhase,
  sleepUnlessAborted,
  DEFAULT_DOC_SCANNER_PROFILE,
  type DocScannerCaptureProfile,
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
  czurCaptureProfile,
  deviceOpened,
  parseDeviceList,
  pickCaptureAssets,
  type CzurCaptureAsset,
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
/** Minimum gap between capture.take calls on one device. The Runtime rejects a closer call with 1004. */
const CAPTURE_INTERVAL_MS = 1_500
/** Preview mode the device exposes as a full 4:3 frame. 1280×720 crops that frame to 16:9. */
const PREVIEW_WIDTH = 1536
const PREVIEW_HEIGHT = 1152
const PREVIEW_FPS = 30

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
  private readonly deliveredStills = new Set<string>()
  private readonly deliveringStills = new Set<string>()
  private activeProfile: DocScannerCaptureProfile = DEFAULT_DOC_SCANNER_PROFILE
  /** `Date.now()` when the last `capture.take` was started, including a hardware-triggered take. */
  private lastCaptureAt = 0
  private turnTaking = false
  /** True only after connect reaches ready, and false from the start of teardown. */
  private hardwareArmed = false

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
          await command.request('capture.set_turn_detect', {
            device_id: selected.device_id,
            enabled: true,
            auto_capture: false,
            scan_device_type: 0,
          })
        } catch (error) {
          // Turn-detect is best-effort; soft-fail keeps capture.take usable.
          void error
        }
      }
      this.hardwareArmed = true
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

  async capture(signal: AbortSignal, profile?: DocScannerCaptureProfile): Promise<DocScannerImageBytes> {
    signal.throwIfAborted()
    if (this.state.phase !== 'ready' || this.command === undefined || this.deviceId === undefined) {
      throw new DocScannerError('CZUR scanner is not ready', 'DOC_SCANNER_NOT_READY')
    }
    // Aura X / SDK Open finish capture.take only while a video stream is live
    // on this Command WS connection.
    if (profile !== undefined) this.activeProfile = profile
    await this.ensureVideo(this.command, this.deviceId, signal)
    const prior = this.state
    this.setState({ ...prior, phase: 'capturing' })
    this.lastCaptureAt = Date.now()
    try {
      const task = await this.takeCapture(signal)
      const images = await this.imagesFromTask(task, signal)
      this.pushStills(images.slice(1))
      return images[0]
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

  /**
   * Store the capture profile and push it to a running video stream.
   * @param profile - page treatment, color treatment, and optional selection.
   */
  async setCaptureProfile(profile: DocScannerCaptureProfile): Promise<void> {
    this.activeProfile = profile
    if (this.command === undefined || this.deviceId === undefined || this.video === undefined) return
    await this.command.request('video.set_profile', {
      device_id: this.deviceId,
      profile: czurCaptureProfile(profile),
    })
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
    if (event.event === 'capture.turn_detected') {
      this.captureFromTurn(event.payload)
      return
    }
    if (event.event === 'capture.hardgrab_detected') {
      this.captureFromHardgrab(event.payload)
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
        void this.deliverStill(task)
      }
    }
  }

  /**
   * Import a hardware-button still, or take one on this connection when the event has none.
   * An accepted task is followed and is not shot again. A rejected grab, a grab with no task,
   * a failed task, or a finished task with no still uses the page-turn shutter.
   * @param payload - `capture.hardgrab_detected` payload.
   */
  private captureFromHardgrab(payload: unknown): void {
    const record = payload !== null && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : undefined
    if (record?.accepted === false) {
      this.captureFromTurn(payload)
      return
    }
    const task = asCaptureTask(payload)
    if (task === undefined || task.status === 'failed') {
      this.captureFromTurn(payload)
      return
    }
    if (task.status === 'succeeded') {
      void this.deliverStill(task).then((delivered) => {
        if (!delivered) this.captureFromTurn(payload)
      })
      return
    }
    this.followHardgrab(task.task_id, payload)
  }

  /**
   * Poll one hardware-button task, then take on this connection if it yields no still.
   * @param taskId - task from `capture.hardgrab_detected`.
   * @param payload - original event payload, used when this connection must take.
   */
  private followHardgrab(taskId: string, payload: unknown): void {
    if (this.captureWaiters.has(taskId) || this.deliveredStills.has(taskId) || this.deliveringStills.has(taskId)) return
    const command = this.command
    if (command === undefined) {
      this.captureFromTurn(payload)
      return
    }
    void this.waitForCapture(command, taskId, AbortSignal.timeout(CAPTURE_TIMEOUT_MS))
      .then(async (task) => {
        const delivered = await this.deliverStill(task)
        if (!delivered) this.captureFromTurn(payload)
      })
      .catch((error: unknown) => {
        void error
        this.captureFromTurn(payload)
      })
  }

  /**
   * Take one still for a page turn or an unusable hardware-button notice on this connection.
   * The Runtime keeps turn `auto_capture` false, so that event has no image.
   * @param payload - event payload. A foreign `device_id` is ignored; a missing id is this device.
   */
  private captureFromTurn(payload: unknown): void {
    if (!this.hardwareArmed || this.options.autoCapture === false) return
    const record = payload !== null && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : undefined
    const eventDevice = typeof record?.device_id === 'string' ? record.device_id : undefined
    if (eventDevice !== undefined && eventDevice !== this.deviceId) return
    if (this.turnTaking || this.state.phase !== 'ready') return
    if (Date.now() - this.lastCaptureAt < CAPTURE_INTERVAL_MS) return
    const command = this.command
    const deviceId = this.deviceId
    if (this.stillListeners.size === 0 || command === undefined || deviceId === undefined) return
    void this.takeFromTurn(command, deviceId)
  }

  /**
   * Run one page-turn `capture.take` and push every page to still listeners.
   * @param command - Command connection that owns the device.
   * @param deviceId - device that reported the turn.
   */
  private async takeFromTurn(command: CzurCommandClient, deviceId: string): Promise<void> {
    this.turnTaking = true
    this.lastCaptureAt = Date.now()
    const prior = this.state
    this.setState({ ...prior, phase: 'capturing' })
    try {
      const signal = AbortSignal.timeout(CAPTURE_TIMEOUT_MS)
      await this.ensureVideo(command, deviceId, signal)
      const task = await this.takeCapture(signal)
      // The completion event can also reach subscribeStills once the waiter is gone.
      this.deliveredStills.add(task.task_id)
      const images = await this.imagesFromTask(task, signal)
      this.pushStills(images)
    } catch (error) {
      void error
    } finally {
      this.turnTaking = false
      const phase = this.snapshot().phase
      if (this.deviceId !== undefined && phase === 'capturing') this.setState(prior)
    }
  }

  /**
   * Push one finished task to still listeners.
   * @param task - capture snapshot that may still need an asset download.
   * @returns true when the still was pushed or is already being saved.
   */
  private async deliverStill(task: CzurCaptureTask): Promise<boolean> {
    if (this.stillListeners.size === 0) return false
    if (this.deliveredStills.has(task.task_id) || this.deliveringStills.has(task.task_id)) return true
    this.deliveringStills.add(task.task_id)
    try {
      const images = await this.imagesFromTask(task, AbortSignal.timeout(30_000))
      this.deliveredStills.add(task.task_id)
      this.pushStills(images)
      return true
    } catch (error) {
      void error
      return false
    } finally {
      this.deliveringStills.delete(task.task_id)
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
          profile: czurCaptureProfile(this.activeProfile),
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

  private pushStills(images: readonly DocScannerImageBytes[]): void {
    for (const image of images) {
      for (const listener of this.stillListeners) listener(image)
    }
  }

  private async imagesFromTask(
    task: CzurCaptureTask,
    signal: AbortSignal,
  ): Promise<[DocScannerImageBytes, ...DocScannerImageBytes[]]> {
    const assets = pickCaptureAssets(task.assets)
    if (assets.length === 0) {
      const inline = task.image_base64 ?? task.data_base64
      if (inline !== undefined && inline.length > 0) {
        return [this.imageFromBase64(task.task_id, inline, undefined, false)]
      }
      throw new DocScannerError('CZUR capture completed without image bytes', 'DOC_SCANNER_ATTACH_FAILED')
    }
    const paged = assets.length > 1
    const [first, ...rest] = assets
    const images: [DocScannerImageBytes, ...DocScannerImageBytes[]] = [
      await this.imageFromAsset(task, first, paged, signal),
    ]
    for (const asset of rest) images.push(await this.imageFromAsset(task, asset, paged, signal))
    return images
  }

  private async imageFromAsset(
    task: CzurCaptureTask,
    asset: CzurCaptureAsset,
    paged: boolean,
    signal: AbortSignal,
  ): Promise<DocScannerImageBytes> {
    const inline = asset.base64 ?? asset.data_base64
    if (inline !== undefined && inline.length > 0) {
      return this.imageFromBase64(task.task_id, inline, asset, paged)
    }
    const taskInline = task.image_base64 ?? task.data_base64
    if (!paged && taskInline !== undefined && taskInline.length > 0) {
      return this.imageFromBase64(task.task_id, taskInline, asset, false)
    }
    const url = asset.download_url ?? asset.url
    if (url === undefined) {
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
      name: this.stillName(task.task_id, asset.kind, paged),
    }
  }

  private imageFromBase64(
    taskId: string,
    inline: string,
    asset: CzurCaptureAsset | undefined,
    paged: boolean,
  ): DocScannerImageBytes {
    return {
      data: new Uint8Array(Buffer.from(inline, 'base64')),
      mimeType: mimeFromContentType(asset?.content_type),
      width: asset?.width ?? 1,
      height: asset?.height ?? 1,
      name: this.stillName(taskId, asset?.kind, paged),
    }
  }

  private stillName(taskId: string, kind: string | undefined, paged: boolean): string {
    const page = paged && kind !== undefined ? `-${kind}` : ''
    return `czur-capture-${taskId}${page}.jpg`
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
      data = await command.request('video.start', this.videoStartParams(deviceId))
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
      data = await command.request('video.start', this.videoStartParams(deviceId))
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

  private videoStartParams(deviceId: string): Record<string, unknown> {
    return {
      device_id: deviceId,
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      fps: PREVIEW_FPS,
      pixel_format: 'mjpeg',
      profile: czurCaptureProfile(this.activeProfile),
    }
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
    this.hardwareArmed = false
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
