import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry, { type SkillProvider } from '@deepseek-ai/dsh-skill'
import * as DocScannerSkills from '@deepseek-ai/dsh-doc-scanner-skills'

describe('dsh-doc-scanner-skills', () => {
  it('registers and disposes homework-grade and wrong-book', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(DocScannerSkills)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    const listed = await ctx.skills.list()
    expect(listed.map(skill => skill.name).sort()).toEqual(['homework-grade', 'wrong-book'])
    expect(listed.every(skill => skill.provider === 'doc-scanner-skills')).toBe(true)
    expect(listed.every(skill => skill.source === 'bundled')).toBe(true)
    for (const skill of listed) {
      expect(skill.resourceBase).toEqual({ kind: 'directory', path: resourcePath })
      expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    }

    const grade = await ctx.skills.get('homework-grade')
    expect(grade?.description).toContain('批改')
    expect(grade?.content).toContain('已附上的作业图片')
    const wrong = await ctx.skills.get('wrong-book')
    expect(wrong?.description).toContain('错题')
    expect(wrong?.content).toContain('错题摘要')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('refuses to load a skill it does not list', async () => {
    const ctx = new Context()
    let registered: SkillProvider | undefined
    ctx.provide('skills', {
      registerProvider: (create: Parameters<Context['skills']['registerProvider']>[0]) => {
        registered = create({ signal: new AbortController().signal, invalidate: () => undefined })
        return () => undefined
      },
    })
    await ctx.plugin(DocScannerSkills)
    if (registered === undefined) throw new Error('provider was not registered')
    const catalog = await registered.list({ cwd: process.cwd(), signal: new AbortController().signal })
    const listed = ('candidates' in catalog ? catalog.candidates : catalog)[0]
    if (listed === undefined) throw new Error('catalog is empty')
    await expect(registered.get({ ...listed, name: 'other-skill' }, { signal: new AbortController().signal }))
      .rejects.toThrow('unknown skill: other-skill')
  })

  it('ships locale meta for plugin presentation', async () => {
    expect(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))).toMatchObject({
      exports: { './locale/*.json': './locale/*.json' },
    })
    expect(JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8')))
      .toMatchObject({ meta: { title: 'Document camera skills' } })
    expect(JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8')))
      .toMatchObject({ meta: { title: '文档相机技能' } })
  })
})
