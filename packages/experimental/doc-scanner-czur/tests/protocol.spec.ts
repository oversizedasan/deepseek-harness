/** CZUR Command WS envelope narrowing, device parsing, and capture task normalization. */
import { describe, expect, it } from 'vitest'
import {
  asCaptureTask,
  asCzurEvent,
  asCzurResponse,
  czurCaptureProfile,
  deviceOpened,
  parseDetectedRects,
  parseDeviceList,
  pickCaptureAsset,
  pickCaptureAssets,
} from '../src/protocol.ts'

describe('asCzurResponse', () => {
  it.each([null, 'text', 7, undefined])('rejects the non-object value %j', (value) => {
    expect(asCzurResponse(value)).toBeUndefined()
  })

  it('never treats a push event that carries request_id, code, and message as a reply', () => {
    expect(asCzurResponse({ event: 'capture.completed', request_id: 'r', code: 0, message: 'ok' })).toBeUndefined()
  })

  it.each([
    { code: 0, message: 'ok' },
    { request_id: 1, code: 0, message: 'ok' },
    { request_id: 'r', code: '0', message: 'ok' },
    { request_id: 'r', code: 0, message: 3 },
  ])('rejects a reply with a missing or mistyped field: %j', (value) => {
    expect(asCzurResponse(value)).toBeUndefined()
  })

  it('keeps data and ts only when present with the right type', () => {
    expect(asCzurResponse({ request_id: 'r', code: 0, message: 'ok', data: { a: 1 }, ts: 5 })).toEqual({
      request_id: 'r',
      code: 0,
      message: 'ok',
      data: { a: 1 },
      ts: 5,
    })
    expect(asCzurResponse({ request_id: 'r', code: 3, message: 'bad', ts: 'soon' })).toEqual({
      request_id: 'r',
      code: 3,
      message: 'bad',
    })
  })
})

describe('asCzurEvent', () => {
  it.each([null, 'text', 7])('rejects the non-object value %j', (value) => {
    expect(asCzurEvent(value)).toBeUndefined()
  })

  it('rejects an object without a string event name', () => {
    expect(asCzurEvent({ event: 4 })).toBeUndefined()
    expect(asCzurEvent({ code: 0 })).toBeUndefined()
  })

  it('keeps optional fields only when they have the right type', () => {
    expect(asCzurEvent({ event: 'e', code: 0, message: 'm', payload: { x: 1 }, ts: 9 })).toEqual({
      event: 'e',
      code: 0,
      message: 'm',
      payload: { x: 1 },
      ts: 9,
    })
    expect(asCzurEvent({ event: 'e', code: '0', message: 1, ts: 'x' })).toEqual({ event: 'e' })
  })
})

describe('parseDeviceList', () => {
  it.each([null, 'devices', 3])('returns no devices for the non-object value %j', (value) => {
    expect(parseDeviceList(value)).toEqual([])
  })

  it('reads the devices, items, or bare-array list forms', () => {
    const row = { device_id: 'a', name: 'n', display_name: 'd', model: 'm' }
    expect(parseDeviceList({ devices: [row] })).toEqual([row])
    expect(parseDeviceList({ items: [row] })).toEqual([row])
    expect(parseDeviceList([row])).toEqual([row])
    expect(parseDeviceList({ other: [row] })).toEqual([])
  })

  it('skips malformed entries and drops mistyped optional labels', () => {
    expect(parseDeviceList({
      devices: [
        null,
        'a',
        { name: 'no id' },
        { device_id: '' },
        { device_id: 'ok', name: 4, display_name: 5, model: 6 },
      ],
    })).toEqual([{ device_id: 'ok' }])
  })
})

describe('deviceOpened', () => {
  it('accepts opened true, status opened, or state opened', () => {
    expect(deviceOpened({ opened: true })).toBe(true)
    expect(deviceOpened({ status: 'opened' })).toBe(true)
    expect(deviceOpened({ state: 'opened' })).toBe(true)
  })

  it('rejects everything else', () => {
    expect(deviceOpened(null)).toBe(false)
    expect(deviceOpened('opened')).toBe(false)
    expect(deviceOpened({ opened: false, status: 'closed', state: 'closed' })).toBe(false)
  })
})

describe('pickCaptureAsset', () => {
  const original = { asset_id: 'o', kind: 'original' }
  const final = { asset_id: 'f', kind: 'final' }
  const other = { asset_id: 'x', kind: 'thumb' }

  it('returns nothing for missing or empty assets', () => {
    expect(pickCaptureAsset(undefined)).toBeUndefined()
    expect(pickCaptureAsset([])).toBeUndefined()
  })

  it('prefers final, then original, then the first asset', () => {
    expect(pickCaptureAsset([original, other, final])).toBe(final)
    expect(pickCaptureAsset([other, original])).toBe(original)
    expect(pickCaptureAsset([other])).toBe(other)
  })

  it('keeps both curved-book pages and skips thumbnails', () => {
    const left = { asset_id: 'l', kind: 'final_left' }
    const right = { asset_id: 'r', kind: 'final_right' }
    const thumb = { asset_id: 't', kind: 'final_thumbnail_left' }
    expect(pickCaptureAssets([original, thumb, right, left])).toEqual([right, left])
    expect(pickCaptureAsset([thumb, original])).toBe(original)
  })
})

describe('asCaptureTask', () => {
  it.each([null, 'task', 1])('rejects the non-object value %j', (value) => {
    expect(asCaptureTask(value)).toBeUndefined()
  })

  it.each([{}, { task: null }, { task: 'x' }, { task: {} }, { task_id: 9 }])('rejects a value without a string task id: %j', (value) => {
    expect(asCaptureTask(value)).toEqual(undefined)
  })

  it('reads a flat task with defaults for status and assets', () => {
    expect(asCaptureTask({ task_id: 't' })).toEqual({ task_id: 't', status: 'unknown' })
  })

  it('reads a task nested under `task` and every optional field', () => {
    expect(asCaptureTask({
      task: {
        task_id: 't',
        status: 'succeeded',
        device_id: 'd',
        error: 'e',
        image_base64: 'aW1n',
        data_base64: 'ZGF0YQ==',
        assets: [
          null,
          { kind: 'final' },
          { asset_id: 'no-kind' },
          {
            asset_id: 'a',
            kind: 'final',
            path: '/p',
            url: 'http://u',
            download_url: 'http://d',
            content_type: 'image/png',
            width: 2,
            height: 3,
            size: 4,
            base64: 'Yg==',
            data_base64: 'ZA==',
          },
          { asset_id: 'b', kind: 'original', path: 1, url: 2, download_url: 3, content_type: 4, width: '1', height: '1', size: '1', base64: 5, data_base64: 6 },
        ],
      },
    })).toEqual({
      task_id: 't',
      status: 'succeeded',
      device_id: 'd',
      error: 'e',
      image_base64: 'aW1n',
      data_base64: 'ZGF0YQ==',
      assets: [
        {
          asset_id: 'a',
          kind: 'final',
          path: '/p',
          url: 'http://u',
          download_url: 'http://d',
          content_type: 'image/png',
          width: 2,
          height: 3,
          size: 4,
          base64: 'Yg==',
          data_base64: 'ZA==',
        },
        { asset_id: 'b', kind: 'original' },
      ],
    })
  })

  it('ignores mistyped optional task fields and a non-array asset list', () => {
    expect(asCaptureTask({ task_id: 't', status: 4, device_id: 5, error: 6, image_base64: 7, data_base64: 8, assets: 'x' })).toEqual({
      task_id: 't',
      status: 'unknown',
    })
  })

  it('takes fields from the nested task when the top-level id is also present', () => {
    expect(asCaptureTask({ task_id: 'top', task: { status: 'failed' } })).toEqual({ task_id: 'top', status: 'failed' })
  })
})

describe('czurCaptureProfile', () => {
  it.each([
    'auto_optimize',
    'color_enhance',
    'black_white',
    'grayscale',
    'white_paper_seal',
    'certificate',
    'ancient',
    'no_optimize',
  ] as const)('keeps color mode %s on a single page and asks for detection boxes', (colorMode) => {
    const profile = czurCaptureProfile({ pageProcessing: 'single_page', colorMode })
    expect(profile.capture).toMatchObject({
      page_processing: 'single_page',
      color_mode: colorMode,
      single_page: { realtime_detect_rects: true, smart_black_edge_optimize: true },
    })
    expect(profile.output).toMatchObject({ format: 'jpg', quality: 90 })
  })

  it('uses the curved-book defaults and does not request detection boxes', () => {
    expect(czurCaptureProfile({ pageProcessing: 'curved_book', colorMode: 'auto_optimize' }).capture).toMatchObject({
      page_processing: 'curved_book',
      curved_book: { remove_finger: { enabled: true }, smart_paging: true },
    })
  })

  it('keeps the original page without extra treatment', () => {
    expect(czurCaptureProfile({ pageProcessing: 'keep_original', colorMode: 'no_optimize' }).capture).toEqual({
      page_processing: 'keep_original',
      color_mode: 'no_optimize',
    })
  })

  it('writes a selected area as four frame-pixel corners', () => {
    const profile = czurCaptureProfile({
      pageProcessing: 'selected_area',
      colorMode: 'certificate',
      selection: { x: 10, y: 20, width: 30, height: 40, sourceWidth: 1280, sourceHeight: 720 },
    })
    expect(profile.capture).toMatchObject({
      page_processing: 'selected_area',
      color_mode: 'certificate',
      selected_area: {
        points: {
          left_top: { x: 10, y: 20 },
          right_top: { x: 40, y: 20 },
          right_down: { x: 40, y: 60 },
          left_down: { x: 10, y: 60 },
        },
        source: { width: 1280, height: 720 },
      },
    })
  })

  it('falls back to single-page detection when a selection has no rectangle', () => {
    expect(czurCaptureProfile({ pageProcessing: 'selected_area', colorMode: 'auto_optimize' }).capture).toMatchObject({
      page_processing: 'single_page',
      single_page: { realtime_detect_rects: true },
    })
  })
})

describe('parseDetectedRects', () => {
  it('reads boxes from the payload shapes the Runtime may send', () => {
    expect(parseDetectedRects({
      detected_rects: [
        { x: 1, y: 2, width: 3, height: 4 },
        { left: 5, top: 6, width: 7, height: 8 },
        { left: 1, top: 2, right: 4, bottom: 6 },
        { points: { left_top: { x: 0, y: 1 }, right_down: { x: 2, y: 4 } } },
        { left_top: [0, 0], right_top: [10, 0], right_down: [10, 6], left_down: [0, 6] },
        { x: 1, y: 1, width: 0, height: 2 },
        'nope',
      ],
    })).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 6, width: 7, height: 8 },
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 0, y: 1, width: 2, height: 3 },
      {
        x: 0,
        y: 0,
        width: 10,
        height: 6,
        corners: {
          leftTop: { x: 0, y: 0 },
          rightTop: { x: 10, y: 0 },
          rightDown: { x: 10, y: 6 },
          leftDown: { x: 0, y: 6 },
        },
      },
    ])
  })

  it('returns nothing when the field is missing or not a list', () => {
    expect(parseDetectedRects({})).toEqual([])
    expect(parseDetectedRects({ detected_rects: { x: 1 } })).toEqual([])
    expect(parseDetectedRects(null)).toEqual([])
  })

  it('accepts a bare list and drops incomplete points, edges, and non-finite numbers', () => {
    expect(parseDetectedRects([{ x: 1, y: 2, width: 3, height: 4 }])).toEqual([{ x: 1, y: 2, width: 3, height: 4 }])
    expect(parseDetectedRects([
      { points: { left_top: { x: 1 }, right_down: null }, x: 1, y: 2, width: 3, height: 4 },
      { left_top: [1], x: 2, y: 3, width: 4, height: 5 },
      { points: { left_top: 'no' } },
      { left: 1, top: 2, right: 5, bottom: 6 },
      { x: 1, y: 2, height: 4 },
      { y: 2, width: 3, height: 4 },
      { x: 1, top: 2, width: 3 },
      { x: Number.NaN, y: 2, width: 3, height: 4 },
      { points: { left_top: { x: 1, y: 1 }, right_down: { x: 1, y: 1 } } },
      { left_top: [0, 0], right_top: [1, 0] },
      { left_top: [1, 1], right_top: [2, 1], right_down: [1, 1] },
      { left_top: [0, 0], right_top: [0, 0], right_down: [0, 0], left_down: [0, 0] },
      {
        left_top: [0, 10],
        right_top: [100, 0],
        right_down: [90, 80],
        left_down: [5, 90],
      },
    ])).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 2, y: 3, width: 4, height: 5 },
      { x: 1, y: 2, width: 4, height: 4 },
      {
        x: 0,
        y: 0,
        width: 100,
        height: 90,
        corners: {
          leftTop: { x: 0, y: 10 },
          rightTop: { x: 100, y: 0 },
          rightDown: { x: 90, y: 80 },
          leftDown: { x: 5, y: 90 },
        },
      },
    ])
  })
})
