import { describe, expect, it, vi } from 'vitest'
import { ConnectionStateStore, isPreviewPhase, sleepUnlessAborted } from '../src/provider-support.ts'

describe('isPreviewPhase', () => {
  it('previews only while ready or capturing', () => {
    expect(isPreviewPhase('ready')).toBe(true)
    expect(isPreviewPhase('capturing')).toBe(true)
    expect(isPreviewPhase('connecting')).toBe(false)
    expect(isPreviewPhase('disconnected')).toBe(false)
  })
})

describe('sleepUnlessAborted', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers()
    try {
      const done = vi.fn()
      const pending = sleepUnlessAborted(50, new AbortController().signal).then(done)
      await vi.advanceTimersByTimeAsync(49)
      expect(done).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await pending
      expect(done).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects with the abort reason when aborted mid-wait', async () => {
    const controller = new AbortController()
    const reason = new Error('stop')
    const pending = sleepUnlessAborted(60_000, controller.signal)
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('rejects immediately for an already-aborted signal with a non-Error reason', async () => {
    const controller = new AbortController()
    controller.abort('plain')
    await expect(sleepUnlessAborted(60_000, controller.signal)).rejects.toThrow('Aborted')
  })
})

class Store extends ConnectionStateStore {
  set(phase: 'ready' | 'error'): void { this.setState({ phase }) }
}

describe('ConnectionStateStore', () => {
  it('starts disconnected and notifies subscribers until they unsubscribe', () => {
    const store = new Store()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    expect(store.snapshot()).toEqual({ phase: 'disconnected' })
    store.set('ready')
    expect(store.snapshot()).toEqual({ phase: 'ready' })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    store.set('error')
    expect(listener).toHaveBeenCalledOnce()
  })
})
