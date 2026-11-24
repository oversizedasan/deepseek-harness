/** Package entries: the Host marker and the Client activation that mounts the generated Remote contribution. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { apply as applyHost } from '../src/index.ts'
import { apply as applyClient, inject } from '../src/client/index.ts'
import { mountDocScanner } from '../src/client/mount.ts'

vi.mock('@deepseek-ai/dsh-api-doc-scanner/remote', () => ({
  default: { package: '@deepseek-ai/dsh-api-doc-scanner', descriptors: [] },
}))

vi.mock('../src/client/mount.ts', () => ({
  inject: ['remote', 'slots'],
  mountDocScanner: vi.fn(() => Promise.resolve(() => Promise.resolve())),
}))

it('the Host entry is an inert marker', () => {
  expect(() => { applyHost() }).not.toThrow()
})

it('the Client entry mounts the generated Remote contribution and returns the mount disposer', async () => {
  const ctx = new Context()
  const dispose = await applyClient(ctx)
  expect(mountDocScanner).toHaveBeenCalledWith(ctx, { package: '@deepseek-ai/dsh-api-doc-scanner', descriptors: [] })
  await expect(dispose()).resolves.toBeUndefined()
  expect(inject).toEqual(['remote', 'slots'])
})
