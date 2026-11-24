/** Document-scanner Client mount wires the status chip, preview tab, and + menu. */
/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSkillSlashBoost } from '@deepseek-ai/dsh-client-ui-skill/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from '../src/client/batch-limit.ts'
import {
  DOC_SCANNER_COMMAND, DOC_SCANNER_SLASH_BOOST, DOC_SCANNER_TAB_ID, inject, mountDocScanner,
} from '../src/client/mount.ts'
import { DocScannerBar, type DocScannerBarInjected } from '../src/client/DocScannerBar.tsx'
import { DocScannerPreviewBody, type DocScannerPreviewInjected } from '../src/client/DocScannerPreviewBody.tsx'
import type { DocScannerCaptureResult } from '@deepseek-ai/dsh-api-doc-scanner/types'
import { flush } from './fixtures.client.ts'
import type { DocScannerReadiness } from '../src/client/readiness.ts'
import type { DocScannerSessionUi } from '../src/client/session-ui.ts'

/** The slice of the `+` menu registration these specs invoke. */
interface CommandSpec {
  label: () => string
  description: () => string
  available: () => boolean
  ui: { kind: string; run: (session: { sessionId: string }) => void }
}

const REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-api-doc-scanner',
  descriptors: [],
}

const mirrored = vi.hoisted(() => ({ readiness: undefined as SnapshotStore<DocScannerReadiness> | undefined }))

vi.mock('../src/client/readiness.ts', () => ({
  observeReadiness: () => {
    const state = createSnapshotStore<DocScannerReadiness>({ snapshot: null, connected: false, error: null })
    mirrored.readiness = state
    return { state, dispose: async () => {} }
  },
}))

vi.mock('../src/client/preview-feed.ts', () => ({
  observePreviewFeed: () => ({
    state: createSnapshotStore({ src: null, streaming: false, error: null }),
    dispose: async () => {},
  }),
}))

vi.mock('../src/client/stills-feed.ts', () => ({
  observeStillsFeed: () => ({
    dispose: async () => {},
  }),
}))

/** The inject hook exposes a read-only observable; the mounted instance is the writable store. */
function sessionUiStore(actions: DocScannerPreviewInjected): SnapshotStore<DocScannerSessionUi> {
  const store = actions.hooks.docScannerSessionUi
  assert('set' in store && typeof store.set === 'function')
  return store as SnapshotStore<DocScannerSessionUi>
}

function assertChip(value: Record<string, unknown>): asserts value is Record<string, unknown> & DocScannerBarInjected {
  assert(typeof value.openPreview === 'function')
  assert(typeof value.attachBatchToDraft === 'function')
  assert(typeof value.rehydrateArchiveAttachments === 'function')
  assert(typeof value.run === 'function')
  assert(typeof value.hooks === 'object' && value.hooks !== null)
}

function assertPreview(value: Record<string, unknown>): asserts value is Record<string, unknown> & DocScannerPreviewInjected {
  assert(typeof value.connect === 'function')
  assert(typeof value.capture === 'function')
  assert(typeof value.close === 'function')
  assert(typeof value.openPreview === 'function')
  assert(typeof value.removeCapture === 'function')
  assert(typeof value.clearBatch === 'function')
  assert(typeof value.openBatchInFiles === 'function')
  assert(typeof value.bindArchiveSession === 'function')
  assert(typeof value.run === 'function')
  assert(typeof value.hooks === 'object' && value.hooks !== null)
}

async function fixture(fail = false) {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toBe(REMOTE)
      return unmount
    }
  }
  new Remote()
  const connect = vi.fn(async () => ({ ok: true, value: {} }))
  const capture = vi.fn(async () => ({
    ok: true,
    value: {
      mimeType: 'image/jpeg' as const,
      width: 1,
      height: 1,
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
      name: 'scan.jpg',
      workspacePath: 'Captures/2026-11-20_165922/scan.jpg',
    },
  }))
  const close = vi.fn(async () => ({ ok: true, value: {} }))
  const followStills = vi.fn()
  ctx.provide('remote.docScanner', { connect, capture, close, follow: vi.fn(), preview: vi.fn(), followStills })
  const list = vi.fn(async () => ({
    ok: true as const,
    value: {
      path: 'Captures/2026-11-20_165922',
      entries: [
        { name: 'scan.jpg', type: 'file' as const },
        { name: 'notes.txt', type: 'file' as const },
      ],
      truncated: false,
    },
  }))
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
  const readBytes = vi.fn(async () => ({
    ok: true as const,
    value: { data: jpeg, offset: 0, eof: true, absolutePath: '/work/Captures/x/scan.jpg', version: '1' },
  }))
  ctx.provide('remote.workspaceFiles', { list, readBytes })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  const openTabIn = vi.fn()
  const openResource = vi.fn()
  ctx.provide('sidebarRight', { openTabIn, openResource })
  const registerTab = vi.fn((_spec: { title: () => string }) => () => {})
  ctx.provide('sidebarRightTabs', { register: registerTab })
  ctx.provide('sessions', {
    binding: () => undefined,
    list: {
      getSnapshot: () => ({ byId: { s1: { cwd: '/work' } }, projectionsBySession: {} }),
    },
  })
  const boost = createSkillSlashBoost()
  ctx.provide('skillSlashBoost', boost)
  const createDrafts = vi.fn((_sessionId: unknown, files: readonly unknown[]) =>
    files.map((_, index) => ({ id: `draft-${String(index + 1)}` })))
  const addAttachments = vi.fn((_ids: readonly string[]) => true)
  const addReferences = vi.fn((_references: readonly { label?: string }[]) => true)
  const canInsertReferences = vi.fn(() => true)
  const notify = vi.fn()
  const focus = vi.fn()
  const shellState = {
    attachmentIds: [] as string[],
    references: [] as Array<{ source: string; ref: string; appearance?: 'folder' | 'file' }>,
  }
  ctx.provide('conversation', {
    createDrafts,
    input: {
      shell: () => ({
        addAttachments: (ids: readonly string[]) => {
          shellState.attachmentIds = [...shellState.attachmentIds, ...ids]
          return addAttachments(ids)
        },
        addReferences,
        canInsertReferences,
        notify,
        focus,
        get snapshot() {
          return { attachmentIds: shellState.attachmentIds }
        },
        get draftSnapshot() {
          return { references: shellState.references }
        },
      }),
    },
  })
  const register = vi.fn((_spec: CommandSpec) => () => {})
  ctx.provide('commandUi', { register, decorate: vi.fn(() => () => {}) })
  const registeredSources: Array<{
    name: string
    openReference?: (session: { sessionId: string }, reference: {
      ref: string
      appearance?: 'session' | 'file' | 'folder'
    }) => boolean
    candidates?: () => Promise<readonly object[]>
    onPick?: () => void
  }> = []
  const registerSource = vi.fn((source: (typeof registeredSources)[number]) => {
    registeredSources.push(source)
    return () => {
      const index = registeredSources.indexOf(source)
      if (index >= 0) registeredSources.splice(index, 1)
    }
  })
  ctx.provide('inputTriggers', { registerSource })
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.input.activity': { kind: 'single', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  return {
    ctx, unmount, openTabIn, openResource, list, readBytes, connect, capture, close, createDrafts, addAttachments,
    addReferences, canInsertReferences, notify, focus, register, registerTab, boost, registerSource, registeredSources,
    shellState,
  }
}

it('registers the status chip, preview tab, and + menu without occupying activity or dock', async () => {
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    expect(b.ctx.slots.entries('conversation.input.activity')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
    const chip = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
    expect(chip).toMatchObject({ locale: 'doc-scanner', options: expect.objectContaining({ id: DOC_SCANNER_COMMAND }) })
    const chipActions = chip!.inject!()
    assertChip(chipActions)
    chipActions.openPreview('s1' as never)
    expect(b.openTabIn).toHaveBeenCalledWith('s1', 'doc-scanner')

    const preview = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
    expect(preview).toMatchObject({ locale: 'doc-scanner', options: expect.objectContaining({ key: DOC_SCANNER_TAB_ID }) })
    const previewActions = preview!.inject!()
    assertPreview(previewActions)
    const ui = previewActions.hooks.docScannerSessionUi.getSnapshot()
    expect(ui.captures).toEqual([])
    expect(ui.batchId).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}(?:-\d+)?$/u)
    expect(ui.working).toBe(false)
    expect(ui.message).toBeNull()
    expect(b.boost.list()).toEqual([...DOC_SCANNER_SLASH_BOOST])

    expect(b.register).toHaveBeenCalledWith(expect.objectContaining({
      name: DOC_SCANNER_COMMAND,
      ui: expect.objectContaining({ kind: 'action' }),
    }))
    expect(b.registerSource).toHaveBeenCalledWith(expect.objectContaining({
      name: DOC_SCANNER_COMMAND,
      trigger: '@',
      openReference: expect.any(Function),
    }))

    await fiber.dispose()
    expect(b.ctx.slots.entries('conversation.input.right')).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.unmount).toHaveBeenCalledOnce()
    expect(b.boost.list()).toEqual([])
    expect(b.registeredSources).toHaveLength(0)
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('opens archive folder chips via the doc-scanner input-trigger source', async () => {
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const source = b.registeredSources.find(item => item.name === DOC_SCANNER_COMMAND)
    expect(source?.openReference).toEqual(expect.any(Function))
    const preview = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
    const previewActions = preview!.inject!()
    assertPreview(previewActions)

    expect(source!.openReference!({ sessionId: 's1' }, {
      ref: '@Captures/2026-11-20_165922/',
      appearance: 'file',
    })).toBe(false)
    expect(b.openResource).not.toHaveBeenCalled()
    expect(b.openTabIn).not.toHaveBeenCalled()

    expect(source!.openReference!({ sessionId: 's1' }, {
      ref: '@Captures/2026-11-20_165922/',
      appearance: 'folder',
    })).toBe(true)
    expect(b.openTabIn).toHaveBeenCalledWith('s1', 'files')
    await vi.waitFor(() => {
      expect(b.list).toHaveBeenCalledWith('s1', 'Captures/2026-11-20_165922', expect.any(AbortSignal))
      expect(b.openResource).toHaveBeenCalledWith(expect.stringContaining('Captures/2026-11-20_165922/scan.jpg'))
    })
    b.openTabIn.mockClear()
    b.openResource.mockClear()
    b.list.mockClear()

    sessionUiStore(previewActions).set({
      ...previewActions.hooks.docScannerSessionUi.getSnapshot(),
      captures: [{
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
        name: 'scan.jpg',
        workspacePath: 'Captures/2026-11-20_165922/scan.jpg',
      }],
    })
    expect(source!.openReference!({ sessionId: 's1' }, {
      ref: '@Captures/2026-11-20_165922/',
      appearance: 'folder',
    })).toBe(true)
    expect(b.openResource).toHaveBeenCalledWith(expect.stringContaining('Captures/2026-11-20_165922/scan.jpg'))
    expect(b.openTabIn).not.toHaveBeenCalled()
    expect(b.list).not.toHaveBeenCalled()

    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('appends captures, opens archive path, and Batch N attach focuses without auto-send', async () => {
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const preview = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
    const previewActions = preview!.inject!()
    assertPreview(previewActions)
    const chip = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
    const chipActions = chip!.inject!()
    assertChip(chipActions)

    previewActions.bindArchiveSession('s1' as never)
    await previewActions.run(async () => {
      const result = await previewActions.capture(AbortSignal.timeout(1_000))
      expect(result.ok).toBe(true)
    })
    expect(b.capture).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: expect.any(String), sessionId: 's1' }),
      expect.any(AbortSignal),
    )
    const afterCapture = previewActions.hooks.docScannerSessionUi.getSnapshot().captures
    expect(afterCapture).toHaveLength(1)
    expect(afterCapture[0]?.workspacePath).toBe('Captures/2026-11-20_165922/scan.jpg')
    expect(previewActions.hooks.docScannerSessionUi.getSnapshot().archiveSessionId).toBe('s1')

    previewActions.openBatchInFiles('s1' as never)
    expect(b.openResource).toHaveBeenCalledWith(expect.stringContaining('Captures/2026-11-20_165922/scan.jpg'))

    chipActions.attachBatchToDraft('s1' as never)
    expect(b.createDrafts).toHaveBeenCalledOnce()
    expect(b.addAttachments).toHaveBeenCalledWith(['draft-1'])
    expect(b.addReferences).toHaveBeenCalledWith([expect.objectContaining({
      appearance: 'folder',
      ref: '@Captures/2026-11-20_165922/',
      label: expect.stringMatching(/本批扫描|Batch scan/),
      clipboardText: '@Captures/2026-11-20_165922/',
    })])
    expect(b.addReferences.mock.calls[0]?.[0]?.[0]?.label).not.toMatch(/Captures\/|\.dsh\//u)
    expect(b.notify).not.toHaveBeenCalled()
    expect(b.focus).toHaveBeenCalledOnce()
    expect(previewActions.hooks.docScannerSessionUi.getSnapshot().attachedCaptureKeys)
      .toEqual(['path:Captures/2026-11-20_165922/scan.jpg'])

    b.createDrafts.mockClear()
    b.addAttachments.mockClear()
    b.addReferences.mockClear()
    b.focus.mockClear()
    chipActions.attachBatchToDraft('s1' as never)
    // Same tray stills: do not stack duplicate rail images or folder chips.
    expect(b.createDrafts).not.toHaveBeenCalled()
    expect(b.addAttachments).not.toHaveBeenCalled()
    expect(b.addReferences).not.toHaveBeenCalled()
    expect(b.focus).toHaveBeenCalledOnce()

    previewActions.clearBatch()
    const cleared = previewActions.hooks.docScannerSessionUi.getSnapshot()
    expect(cleared.captures).toEqual([])
    expect(cleared.attachedFolderRef).toBeNull()
    expect(cleared.attachedCaptureKeys).toEqual([])

    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('rehydrates rail images from a persisted Captures folder chip', async () => {
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const chip = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
    const chipActions = chip!.inject!()
    assertChip(chipActions)

    expect(await chipActions.rehydrateArchiveAttachments('s1' as never)).toBe('pending-draft')

    b.shellState.references = [{
      source: DOC_SCANNER_COMMAND,
      ref: '@Captures/2026-11-20_165922/',
      appearance: 'folder',
    }]
    expect(await chipActions.rehydrateArchiveAttachments('s1' as never)).toBe('restored')

    expect(b.list).toHaveBeenCalledWith('s1', 'Captures/2026-11-20_165922', expect.any(AbortSignal))
    expect(b.readBytes).toHaveBeenCalledWith(
      's1',
      'Captures/2026-11-20_165922/scan.jpg',
      {},
      expect.any(AbortSignal),
    )
    expect(b.createDrafts).toHaveBeenCalledOnce()
    expect(b.addAttachments).toHaveBeenCalledWith(['draft-1'])
    expect(chipActions.hooks.docScannerSessionUi.getSnapshot().captures).toEqual([
      expect.objectContaining({
        name: 'scan.jpg',
        workspacePath: 'Captures/2026-11-20_165922/scan.jpg',
      }),
    ])
    expect(chipActions.hooks.docScannerSessionUi.getSnapshot().attachedFolderRef)
      .toBe('@Captures/2026-11-20_165922/')

    b.createDrafts.mockClear()
    expect(await chipActions.rehydrateArchiveAttachments('s1' as never)).toBe('ready')
    expect(b.createDrafts).not.toHaveBeenCalled()

    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('notifies when archive open cannot list files', async () => {
  const b = await fixture()
  try {
    b.list.mockResolvedValueOnce({ ok: false as const, error: { code: 'x', message: 'missing' } } as never)
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const source = b.registeredSources.find(item => item.name === DOC_SCANNER_COMMAND)
    expect(source!.openReference!({ sessionId: 's1' }, {
      ref: '@Captures/2026-11-20_165922/',
      appearance: 'folder',
    })).toBe(true)
    await vi.waitFor(() => {
      expect(b.notify).toHaveBeenCalledWith('error', expect.stringMatching(/Captures\/2026-11-20_165922|archive/i))
    })
    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('attaches only new tray stills after an earlier attach', async () => {
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const preview = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
    const previewActions = preview!.inject!()
    assertPreview(previewActions)
    const chip = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
    const chipActions = chip!.inject!()
    assertChip(chipActions)

    const first = {
      mimeType: 'image/jpeg' as const,
      width: 1,
      height: 1,
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
      name: 'scan-a.jpg',
      workspacePath: 'Captures/2026-11-20_165922/scan-a.jpg',
    }
    const second = {
      ...first,
      name: 'scan-b.jpg',
      workspacePath: 'Captures/2026-11-20_165922/scan-b.jpg',
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xd9]).toString('base64'),
    }
    sessionUiStore(previewActions).set({
      ...previewActions.hooks.docScannerSessionUi.getSnapshot(),
      captures: [first],
      batchId: '2026-11-20_165922',
    })
    chipActions.attachBatchToDraft('s1' as never)
    expect(b.createDrafts).toHaveBeenCalledOnce()
    expect(b.addAttachments).toHaveBeenCalledWith(['draft-1'])

    b.createDrafts.mockClear()
    b.addAttachments.mockClear()
    sessionUiStore(previewActions).set({
      ...previewActions.hooks.docScannerSessionUi.getSnapshot(),
      captures: [first, second],
    })
    chipActions.attachBatchToDraft('s1' as never)
    expect(b.createDrafts).toHaveBeenCalledOnce()
    expect(b.createDrafts.mock.calls[0]?.[1]).toHaveLength(1)
    expect(b.addAttachments).toHaveBeenCalledWith(['draft-1'])
    expect(previewActions.hooks.docScannerSessionUi.getSnapshot().attachedCaptureKeys).toEqual([
      'path:Captures/2026-11-20_165922/scan-a.jpg',
      'path:Captures/2026-11-20_165922/scan-b.jpg',
    ])

    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('attaches images when folder references cannot be inserted', async () => {
  const b = await fixture()
  try {
    b.canInsertReferences.mockReturnValue(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const preview = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
    const previewActions = preview!.inject!()
    assertPreview(previewActions)
    const chip = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
    const chipActions = chip!.inject!()
    assertChip(chipActions)

    sessionUiStore(previewActions).set({
      ...previewActions.hooks.docScannerSessionUi.getSnapshot(),
      captures: [{
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
        name: 'scan.jpg',
        workspacePath: 'Captures/2026-11-20_165922/scan.jpg',
      }],
    })

    chipActions.attachBatchToDraft('s1' as never)
    expect(b.createDrafts).toHaveBeenCalledOnce()
    expect(b.addAttachments).toHaveBeenCalledWith(['draft-1'])
    expect(b.addReferences).not.toHaveBeenCalled()
    expect(b.notify).toHaveBeenCalledWith('info', expect.stringMatching(/归档目录|archive folder/i))
    expect(b.focus).toHaveBeenCalledOnce()

    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('rejects attach when the tray exceeds the composer image limit', async () => {
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
    await fiber
    const preview = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
    const previewActions = preview!.inject!()
    assertPreview(previewActions)
    const chip = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
    const chipActions = chip!.inject!()
    assertChip(chipActions)

    const overLimit = Array.from({ length: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE + 1 }, (_, index) => ({
      mimeType: 'image/jpeg' as const,
      width: 1,
      height: 1,
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
      name: `scan-${String(index)}.jpg`,
    }))
    sessionUiStore(previewActions).set({
      ...previewActions.hooks.docScannerSessionUi.getSnapshot(),
      captures: overLimit,
    })

    await chipActions.run(async () => {
      chipActions.attachBatchToDraft('s1' as never)
    })
    expect(b.createDrafts).not.toHaveBeenCalled()
    expect(previewActions.hooks.docScannerSessionUi.getSnapshot().message).toContain(String(DOC_SCANNER_MAX_IMAGES_PER_MESSAGE))

    await fiber.dispose()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

it('rolls back the Remote contribution when slot registration fails', async () => {
  const b = await fixture(true)
  try {
    await expect(mountDocScanner(b.ctx, REMOTE)).rejects.toThrow('slot failed')
    expect(b.unmount).toHaveBeenCalledOnce()
  } finally {
    await b.ctx.fiber.dispose()
  }
})

const CHIP = '@Captures/2026-11-20_165922/'
const ARCHIVE_DIR = 'Captures/2026-11-20_165922'
const SCAN_PATH = `${ARCHIVE_DIR}/scan.jpg`

function still(name: string, workspacePath?: string): DocScannerCaptureResult {
  return {
    mimeType: 'image/jpeg',
    width: 1,
    height: 1,
    dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
    name,
    ...workspacePath === undefined ? {} : { workspacePath },
  }
}

/** Mount the contribution and expose the injected faces the real components receive. */
async function mounted() {
  const b = await fixture()
  const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountDocScanner(ctx, REMOTE) })
  await fiber
  onTestFinished(async () => {
    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })
  const previewEntry = b.ctx.slots.entries('sidebar.right.pane.tab').find(item => item.component === DocScannerPreviewBody)
  const chipEntry = b.ctx.slots.entries('conversation.input.right').find(item => item.component === DocScannerBar)
  const previewInject = previewEntry?.inject?.()
  const chipInject = chipEntry?.inject?.()
  const source = b.registeredSources.find(item => item.name === DOC_SCANNER_COMMAND)
  assert(previewInject !== undefined && chipInject !== undefined && source !== undefined)
  assertPreview(previewInject)
  assertChip(chipInject)
  const ui = sessionUiStore(previewInject)
  const setCaptures = (captures: DocScannerCaptureResult[]): void => {
    ui.set({ ...ui.getSnapshot(), captures })
  }
  const openFolder = (ref = CHIP) => source.openReference?.({ sessionId: 's1' }, { ref, appearance: 'folder' })
  const signal = AbortSignal.timeout(1_000)
  return { ...b, preview: previewInject, chip: chipInject, source, ui, setCaptures, openFolder, signal }
}

const REMOTE_FAILURE = { ok: false as const, error: new Error('remote said no') }

it('binds the archive Session once and keeps the same state for a repeat bind', async () => {
  const b = await mounted()
  b.preview.bindArchiveSession('s1' as never)
  const bound = b.ui.getSnapshot()
  expect(bound.archiveSessionId).toBe('s1')
  b.preview.bindArchiveSession('s1' as never)
  expect(b.ui.getSnapshot()).toBe(bound)
})

it('connects with an empty request and rethrows a failed connect', async () => {
  const b = await mounted()
  await b.preview.connect(b.signal)
  expect(b.connect).toHaveBeenCalledWith({}, b.signal)
  b.connect.mockResolvedValueOnce(REMOTE_FAILURE as never)
  await expect(b.preview.connect(b.signal)).rejects.toBe(REMOTE_FAILURE.error)
})

it('captures without a session scope, keeps a failed capture out of the tray, and refuses a full tray', async () => {
  const b = await mounted()
  await b.preview.capture(b.signal)
  expect(b.capture).toHaveBeenCalledWith({ batchId: b.ui.getSnapshot().batchId }, b.signal)
  expect(b.ui.getSnapshot().captures).toHaveLength(1)

  b.capture.mockResolvedValueOnce(REMOTE_FAILURE as never)
  const failed = await b.preview.capture(b.signal)
  expect(failed.ok).toBe(false)
  expect(b.ui.getSnapshot().captures).toHaveLength(1)

  b.setCaptures(Array.from({ length: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE }, (_, index) => still(`s${String(index)}.jpg`)))
  b.capture.mockClear()
  await expect(b.preview.capture(b.signal)).rejects.toThrow(String(DOC_SCANNER_MAX_IMAGES_PER_MESSAGE))
  expect(b.capture).not.toHaveBeenCalled()
})

it('closes the scanner and rethrows a failed close', async () => {
  const b = await mounted()
  await b.preview.close()
  expect(b.close).toHaveBeenCalledOnce()
  b.close.mockResolvedValueOnce(REMOTE_FAILURE as never)
  await expect(b.preview.close()).rejects.toBe(REMOTE_FAILURE.error)
})

it('removes one still by index and ignores an index outside the tray', async () => {
  const b = await mounted()
  b.setCaptures([still('a.jpg'), still('b.jpg'), still('c.jpg')])
  b.preview.removeCapture(1)
  expect(b.ui.getSnapshot().captures.map(item => item.name)).toEqual(['a.jpg', 'c.jpg'])
  const before = b.ui.getSnapshot()
  b.preview.removeCapture(-1)
  b.preview.removeCapture(2)
  expect(b.ui.getSnapshot()).toBe(before)
})

it('records a non-Error failure from a scanner action and clears the working flag', async () => {
  const b = await mounted()
  // oxlint-disable-next-line prefer-promise-reject-errors -- a non-Error rejection is the behavior under test
  await b.chip.run(() => Promise.reject('plain failure'))
  expect(b.ui.getSnapshot()).toMatchObject({ message: 'plain failure', working: false })
})

it('refuses to attach an empty tray, a missing conversation, and a composer without an id-addressed shell', async () => {
  const b = await mounted()
  expect(() => { b.chip.attachBatchToDraft('s1' as never) }).toThrow(/Capture some photos|拍几张/)

  b.setCaptures([still('a.jpg', SCAN_PATH)])
  b.ctx.set('conversation', { createDrafts: b.createDrafts, input: {} })
  expect(() => { b.chip.attachBatchToDraft('s1' as never) }).toThrow(/Could not attach|无法附上/)

  b.ctx.set('conversation', undefined)
  expect(() => { b.chip.attachBatchToDraft('s1' as never) }).toThrow(/Open a session first|请先打开/)
  expect(b.createDrafts).not.toHaveBeenCalled()
})

it('fails the attach and keeps the rail keys unchanged when the composer rejects the images', async () => {
  const b = await mounted()
  b.setCaptures([still('a.jpg', SCAN_PATH)])
  b.addAttachments.mockReturnValueOnce(false)
  expect(() => { b.chip.attachBatchToDraft('s1' as never) }).toThrow(/limit|上限/)
  expect(b.ui.getSnapshot().attachedCaptureKeys).toEqual([])
  expect(b.focus).not.toHaveBeenCalled()
})

it('notifies and still focuses when the composer rejects the folder chip', async () => {
  const b = await mounted()
  b.setCaptures([still('a.jpg', SCAN_PATH)])
  b.addReferences.mockReturnValueOnce(false)
  b.chip.attachBatchToDraft('s1' as never)
  expect(b.notify).toHaveBeenCalledWith('info', expect.stringMatching(/archive folder|归档目录/))
  expect(b.ui.getSnapshot().attachedFolderRef).toBeNull()
  expect(b.focus).toHaveBeenCalledOnce()
})

it('skips the folder chip for an archive path the mention grammar cannot represent', async () => {
  const b = await mounted()
  b.setCaptures([still('a.jpg', 'Captures/say "hi"/a.jpg')])
  b.chip.attachBatchToDraft('s1' as never)
  expect(b.addAttachments).toHaveBeenCalledOnce()
  expect(b.addReferences).not.toHaveBeenCalled()
  expect(b.notify).toHaveBeenCalledWith('info', expect.stringMatching(/archive folder|归档目录/))
})

it('opens the newest archived still in Files and reports why it cannot', async () => {
  const b = await mounted()
  expect(() => { b.preview.openBatchInFiles('s1' as never) }).toThrow(/archived path|归档路径/)
  b.setCaptures([still('a.jpg', '')])
  expect(() => { b.preview.openBatchInFiles('s1' as never) }).toThrow(/archived path|归档路径/)

  b.setCaptures([still('a.jpg', SCAN_PATH), still('b.jpg')])
  b.preview.openBatchInFiles('s1' as never)
  expect(b.openResource).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(SCAN_PATH))

  b.ctx.set('sessions', undefined)
  expect(() => { b.preview.openBatchInFiles('s1' as never) }).toThrow(/Open a session first|请先打开/)
})

it('shows the preview tab title and the + menu entry', async () => {
  const b = await mounted()
  expect(b.registerTab.mock.calls[0]?.[0].title()).toMatch(/文档相机|Document camera/)
  const spec = b.register.mock.calls[0]?.[0]
  assert(spec !== undefined)
  expect(spec.label()).toMatch(/文档相机|Document camera/)
  expect(spec.description()).not.toBe('')
  expect(spec.available()).toBe(true)
})

it('connects from the + menu unless the device is already ready, then opens the preview tab', async () => {
  const b = await mounted()
  const run = b.register.mock.calls[0]?.[0].ui.run
  assert(run !== undefined && mirrored.readiness !== undefined)
  run({ sessionId: 's1' })
  await vi.waitFor(() => { expect(b.openTabIn).toHaveBeenCalledWith('s1', 'doc-scanner') })
  expect(b.connect).toHaveBeenCalledOnce()

  b.connect.mockClear()
  b.openTabIn.mockClear()
  mirrored.readiness.set({
    snapshot: { providers: [], connection: { phase: 'ready' } },
    connected: true,
    error: null,
  })
  run({ sessionId: 's1' })
  await vi.waitFor(() => { expect(b.openTabIn).toHaveBeenCalledWith('s1', 'doc-scanner') })
  expect(b.connect).not.toHaveBeenCalled()
})

it('offers no candidates and ignores picks from the archive trigger source', async () => {
  const b = await mounted()
  await expect(b.source.candidates?.()).resolves.toEqual([])
  expect(b.source.onPick?.()).toBeUndefined()
})

it('restores the tray from the archive when a folder chip is opened after reload', async () => {
  const b = await mounted()
  b.shellState.references = [{ source: DOC_SCANNER_COMMAND, ref: CHIP, appearance: 'folder' }]
  expect(b.openFolder()).toBe(true)
  await vi.waitFor(() => { expect(b.openResource).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(SCAN_PATH)) })
  expect(b.openTabIn).toHaveBeenCalledWith('s1', 'files')
  expect(b.list).toHaveBeenCalledOnce()
})

describe('reveal the archive listing', () => {
  it('opens the last file when the archive has no image', async () => {
    const b = await mounted()
    b.list.mockResolvedValueOnce({
      ok: true as const,
      value: { path: ARCHIVE_DIR, entries: [{ name: 'notes.txt', type: 'file' as const }, { name: 'sub', type: 'directory' as never }], truncated: false },
    })
    b.openFolder()
    await vi.waitFor(() => { expect(b.openResource).toHaveBeenCalledWith(expect.stringContaining(`${ARCHIVE_DIR}/notes.txt`)) })
  })

  it('notifies when the archive lists no file', async () => {
    const b = await mounted()
    b.list.mockResolvedValueOnce({ ok: true as const, value: { path: ARCHIVE_DIR, entries: [], truncated: false } })
    b.openFolder()
    await vi.waitFor(() => { expect(b.notify).toHaveBeenCalledWith('error', expect.stringContaining(ARCHIVE_DIR)) })
    expect(b.openResource).not.toHaveBeenCalled()
  })

  it('notifies when the workspace files Remote cannot list', async () => {
    const b = await mounted()
    b.ctx.set('remote.workspaceFiles', undefined)
    b.openFolder()
    await vi.waitFor(() => { expect(b.notify).toHaveBeenCalledWith('error', expect.stringContaining(ARCHIVE_DIR)) })
    expect(b.list).not.toHaveBeenCalled()
  })

  it('notifies when no Session directory source is mounted', async () => {
    const b = await mounted()
    b.ctx.set('sessions', undefined)
    b.openFolder()
    await vi.waitFor(() => { expect(b.notify).toHaveBeenCalledWith('error', expect.stringContaining(ARCHIVE_DIR)) })
    expect(b.list).not.toHaveBeenCalled()
  })

  it('swallows the failure notice when the composer is gone', async () => {
    const b = await mounted()
    b.list.mockImplementationOnce(async () => {
      b.ctx.set('conversation', undefined)
      return { ok: false as const, error: { code: 'x', message: 'missing' } } as never
    })
    b.openFolder()
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledOnce() })
    await flush()
    expect(b.notify).not.toHaveBeenCalled()
  })
})

describe('rehydrate the composer rail from the archive', () => {
  async function withChip(reference = CHIP) {
    const b = await mounted()
    b.shellState.references = [{ source: DOC_SCANNER_COMMAND, ref: reference, appearance: 'folder' }]
    return b
  }

  it('waits for the draft while no conversation exists', async () => {
    const b = await withChip()
    b.ctx.set('conversation', undefined)
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('pending-draft')
  })

  it('treats a composer that already holds images, or a non-empty tray, as ready', async () => {
    const b = await withChip()
    b.shellState.attachmentIds = ['draft-9']
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('ready')
    b.shellState.attachmentIds = []
    b.setCaptures([still('a.jpg')])
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('ready')
    expect(b.list).not.toHaveBeenCalled()
  })

  it('reports an unavailable Remote once, then settles as ready for that Session', async () => {
    const b = await withChip()
    b.ctx.set('remote.workspaceFiles', { list: b.list })
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('unavailable')
    expect(b.notify).toHaveBeenCalledWith('error', expect.stringContaining(ARCHIVE_DIR))
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('ready')
    expect(b.notify).toHaveBeenCalledOnce()
  })

  it('reports an archive that cannot be listed', async () => {
    const b = await withChip()
    b.list.mockResolvedValueOnce({ ok: false as const, error: { code: 'x', message: 'missing' } } as never)
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('unavailable')
    expect(b.notify).toHaveBeenCalledWith('error', expect.stringContaining(ARCHIVE_DIR))
  })

  it('reports an archive without images', async () => {
    const b = await withChip()
    b.list.mockResolvedValueOnce({
      ok: true as const,
      value: { path: ARCHIVE_DIR, entries: [{ name: 'notes.txt', type: 'file' as const }], truncated: false },
    })
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('unavailable')
    expect(b.readBytes).not.toHaveBeenCalled()
  })

  it('reports a composer that disappears while the archive is listed', async () => {
    const b = await withChip()
    b.list.mockImplementationOnce(async () => {
      b.ctx.set('conversation', undefined)
      return {
        ok: true as const,
        value: { path: ARCHIVE_DIR, entries: [{ name: 'scan.jpg', type: 'file' as const }], truncated: false },
      }
    })
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('unavailable')
    expect(b.readBytes).not.toHaveBeenCalled()
  })

  it('reports an image that cannot be read', async () => {
    const b = await withChip()
    b.readBytes.mockResolvedValueOnce({ ok: false as const, error: { code: 'x', message: 'gone' } } as never)
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('unavailable')
    expect(b.createDrafts).not.toHaveBeenCalled()
  })

  it('reports images the composer rejects', async () => {
    const b = await withChip()
    b.addAttachments.mockReturnValueOnce(false)
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('unavailable')
    expect(b.ui.getSnapshot().captures).toEqual([])
  })

  it('shares one restore between concurrent callers', async () => {
    const b = await withChip()
    const [first, second] = await Promise.all([
      b.chip.rehydrateArchiveAttachments('s1' as never),
      b.chip.rehydrateArchiveAttachments('s1' as never),
    ])
    expect([first, second]).toEqual(['restored', 'restored'])
    expect(b.list).toHaveBeenCalledOnce()
  })

  it('restores the tray without a folder mention for an archive path the grammar cannot represent', async () => {
    const b = await withChip('@Captures/say"hi/')
    await expect(b.chip.rehydrateArchiveAttachments('s1' as never)).resolves.toBe('restored')
    expect(b.ui.getSnapshot().attachedFolderRef).toBeNull()
  })
})
