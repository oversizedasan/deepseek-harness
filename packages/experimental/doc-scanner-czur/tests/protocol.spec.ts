/** CZUR Command WS envelope narrowing, device parsing, and capture task normalization. */
import { describe, expect, it } from 'vitest'
import {
  asCaptureTask,
  asCzurEvent,
  asCzurResponse,
  deviceOpened,
  parseDeviceList,
  pickCaptureAsset,
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
