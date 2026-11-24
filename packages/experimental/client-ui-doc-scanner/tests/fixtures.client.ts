/** Shared doubles for document-scanner Client specs: scripted Remote streams, snapshots, and a translator. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { RemoteStreamItem, RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import type {
  DocScannerCaptureResult,
  DocScannerConnectionPhase,
  DocScannerPreviewFrameWire,
  DocScannerSnapshot,
} from '@deepseek-ai/dsh-api-doc-scanner/types'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import type { PaneId, SidebarRightTabInfo, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { en } from '../src/client/locales.ts'
import type { DocScannerReadiness } from '../src/client/readiness.ts'

/** Wire values the document-scanner Remote streams carry. */
export type StreamWire = DocScannerSnapshot | DocScannerPreviewFrameWire | DocScannerCaptureResult

type Step =
  | { readonly kind: 'value'; readonly value: StreamWire }
  | { readonly kind: 'fail'; readonly error: unknown }
  | { readonly kind: 'end' }

/**
 * One scripted logical Remote stream: items are pushed by the spec and consumed through `for await`.
 * Items already queued when `dispose()` runs are still delivered, like frames in flight on a real carrier.
 */
export class FakeStream implements AsyncIterable<RemoteStreamItem<StreamWire>> {
  /** Number of items the consumer marked accepted. */
  accepted = 0
  /** Whether `dispose()` ran. */
  disposed = false
  private readonly queue: Step[] = []
  private wake: (() => void) | undefined

  constructor(readonly options: RemoteStreamOptions<StreamWire>) {}

  /** Deliver one item to the consumer. */
  push(value: StreamWire): void {
    this.queue.push({ kind: 'value', value })
    this.wake?.()
  }

  /** Reject the consumer's next read with `error`. */
  fail(error: unknown): void {
    this.queue.push({ kind: 'fail', error })
    this.wake?.()
  }

  /** Finish the iteration normally. */
  end(): void {
    this.queue.push({ kind: 'end' })
    this.wake?.()
  }

  /** Stop the stream and release a pending read. */
  dispose(): Promise<void> {
    this.disposed = true
    this.wake?.()
    return Promise.resolve()
  }

  async * [Symbol.asyncIterator](): AsyncGenerator<RemoteStreamItem<StreamWire>> {
    const signal = new AbortController().signal
    for (;;) {
      let step = this.queue.shift()
      if (step === undefined && !this.disposed) {
        await new Promise<void>((resolve) => { this.wake = resolve })
        this.wake = undefined
        step = this.queue.shift()
      }
      if (step?.kind === 'fail') throw step.error
      if (step === undefined || step.kind === 'end') return
      yield { generation: 1, value: step.value, signal, accept: () => { this.accepted += 1 } }
    }
  }
}

/** Doc-scanner Remote methods used by the feeds. */
export interface FakeDocScannerMethods {
  readonly follow: (signal: AbortSignal) => string
  readonly preview: (signal: AbortSignal) => string
  readonly followStills: (request: { batchId: string; sessionId?: string }, signal: AbortSignal) => string
}

/** Remote service double recording every `$stream` call. */
export class FakeRemote extends Service {
  readonly streams: FakeStream[] = []
  readonly docScanner: FakeDocScannerMethods = {
    follow: signal => `follow:${String(signal.aborted)}`,
    preview: signal => `preview:${String(signal.aborted)}`,
    followStills: (request, signal) =>
      `stills:${request.batchId}:${request.sessionId ?? '-'}:${String(signal.aborted)}`,
  }

  constructor(ctx: Context) { super(ctx, 'remote') }

  $stream<Item extends StreamWire>(options: RemoteStreamOptions<Item>): FakeStream {
    const stream = new FakeStream(options)
    this.streams.push(stream)
    return stream
  }
}

/** A Context whose `remote` service is a {@link FakeRemote}. */
export function createRemoteContext(): { ctx: Context; remote: FakeRemote } {
  const ctx = new Context()
  const remote = new FakeRemote(ctx)
  return { ctx, remote }
}

/** Scanner snapshot in `phase`. */
export function snapshotIn(phase: DocScannerConnectionPhase): DocScannerSnapshot {
  return { providers: [], connection: { phase } }
}

/** Readiness mirror state with a snapshot in `phase`. */
export function readinessIn(
  phase: DocScannerConnectionPhase | null,
  extra: Partial<DocScannerReadiness> = {},
): DocScannerReadiness {
  return {
    snapshot: phase === null ? null : snapshotIn(phase),
    connected: phase !== null,
    error: null,
    ...extra,
  }
}

/** One archived still. */
export function still(name: string): DocScannerCaptureResult {
  return { mimeType: 'image/jpeg', width: 1, height: 1, dataBase64: 'AAEC', name }
}

/** English translator with `{name}` interpolation, assignable to the component `t` seat. */
export function translate(key: string, params?: Record<string, unknown>): string {
  const dictionary: Readonly<Record<string, string>> = en
  let text = dictionary[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

/** Selector hook over an observable, shaped like the injected `use<Name>` hooks. */
export function selectorHook<T>(source: ObservableSnapshot<T>): <R>(select: (value: T) => R) => R {
  return <R>(select: (value: T) => R): R =>
    select(useSyncExternalStore(
      listener => source.subscribe(listener),
      () => source.getSnapshot(),
      () => source.getSnapshot(),
    ))
}

/** Let queued promise continuations run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

/**
 * Store whose unsubscribe does nothing, so a notification already in flight can reach a disposed observer.
 * `notifyStale()` replays the current state to every listener ever added.
 */
export function leakyStore<T>(init: T): SnapshotStore<T> & { notifyStale(): void } {
  const inner = createSnapshotStore(init)
  const listeners: Array<() => void> = []
  return {
    ...inner,
    subscribe: (listener) => {
      listeners.push(listener)
      return () => {}
    },
    notifyStale: () => {
      for (const listener of listeners) listener()
    },
  }
}

/** Sidebar tab information for a visible docked doc-scanner tab, shaped like the slot-injected `useTabInfo`. */
export function useTabInfo(): SidebarRightTabInfo {
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-doc-scanner' as PaneId, isFloating: false },
    tab: {
      id: 'tab-doc-scanner' as TabId,
      kind: 'doc-scanner',
      contentId: 'sidebar://doc-scanner',
      title: 'Document camera',
      visible: true,
      signal: new AbortController().signal,
      navigation: { address: 'sidebar://doc-scanner', params: undefined, revision: 0 },
      actions: { openTab: vi.fn(), bindCommands: vi.fn(() => vi.fn()), openResource: vi.fn(), close: vi.fn() },
    },
  }
}
