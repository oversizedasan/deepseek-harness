/** CZUR SDK Open Command WS JSON envelopes and capture asset helpers. */
import type { DocScannerCaptureProfile, DocScannerFrameRect } from '@deepseek-ai/dsh-doc-scanner'

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

/**
 * Build the CZUR `CaptureProfile` for one scanner profile.
 * Single-page profiles request realtime detection boxes. A missing selection
 * keeps `selected_area` from being sent and falls back to single-page detection.
 * @param profile - page treatment, color treatment, and optional selection.
 * @returns the profile object passed to `video.start`, `video.set_profile`, and `capture.take`.
 */
export function czurCaptureProfile(profile: DocScannerCaptureProfile): Record<string, unknown> {
  const pageProcessing = profile.pageProcessing === 'selected_area' && profile.selection === undefined
    ? 'single_page'
    : profile.pageProcessing
  const capture: Record<string, unknown> = {
    page_processing: pageProcessing,
    color_mode: profile.colorMode,
  }
  if (pageProcessing === 'single_page') {
    capture.single_page = {
      realtime_detect_rects: true,
      auto_rotate: false,
      smart_black_edge_optimize: true,
      multi_target_paging: false,
    }
  }
  if (pageProcessing === 'curved_book') {
    capture.curved_book = {
      remove_finger: { enabled: true, finger_type: 'with_sleeve' },
      smart_paging: true,
    }
  }
  if (pageProcessing === 'selected_area' && profile.selection !== undefined) {
    const { x, y, width, height, sourceWidth, sourceHeight } = profile.selection
    capture.selected_area = {
      points: {
        left_top: { x, y },
        right_top: { x: x + width, y },
        right_down: { x: x + width, y: y + height },
        left_down: { x, y: y + height },
      },
      source: { width: sourceWidth, height: sourceHeight },
    }
  }
  return {
    profile_version: 'capture.profile.v1',
    revision: 1,
    capture,
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
  }
}

/**
 * Read detection boxes from a `stream.frame_meta` payload.
 * Accepts `{x,y,width,height}`, `{left,top,width,height}`, `{left,top,right,bottom}`,
 * and `left_top` / `right_top` / `right_down` / `left_down` as `{x,y}` or `[x,y]`,
 * either on the rect or under `points`. Four corners are kept on `corners`;
 * two corners become an axis-aligned box only.
 * @param value - `detected_rects` field, or the whole payload.
 * @returns boxes with positive width and height; an empty list when none parse.
 */
export function parseDetectedRects(value: unknown): DocScannerFrameRect[] {
  const list = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as { detected_rects?: unknown }).detected_rects)
      ? (value as { detected_rects: unknown[] }).detected_rects
      : []
  const rects: DocScannerFrameRect[] = []
  for (const entry of list) {
    const rect = oneDetectedRect(entry)
    if (rect !== undefined) rects.push(rect)
  }
  return rects
}

function oneDetectedRect(entry: unknown): DocScannerFrameRect | undefined {
  if (entry === null || typeof entry !== 'object') return undefined
  const record = entry as Record<string, unknown>
  const points = record.points
  const box = points !== null && typeof points === 'object' ? points as Record<string, unknown> : record
  const quad = quadOf(box)
  if (quad !== undefined) return quad
  const topLeft = pointOf(box.left_top)
  const bottomRight = pointOf(box.right_down)
  if (topLeft !== undefined && bottomRight !== undefined) {
    return positiveRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
  }
  const x = numberOf(record.x) ?? numberOf(record.left)
  const y = numberOf(record.y) ?? numberOf(record.top)
  if (x === undefined || y === undefined) return undefined
  const right = numberOf(record.right)
  const bottom = numberOf(record.bottom)
  const width = numberOf(record.width) ?? (right === undefined ? undefined : right - x)
  const height = numberOf(record.height) ?? (bottom === undefined ? undefined : bottom - y)
  if (width === undefined || height === undefined) return undefined
  return positiveRect(x, y, width, height)
}

function pointOf(value: unknown): { x: number; y: number } | undefined {
  if (Array.isArray(value)) {
    const x = numberOf(value[0])
    const y = numberOf(value[1])
    if (x === undefined || y === undefined) return undefined
    return { x, y }
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const x = numberOf(record.x)
  const y = numberOf(record.y)
  if (x === undefined || y === undefined) return undefined
  return { x, y }
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function quadOf(box: Record<string, unknown>): DocScannerFrameRect | undefined {
  const leftTop = pointOf(box.left_top)
  const rightTop = pointOf(box.right_top)
  const rightDown = pointOf(box.right_down)
  const leftDown = pointOf(box.left_down)
  if (leftTop === undefined || rightTop === undefined || rightDown === undefined || leftDown === undefined) return undefined
  const x = Math.min(leftTop.x, rightTop.x, rightDown.x, leftDown.x)
  const y = Math.min(leftTop.y, rightTop.y, rightDown.y, leftDown.y)
  const width = Math.max(leftTop.x, rightTop.x, rightDown.x, leftDown.x) - x
  const height = Math.max(leftTop.y, rightTop.y, rightDown.y, leftDown.y) - y
  const rect = positiveRect(x, y, width, height)
  if (rect === undefined) return undefined
  return { ...rect, corners: { leftTop, rightTop, rightDown, leftDown } }
}

function positiveRect(x: number, y: number, width: number, height: number): DocScannerFrameRect | undefined {
  if (width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

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
 * Whether this asset is a finished page, including curved-book `final_left` / `final_right`.
 * Thumbnails such as `final_thumbnail_left` are not pages.
 * @param kind - asset kind from the capture task.
 * @returns `true` for `final` and `final_*` page kinds.
 */
function isFinalPage(kind: string): boolean {
  return kind === 'final' || (kind.startsWith('final_') && !kind.startsWith('final_thumbnail'))
}

/**
 * Finished page assets for one capture, in task order.
 * A curved-book capture with smart paging has `final_left` and `final_right` and no plain `final`.
 * When no finished page is present, the list is the `original` asset, else the first asset.
 * @param assets - capture task assets.
 * @returns the pages to keep; an empty list when there are no assets.
 */
export function pickCaptureAssets(assets: readonly CzurCaptureAsset[] | undefined): CzurCaptureAsset[] {
  if (assets === undefined || assets.length === 0) return []
  const pages = assets.filter(asset => isFinalPage(asset.kind))
  if (pages.length > 0) return pages
  const original = assets.find(asset => asset.kind === 'original')
  return [original ?? assets[0]]
}

/**
 * Prefer a finished page asset, else original.
 * @param assets - capture task assets.
 * @returns the first {@link pickCaptureAssets} entry; `undefined` when there are none.
 */
export function pickCaptureAsset(assets: readonly CzurCaptureAsset[] | undefined): CzurCaptureAsset | undefined {
  return pickCaptureAssets(assets)[0]
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
