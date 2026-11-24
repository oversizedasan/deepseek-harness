/** Empty-query `/` skill boost registry and ordering. */
import { describe, expect, it } from 'vitest'
import { applySkillSlashBoost, createSkillSlashBoost } from '../src/client/slash-boost.ts'

describe('skill slash boost', () => {
  it('registers, dedupes, and disposes boost names', () => {
    const boost = createSkillSlashBoost()
    const disposeA = boost.register(['homework-grade', 'wrong-book'])
    const disposeB = boost.register(['wrong-book', 'office'])
    expect(boost.list()).toEqual(['homework-grade', 'wrong-book', 'office'])
    disposeA()
    expect(boost.list()).toEqual(['wrong-book', 'office'])
    disposeB()
    expect(boost.list()).toEqual([])
  })

  it('prepends boost hits and keeps the remaining catalog order', () => {
    const skills = [
      { name: 'automate', description: 'a' },
      { name: 'homework-grade', description: 'b' },
      { name: 'office', description: 'c' },
      { name: 'wrong-book', description: 'd' },
    ]
    expect(applySkillSlashBoost(skills, ['homework-grade', 'wrong-book']).map(skill => skill.name))
      .toEqual(['homework-grade', 'wrong-book', 'automate', 'office'])
    expect(applySkillSlashBoost(skills, ['missing']).map(skill => skill.name))
      .toEqual(['automate', 'homework-grade', 'office', 'wrong-book'])
  })
})
