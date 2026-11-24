/** The shipped patches compose the scanner stack and select exactly one provider. */
import { readFile } from 'node:fs/promises'
import { parseEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'

interface Manifest {
  readonly dependencies: Readonly<Record<string, string>>
  readonly dsh: { readonly bundle: { readonly patch: string } }
}

async function readPatch(file: string): Promise<readonly EntryOptions[]> {
  const parsed = parseEntryYaml(await readFile(new URL(`../${file}`, import.meta.url), 'utf8')) as { insert: EntryOptions[] }[]
  return parsed.flatMap(layer => layer.insert)
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
}

function row(rows: readonly EntryOptions[], id: string): EntryOptions | undefined {
  return rows.find(candidate => candidate.id === id)
}

const PATCHES = ['cordis.patch.yml', 'cordis.czur.patch.yml'] as const

describe.each(PATCHES)('%s', (file) => {
  it('inserts the full scanner stack with unique ids', async () => {
    const rows = await readPatch(file)
    expect(rows.map(candidate => candidate.id)).toEqual([
      'doc-scanner',
      'doc-scanner-mock',
      'doc-scanner-czur',
      'doc-scanner-skills',
      'api-doc-scanner',
      'ui-doc-scanner',
    ])
  })

  it('names only packages the bundle depends on', async () => {
    const { dependencies } = await readManifest()
    for (const candidate of await readPatch(file)) {
      expect(candidate.name, `${file} row ${candidate.id ?? ''}`).toBeDefined()
      expect(dependencies[candidate.name]).toBe('workspace:*')
    }
  })

  it('points the CZUR provider at the local Runtime with its self-signed certificate allowed', async () => {
    const czur = row(await readPatch(file), 'doc-scanner-czur')
    expect(czur?.config).toMatchObject({
      commandWsUrl: 'wss://sdk-runtime.localhost:18090',
      allowInsecureTls: true,
    })
  })
})

describe('provider selection', () => {
  it('keeps the default patch on the Mock provider so keyless demos need no Runtime', async () => {
    const rows = await readPatch('cordis.patch.yml')
    expect(row(rows, 'doc-scanner-mock')?.disabled).toBeUndefined()
    expect(row(rows, 'doc-scanner-czur')?.disabled).toBe(true)
  })

  it('swaps to the CZUR provider and its credential in the hardware overlay', async () => {
    const rows = await readPatch('cordis.czur.patch.yml')
    expect(row(rows, 'doc-scanner-mock')?.disabled).toBe(true)
    expect(row(rows, 'doc-scanner-czur')?.disabled).toBeUndefined()
    expect(row(rows, 'doc-scanner-czur')?.config).toMatchObject({ credentialRef: 'CZUR_API_KEY' })
  })

  it('declares the default patch as the bundle composition', async () => {
    expect((await readManifest()).dsh.bundle.patch).toBe('./cordis.patch.yml')
  })
})
