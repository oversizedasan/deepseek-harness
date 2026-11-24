/** CZUR SDK Open Command WS JSON envelopes and capture asset helpers. */

/** Outbound Command WS request. */
export interface CzurRequest {
  readonly request_id: string
  readonly method: string
  readonly params?: Record<string, unknown>
  readonly client?: { readonly name?: string; readonly version?: string }
}

/** Inbound Command WS response for one request_id. */
export interface CzurResponse {
  readonly request_id: string
  readonly code: number
  readonly message: string
  readonly data?: unknown
  readonly ts?: number
}

/** Inbound Command WS push event (no request_id). */
export interface CzurEvent {
  readonly event: string
  readonly code?: number
  readonly message?: string
  readonly payload?: unknown
  readonly ts?: number
}

/** Rate-limited capture retry hint. */
export const CZUR_RATE_LIMITED = 1004
/** Device is mid-shutter. */
export const CZUR_DEVICE_BUSY = 1201

/** Minimal single-page JPG profile for DocScanner still capture. */
export const DEFAULT_CAPTURE_PROFILE = {
  profile_version: 'capture.profile.v1',
  revision: 1,
  capture: {
    page_processing: 'single_page',
    color_mode: 'auto_optimize',
    single_page: {
      realtime_detect_rects: false,
      auto_rotate: false,
      smart_black_edge_optimize: true,
      multi_target_paging: false,
    },
  },
  output: {
    format: 'jpg',
    quality: 90,
    thumbnails: {
      original: false,
      page_processed: false,
      color_processed: false,
      final: true,
    },
  },
} as const

/** One entry from `device.list`. */
export interface CzurDeviceSummary {
  readonly device_id: string
  readonly name?: string
  readonly display_name?: string
  readonly model?: string
}

/** Asset row on a capture task snapshot. */
export interface CzurCaptureAsset {
  readonly asset_id: string
  readonly kind: string
  readonly path?: string
  readonly url?: string
  readonly download_url?: string
  readonly content_type?: string
  readonly width?: number
  readonly height?: number
  readonly size?: number
  readonly base64?: string
  readonly data_base64?: string
}

/** Capture task snapshot from events or `capture.get`. */
export interface CzurCaptureTask {
  readonly task_id: string
  readonly status: string
  readonly device_id?: string
  readonly assets?: readonly CzurCaptureAsset[]
  readonly error?: string
  /** Present when `include_base64: true` embeds still bytes on the task. */
  readonly image_base64?: string
  readonly data_base64?: string
}

/**
 * Narrow an unknown JSON value to a Command response.
 * @param value - parsed WebSocket text.
 * @returns the response, or `undefined` for a push event or a value missing a string `request_id`, numeric `code`, or string `message`.
 */
export function asCzurResponse(value: unknown): CzurResponse | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  // Push events may also carry code/message; never treat them as RPC replies.
  if (typeof record.event === 'string') return undefined
  if (typeof record.request_id !== 'string' || typeof record.code !== 'number' || typeof record.message !== 'string') {
    return undefined
  }
  return {
    request_id: record.request_id,
    code: record.code,
    message: record.message,
    ...record.data === undefined ? {} : { data: record.data },
    ...typeof record.ts === 'number' ? { ts: record.ts } : {},
  }
}

/**
 * Narrow an unknown JSON value to a Command push event.
 * @param value - parsed WebSocket text.
 * @returns the event, or `undefined` when the value is not an object with a string `event`.
 */
export function asCzurEvent(value: unknown): CzurEvent | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.event !== 'string') return undefined
  return {
    event: record.event,
    ...typeof record.code === 'number' ? { code: record.code } : {},
    ...typeof record.message === 'string' ? { message: record.message } : {},
    ...record.payload === undefined ? {} : { payload: record.payload },
    ...typeof record.ts === 'number' ? { ts: record.ts } : {},
  }
}

/**
 * Read device summaries from `device.list` data.
 * @param data - response data field.
 * @returns summaries for entries with a non-empty string `device_id`, read from `devices`, `items`, or a top-level array;
 *   empty when none match.
 */
export function parseDeviceList(data: unknown): CzurDeviceSummary[] {
  if (data === null || typeof data !== 'object') return []
  const record = data as Record<string, unknown>
  const raw = Array.isArray(record.devices) ? record.devices
    : Array.isArray(record.items) ? record.items
      : Array.isArray(data) ? data
        : []
  const devices: CzurDeviceSummary[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    if (typeof row.device_id !== 'string' || row.device_id.length === 0) continue
    devices.push({
      device_id: row.device_id,
      ...typeof row.name === 'string' ? { name: row.name } : {},
      ...typeof row.display_name === 'string' ? { display_name: row.display_name } : {},
      ...typeof row.model === 'string' ? { model: row.model } : {},
    })
  }
  return devices
}

/**
 * Whether `device.open` reported success.
 * @param data - response data field.
 * @returns `true` when `opened` is `true` or `status` or `state` is `'opened'`.
 */
export function deviceOpened(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.opened === true || record.status === 'opened' || record.state === 'opened'
}

/**
 * Prefer final still asset, else original.
 * @param assets - capture task assets.
 * @returns the `final` asset, else the `original` asset, else the first asset; `undefined` when there are none.
 */
export function pickCaptureAsset(assets: readonly CzurCaptureAsset[] | undefined): CzurCaptureAsset | undefined {
  if (assets === undefined || assets.length === 0) return undefined
  return assets.find(asset => asset.kind === 'final')
    ?? assets.find(asset => asset.kind === 'original')
    ?? assets[0]
}

/**
 * Narrow a capture event payload or `capture.get` data into a task snapshot.
 * @param value - event payload or response data.
 * @returns the task, or `undefined` when no string `task_id` is found at the top level or under `task`.
 */
export function asCaptureTask(value: unknown): CzurCaptureTask | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const taskId = typeof record.task_id === 'string' ? record.task_id
    : typeof (record.task as { task_id?: unknown } | undefined)?.task_id === 'string'
      ? (record.task as { task_id: string }).task_id
      : undefined
  if (taskId === undefined) return undefined
  const nested = record.task !== null && typeof record.task === 'object'
    ? record.task as Record<string, unknown>
    : record
  const assetsRaw = Array.isArray(nested.assets) ? nested.assets : []
  const assets: CzurCaptureAsset[] = []
  for (const entry of assetsRaw) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    if (typeof row.asset_id !== 'string' || typeof row.kind !== 'string') continue
    assets.push({
      asset_id: row.asset_id,
      kind: row.kind,
      ...typeof row.path === 'string' ? { path: row.path } : {},
      ...typeof row.url === 'string' ? { url: row.url } : {},
      ...typeof row.download_url === 'string' ? { download_url: row.download_url } : {},
      ...typeof row.content_type === 'string' ? { content_type: row.content_type } : {},
      ...typeof row.width === 'number' ? { width: row.width } : {},
      ...typeof row.height === 'number' ? { height: row.height } : {},
      ...typeof row.size === 'number' ? { size: row.size } : {},
      ...typeof row.base64 === 'string' ? { base64: row.base64 } : {},
      ...typeof row.data_base64 === 'string' ? { data_base64: row.data_base64 } : {},
    })
  }
  return {
    task_id: taskId,
    status: typeof nested.status === 'string' ? nested.status : 'unknown',
    ...typeof nested.device_id === 'string' ? { device_id: nested.device_id } : {},
    ...assets.length > 0 ? { assets } : {},
    ...typeof nested.error === 'string' ? { error: nested.error } : {},
    ...typeof nested.image_base64 === 'string' ? { image_base64: nested.image_base64 } : {},
    ...typeof nested.data_base64 === 'string' ? { data_base64: nested.data_base64 } : {},
  }
}
