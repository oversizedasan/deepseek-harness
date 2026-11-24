/** Tray state, attach keys, and wire-to-File decoding for the document-scanner session UI. */
import { describe, expect, it } from 'vitest'
import { base64ToFile, captureAttachKey, createSessionUiStore } from '../src/client/session-ui.ts'
import { still } from './fixtures.client.ts'

describe('session-ui', () => {
  it('starts with an empty idle tray bound to a fresh batch id', () => {
    expect(createSessionUiStore().getSnapshot()).toMatchObject({
      captures: [],
      archiveSessionId: null,
      working: false,
      message: null,
      attachedFolderRef: null,
      attachedCaptureKeys: [],
    })
  })

  it('keys an archived still by its workspace path and an unarchived one by its bytes', () => {
    expect(captureAttachKey({ ...still('a.jpg'), workspacePath: 'Captures/b/a.jpg' }))
      .toBe('path:Captures/b/a.jpg')
    expect(captureAttachKey({ ...still('a.jpg'), workspacePath: '' })).toBe('bytes:image/jpeg:a.jpg:AAEC')
    expect(captureAttachKey({ mimeType: 'image/png', width: 1, height: 1, dataBase64: 'AAEC' }))
      .toBe('bytes:image/png::AAEC')
  })

  it('decodes capture bytes into a typed File named after the still', async () => {
    const file = base64ToFile(still('a.jpg'))
    expect(file.name).toBe('a.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.from([0, 1, 2]))
    expect(base64ToFile({ mimeType: 'image/png', width: 1, height: 1, dataBase64: 'AAEC' }).name)
      .toBe('capture.jpg')
  })
})
