/** Source-safe lifecycle for the document-scanner Remote, status chip, menu, and preview tab. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-doc-scanner/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DraftAttachmentId, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-skill/client'
import type {
  InputTriggerServiceContract,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { sessionDirectory } from '@deepseek-ai/dsh-api-session-controller/client/directories'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DocScannerCaptureProfile, DocScannerCaptureResult } from '@deepseek-ai/dsh-api-doc-scanner/types'
import {
  capturesArchiveDirsFromDraft,
  isArchiveImageName,
  mentionPath,
  mimeTypeForArchiveImage,
} from './archive-path.ts'
import { batchArchiveDir } from './batch-archive-dir.ts'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from './batch-limit.ts'
import { DocScannerBar, type DocScannerBarInjected } from './DocScannerBar.tsx'
import { DocScannerPreviewBody, type DocScannerPreviewInjected } from './DocScannerPreviewBody.tsx'
import { DocScannerPreviewTitle } from './DocScannerPreviewTitle.tsx'
import { observeReadiness } from './readiness.ts'
import { observePreviewFeed } from './preview-feed.ts'
import { observeStillsFeed } from './stills-feed.ts'
import { formatFolderChipLabel } from './batch-label.ts'
import { base64ToFile, captureAttachKey, createBatchId, createSessionUiStore } from './session-ui.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh, type DocScannerKey } from './locales.ts'

/** Files sidebar tab kind (matches `dsh-client-ui-sidebar-files`). */
const FILES_TAB_KIND = 'files'

/** Minimal draft snapshot fields used to recover archive attachments after reload. */
interface DraftSnapshotLite {
  readonly references: readonly {
    readonly source: string
    readonly ref: string
    readonly appearance?: ReferenceInsert['appearance']
  }[]
}

/** Client Remote slice used to list and read batch archives. */
interface WorkspaceFilesRemoteSlice {
  list?: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<{
    readonly ok: boolean
    readonly value?: {
      readonly entries: readonly { readonly name: string; readonly type: string }[]
    }
  }>
  readBytes?: (sessionId: SessionId, path: string, options: object, signal: AbortSignal) => Promise<{
    readonly ok: boolean
    readonly value?: { readonly data: Uint8Array }
  }>
}

/**
 * Whether `workspacePath` is a file under the archive directory named by `dir`.
 * @param workspacePath - Session-relative file path from a still.
 * @param dir - archive directory path, with or without a trailing slash.
 */
function pathUnderArchiveDir(workspacePath: string, dir: string): boolean {
  const normalized = workspacePath.replaceAll('\\', '/')
  const root = dir.replaceAll('\\', '/').replace(/\/+$/u, '')
  return normalized === root || normalized.startsWith(`${root}/`)
}

/** Tab type id and registration key (package name). */
export const DOC_SCANNER_TAB_ID = '@deepseek-ai/dsh-client-ui-doc-scanner'
/** `openTab` / `openTabIn` kind discriminator. */
export const DOC_SCANNER_TAB_KIND = 'doc-scanner'
/** Composer + menu contribution id. */
export const DOC_SCANNER_COMMAND = 'doc-scanner'
/** Demo skills boosted to the front of an empty `/` catalog while this UI is mounted. */
export const DOC_SCANNER_SLASH_BOOST = ['homework-grade', 'wrong-book'] as const

export const inject = [
  'remote',
  'remote.workspaceFiles',
  'slots',
  'locale',
  'sidebarRight',
  'sidebarRightTabs',
  'sessions',
  'conversation',
  'commandUi',
  'inputTriggers',
]

/** Outcome of one archive-attachment rehydrate attempt. */
export type ArchiveRehydrateResult =
  | 'restored'
  | 'ready'
  | 'pending-draft'
  | 'unavailable'

/** Id-addressed input shell used when the preview pane has no InputActions prop. */
interface DraftInputShell {
  addAttachments(ids: readonly DraftAttachmentId[]): boolean
  addReferences(references: readonly ReferenceInsert[]): boolean
  canInsertReferences(): boolean
  notify(level: 'info' | 'error', text: string): void
  focus(): void
  readonly snapshot: { readonly attachmentIds: readonly DraftAttachmentId[] }
  readonly draftSnapshot: DraftSnapshotLite
}

interface DraftInputAddress {
  shell(id: SessionId): DraftInputShell
}

/** Narrow conversation.input to the id-addressed shell face when present. */
function hasDraftShell(value: object): value is DraftInputAddress {
  return typeof Reflect.get(value, 'shell') === 'function'
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }))
  const t = ctx.locale.bind(NS)
  const readiness = observeReadiness(ctx)
  ctx.effect(() => readiness.dispose)
  const preview = observePreviewFeed(ctx, readiness.state)
  ctx.effect(() => preview.dispose)
  const sessionUi = createSessionUiStore()
  const stills = observeStillsFeed(ctx, readiness.state, sessionUi)
  ctx.effect(() => stills.dispose)

  // Optional: ui-skill provides skillSlashBoost when the skill menu is composed.
  ctx.inject(['skillSlashBoost'], (child) => {
    child.effect(
      () => child.skillSlashBoost.register(DOC_SCANNER_SLASH_BOOST),
      'doc-scanner: slash skill boost',
    )
  })

  const bindArchiveSession = (sessionId: SessionId): void => {
    const current = sessionUi.getSnapshot()
    if (current.archiveSessionId === sessionId) return
    sessionUi.set({ ...current, archiveSessionId: sessionId })
  }

  const openPreview = (sessionId: SessionId): void => {
    bindArchiveSession(sessionId)
    ctx.sidebarRight.openTabIn(sessionId, DOC_SCANNER_TAB_KIND)
  }

  const connect = async (signal: AbortSignal): Promise<void> => {
    const result = await ctx.remote.docScanner.connect({}, signal)
    if (!result.ok) throw result.error
  }

  let captureProfile: DocScannerCaptureProfile = {
    pageProcessing: 'single_page',
    colorMode: 'auto_optimize',
  }

  const setCaptureProfile = async (profile: DocScannerCaptureProfile): Promise<void> => {
    captureProfile = profile
    const phase = readiness.state.getSnapshot().snapshot?.connection.phase
    if (phase !== 'ready' && phase !== 'capturing') return
    const result = await ctx.remote.docScanner.setCaptureProfile({ profile })
    if (!result.ok) throw result.error
  }

  const capture = async (signal: AbortSignal) => {
    const current = sessionUi.getSnapshot()
    if (current.captures.length >= DOC_SCANNER_MAX_IMAGES_PER_MESSAGE) {
      throw new Error(t('batchAtLimit', { max: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE }))
    }
    const sessionScoped = current.archiveSessionId === null
      ? {}
      : { sessionId: current.archiveSessionId }
    const result = await ctx.remote.docScanner.capture({
      batchId: current.batchId,
      profile: captureProfile,
      ...sessionScoped,
    }, signal)
    if (result.ok) {
      const next = sessionUi.getSnapshot()
      sessionUi.set({
        ...next,
        captures: [...next.captures, result.value],
      })
    }
    return result
  }

  const close = async (): Promise<void> => {
    const result = await ctx.remote.docScanner.close()
    if (!result.ok) throw result.error
  }

  const removeCapture = (index: number): void => {
    const current = sessionUi.getSnapshot()
    if (index < 0 || index >= current.captures.length) return
    sessionUi.set({
      ...current,
      captures: current.captures.filter((_, i) => i !== index),
    })
  }

  const clearBatch = (): void => {
    const current = sessionUi.getSnapshot()
    sessionUi.set({
      ...current,
      captures: [],
      batchId: createBatchId(),
      message: null,
      attachedFolderRef: null,
      attachedCaptureKeys: [],
    })
  }

  const draftShell = (sessionId: SessionId): DraftInputShell => {
    const conversation = ctx.get('conversation') as ConversationController | undefined
    if (conversation === undefined) throw new Error(t('draftMissingSession'))
    if (!hasDraftShell(conversation.input)) throw new Error(t('draftFailed'))
    return conversation.input.shell(sessionId)
  }

  /**
   * Silently create drafts from tray stills not yet on the composer rail,
   * then insert an `@` folder chip for `Captures/<batchId>/` when the editor allows it.
   * Chip label is teacher-facing (time + count); `ref` / clipboard keep the path mention.
   * Repeated attach of the same stills is a no-op for images; new tray stills still append.
   * Focuses the composer; does not clear the tray; does not send.
   * Teachers then use Composer `/` to pick a skill before sending.
   */
  const attachBatchToDraft = (sessionId: SessionId): void => {
    const snapshot = sessionUi.getSnapshot()
    const captures = snapshot.captures
    if (captures.length === 0) throw new Error(t('draftEmptyBatch'))
    if (captures.length > DOC_SCANNER_MAX_IMAGES_PER_MESSAGE) {
      throw new Error(t('draftOverLimit', {
        count: captures.length,
        max: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE,
      }))
    }
    const conversation = ctx.get('conversation') as ConversationController | undefined
    if (conversation === undefined) throw new Error(t('draftMissingSession'))
    const shell = draftShell(sessionId)
    const already = new Set(snapshot.attachedCaptureKeys)
    const pending = captures.filter(capture => !already.has(captureAttachKey(capture)))
    if (pending.length > 0) {
      const files = pending.map(base64ToFile)
      const drafts = conversation.createDrafts(sessionId, files, true)
      const ids = drafts.map(draft => draft.id)
      if (!shell.addAttachments(ids)) {
        throw new Error(t('draftOverLimit', {
          count: captures.length,
          max: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE,
        }))
      }
      const nextKeys = [
        ...snapshot.attachedCaptureKeys,
        ...pending.map(captureAttachKey),
      ]
      sessionUi.set({ ...sessionUi.getSnapshot(), attachedCaptureKeys: nextKeys })
    }
    const dir = batchArchiveDir(captures, snapshot.batchId)
    const mention = formatFileMention({ path: dir, kind: 'directory' }, false)
    const folderRef: ReferenceInsert | undefined = mention === undefined
      ? undefined
      : {
        source: DOC_SCANNER_COMMAND,
        ref: mention,
        label: formatFolderChipLabel(dir, captures.length, t),
        appearance: 'folder',
        clipboardText: mention,
      }
    const afterImages = sessionUi.getSnapshot()
    if (folderRef === undefined || !shell.canInsertReferences()) {
      shell.notify('info', t('draftFolderRefSkipped'))
    } else if (afterImages.attachedFolderRef !== mention) {
      if (!shell.addReferences([folderRef])) {
        shell.notify('info', t('draftFolderRefSkipped'))
      } else {
        sessionUi.set({ ...sessionUi.getSnapshot(), attachedFolderRef: folderRef.ref })
      }
    }
    shell.focus()
  }

  const openBatchInFiles = (sessionId: SessionId): void => {
    const captures = sessionUi.getSnapshot().captures
    const path = [...captures].reverse().find(item => item.workspacePath)?.workspacePath
      ?? captures[0]?.workspacePath
    if (path === undefined || path.length === 0) throw new Error(t('openBatchMissingPath'))
    const sessions = ctx.get('sessions')
    if (sessions === undefined) throw new Error(t('openBatchMissingSession'))
    const cwd = sessionDirectory(sessions, sessionId)
    ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))
  }

  const workspaceFilesRemote = (): WorkspaceFilesRemoteSlice | undefined => {
    const fromRemote = Reflect.get(ctx.remote, 'workspaceFiles') as WorkspaceFilesRemoteSlice | undefined
    if (fromRemote !== undefined) return fromRemote
    return ctx.get('remote.workspaceFiles') as WorkspaceFilesRemoteSlice | undefined
  }

  /**
   * When the tray is empty, list the archive directory and open the newest image
   * (or last file) so Files is not left on an unrelated tab.
   * @param sessionId - session owning the workspace.
   * @param archiveDir - Session-relative archive path, with or without trailing slash.
   */
  const revealArchiveListing = async (
    sessionId: SessionId,
    archiveDir: string,
  ): Promise<void> => {
    const workspaceFiles = workspaceFilesRemote()
    const dir = archiveDir.replace(/\/+$/u, '')
    const notifyFail = (): void => {
      try {
        draftShell(sessionId).notify('error', t('archiveOpenFailed', { path: dir }))
      } catch (error) {
        void error
      }
    }
    if (typeof workspaceFiles?.list !== 'function') {
      notifyFail()
      return
    }
    const sessions = ctx.get('sessions')
    if (sessions === undefined) {
      notifyFail()
      return
    }
    const result = await workspaceFiles.list(sessionId, dir, AbortSignal.timeout(5_000))
    if (!result.ok || result.value === undefined) {
      notifyFail()
      return
    }
    const files = result.value.entries.filter(entry => entry.type === 'file')
    const pick = [...files].reverse().find(entry => isArchiveImageName(entry.name))
      ?? files.at(-1)
    if (pick === undefined) {
      notifyFail()
      return
    }
    const cwd = sessionDirectory(sessions, sessionId)
    ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, `${dir}/${pick.name}`))
  }

  /** Sessions that already attempted archive→rail rehydrate this page lifetime. */
  const rehydrateAttempted = new Set<SessionId>()
  const rehydrateInflight = new Map<SessionId, Promise<ArchiveRehydrateResult>>()

  /**
   * After reload, draft folder chips survive but browser File attachments do not.
   * Relist `Captures/<batchId>/` and push images back onto the composer rail + tray.
   * @param sessionId - session whose draft may hold an archive folder chip.
   * @returns `pending-draft` when the composer has not projected the folder chip yet
   *   (caller may retry); other results are terminal for this Session.
   */
  const rehydrateArchiveAttachments = async (sessionId: SessionId): Promise<ArchiveRehydrateResult> => {
    const existing = rehydrateInflight.get(sessionId)
    if (existing !== undefined) return await existing
    const work = (async (): Promise<ArchiveRehydrateResult> => {
      let shell: DraftInputShell
      try {
        shell = draftShell(sessionId)
      } catch (error) {
        void error
        return 'pending-draft'
      }
      if (shell.snapshot.attachmentIds.length > 0 || sessionUi.getSnapshot().captures.length > 0) {
        rehydrateAttempted.add(sessionId)
        return 'ready'
      }
      const dir = capturesArchiveDirsFromDraft(shell.draftSnapshot.references, DOC_SCANNER_COMMAND).at(-1)
      if (dir === undefined) return 'pending-draft'
      if (rehydrateAttempted.has(sessionId)) return 'ready'
      rehydrateAttempted.add(sessionId)
      const workspaceFiles = workspaceFilesRemote()
      if (typeof workspaceFiles?.list !== 'function' || typeof workspaceFiles.readBytes !== 'function') {
        shell.notify('error', t('archiveRehydrateFailed', { path: dir }))
        return 'unavailable'
      }
      const listed = await workspaceFiles.list(sessionId, dir, AbortSignal.timeout(8_000))
      if (!listed.ok || listed.value === undefined) {
        shell.notify('error', t('archiveRehydrateEmpty', { path: dir }))
        return 'unavailable'
      }
      const imageNames = listed.value.entries
        .filter(entry => entry.type === 'file' && isArchiveImageName(entry.name))
        .map(entry => entry.name)
      const selected = imageNames.slice(-DOC_SCANNER_MAX_IMAGES_PER_MESSAGE)
      if (selected.length === 0) {
        shell.notify('error', t('archiveRehydrateEmpty', { path: dir }))
        return 'unavailable'
      }
      const conversation = ctx.get('conversation') as ConversationController | undefined
      if (conversation === undefined) {
        shell.notify('error', t('archiveRehydrateFailed', { path: dir }))
        return 'unavailable'
      }
      const captures: DocScannerCaptureResult[] = []
      const files: File[] = []
      for (const name of selected) {
        const relative = `${dir}/${name}`
        const bytes = await workspaceFiles.readBytes(sessionId, relative, {}, AbortSignal.timeout(30_000))
        if (!bytes.ok || bytes.value === undefined) {
          shell.notify('error', t('archiveRehydrateFailed', { path: dir }))
          return 'unavailable'
        }
        const data = bytes.value.data
        const mimeType = mimeTypeForArchiveImage(name)
        files.push(new File([data.slice()], name, { type: mimeType }))
        captures.push({
          mimeType,
          width: 1,
          height: 1,
          dataBase64: bytesToBase64(data),
          name,
          workspacePath: relative,
        })
      }
      const drafts = conversation.createDrafts(sessionId, files, true)
      const ids = drafts.map(draft => draft.id)
      if (!shell.addAttachments(ids)) {
        shell.notify('error', t('archiveRehydrateFailed', { path: dir }))
        return 'unavailable'
      }
      const mention = formatFileMention({ path: dir, kind: 'directory' }, false)
      const current = sessionUi.getSnapshot()
      sessionUi.set({
        ...current,
        captures,
        attachedCaptureKeys: captures.map(captureAttachKey),
        attachedFolderRef: mention ?? current.attachedFolderRef,
      })
      return 'restored'
    })()
    rehydrateInflight.set(sessionId, work)
    try {
      return await work
    } finally {
      rehydrateInflight.delete(sessionId)
    }
  }

  /**
   * Open a doc-scanner folder chip: prefer the latest tray still under that archive
   * directory; otherwise open Files and try to reveal a listed archive file.
   * Platform `openResource` rejects directories.
   * @param sessionId - session owning the composer and workspace.
   * @param ref - chip mention (`@Captures/<batchId>/`).
   * @param appearance - chip glyph; only `folder` is accepted.
   * @returns whether navigation was accepted.
   */
  const openArchiveReference = (
    sessionId: SessionId,
    ref: string,
    appearance: ReferenceInsert['appearance'],
  ): boolean => {
    if (appearance !== 'folder') return false
    const path = mentionPath(ref)
    const sessions = ctx.get('sessions')
    const underDir = [...sessionUi.getSnapshot().captures]
      .reverse()
      .find(item => item.workspacePath !== undefined
        && item.workspacePath.length > 0
        && pathUnderArchiveDir(item.workspacePath, path))
      ?.workspacePath
    if (underDir !== undefined && sessions !== undefined) {
      const cwd = sessionDirectory(sessions, sessionId)
      ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, underDir))
      return true
    }
    ctx.sidebarRight.openTabIn(sessionId, FILES_TAB_KIND)
    void (async () => {
      await rehydrateArchiveAttachments(sessionId)
      const restored = [...sessionUi.getSnapshot().captures]
        .reverse()
        .find(item => item.workspacePath !== undefined
          && item.workspacePath.length > 0
          && pathUnderArchiveDir(item.workspacePath, path))
        ?.workspacePath
      if (restored !== undefined && sessions !== undefined) {
        const cwd = sessionDirectory(sessions, sessionId)
        ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, restored))
        return
      }
      await revealArchiveListing(sessionId, path)
    })()
    return true
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    sessionUi.set({ ...sessionUi.getSnapshot(), working: true, message: null })
    try {
      await action()
    } catch (error) {
      sessionUi.set({
        ...sessionUi.getSnapshot(),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      sessionUi.set({ ...sessionUi.getSnapshot(), working: false })
    }
  }

  const openOrConnect = async (sessionId: SessionId): Promise<void> => {
    const current = readiness.state.getSnapshot()
    const phase = current.snapshot?.connection.phase
    const ready = current.connected && phase === 'ready'
    if (!ready) await connect(AbortSignal.timeout(60_000))
    openPreview(sessionId)
  }

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: DOC_SCANNER_TAB_ID,
    kind: DOC_SCANNER_TAB_KIND,
    multiple: false,
    priority: 'extension',
    title: () => t('tabTitle'),
  }), 'doc-scanner: preview tab type')

  const previewInject = (): DocScannerPreviewInjected => ({
    hooks: {
      docScannerReadiness: readiness.state,
      docScannerPreview: preview.state,
      docScannerSessionUi: sessionUi,
    },
    connect,
    capture,
    setCaptureProfile,
    close,
    openPreview,
    removeCapture,
    clearBatch,
    openBatchInFiles,
    bindArchiveSession,
    run,
  })

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DOC_SCANNER_TAB_ID,
    locale: NS,
    inject: previewInject,
  }, DocScannerPreviewBody)), 'doc-scanner: preview body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: DOC_SCANNER_TAB_ID,
    locale: NS,
  }, DocScannerPreviewTitle)), 'doc-scanner: preview title')

  const chipInject = (): DocScannerBarInjected => ({
    hooks: {
      docScannerReadiness: readiness.state,
      docScannerSessionUi: sessionUi,
    },
    openPreview,
    attachBatchToDraft,
    rehydrateArchiveAttachments,
    run,
  })

  ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: DOC_SCANNER_COMMAND,
    order: 40,
    locale: NS,
    inject: chipInject,
  }, DocScannerBar)), 'doc-scanner: status chip')

  ctx.effect(() => ctx.commandUi.register({
    name: DOC_SCANNER_COMMAND,
    label: () => t('menuLabel'),
    description: () => t('menuDescription'),
    icon: IconDeliverDocRegular,
    available: () => true,
    ui: {
      kind: 'action',
      run: (session) => {
        void run(async () => {
          await openOrConnect(session.sessionId)
        })
      },
    },
  }), 'doc-scanner: + menu entry')

  const archiveSource: InputTriggerSource = {
    trigger: '@',
    name: DOC_SCANNER_COMMAND,
    showGroupTitle: false,
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    openReference(session, { ref, appearance }) {
      return openArchiveReference(session.sessionId, ref, appearance)
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(archiveSource), 'doc-scanner: archive folder source')
}

/**
 * Mount this experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remote, dictionaries and slots.
 * @param contribution - generated document-scanner Remote definitions.
 * @returns a disposer that removes the registered UI, then unmounts the Remote.
 * @throws the UI registration error, after disposing the UI and unmounting the Remote.
 */
export async function mountDocScanner(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject([
    'remote.docScanner',
    'remote.workspaceFiles',
    'slots',
    'locale',
    'sidebarRight',
    'sidebarRightTabs',
    'sessions',
    'conversation',
    'commandUi',
    'inputTriggers',
  ], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

/** Encode archive bytes for the in-memory tray after reload rehydrate. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type { DocScannerKey }
export type { DocScannerCaptureResult }
