/**
 * Bundled classroom demo skills for the document-scanner practice path.
 * Invoked only through Composer `/` (no dedicated chip strip).
 *
 * @module @deepseek-ai/dsh-doc-scanner-skills
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'doc-scanner-skills'
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

const HOMEWORK_GRADE_URL = new URL('../assets/homework-grade.md', import.meta.url)
const WRONG_BOOK_URL = new URL('../assets/wrong-book.md', import.meta.url)

const HOMEWORK_GRADE: SkillCandidate = {
  name: 'homework-grade',
  description:
    '批改当前用户消息中已附上的作业图片：指出错误并给出简短讲解。请在文档相机本批附上后再使用。',
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: HOMEWORK_GRADE_URL,
}

const WRONG_BOOK: SkillCandidate = {
  name: 'wrong-book',
  description:
    '根据当前用户消息中已附上的作业图片整理错题知识点，并给出巩固练习建议。请在文档相机本批附上后再使用。',
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: WRONG_BOOK_URL,
}

const SKILLS: readonly { readonly candidate: SkillCandidate; readonly body: URL }[] = [
  { candidate: HOMEWORK_GRADE, body: HOMEWORK_GRADE_URL },
  { candidate: WRONG_BOOK, body: WRONG_BOOK_URL },
]

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(SKILLS.map(({ candidate }) => candidate)),
  async get(candidate): Promise<SkillDefinition> {
    const entry = SKILLS.find(item => item.candidate.name === candidate.name)
    if (entry === undefined) throw new Error(`unknown skill: ${candidate.name}`)
    return {
      name: entry.candidate.name,
      description: entry.candidate.description,
      invocation: entry.candidate.invocation,
      provider: entry.candidate.provider,
      source: entry.candidate.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(entry.body, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'doc-scanner-skills'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled document-scanner demo skills on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
