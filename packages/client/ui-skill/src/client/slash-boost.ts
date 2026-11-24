/**
 * Empty-query `/` catalog boost: registered skill names appear first, in
 * registration order, before the remaining name-sorted catalog.
 */

/** Client service that prepends skill names on a blank `/` query. */
export interface SkillSlashBoost {
  /**
   * Register names to prepend when the slash query is empty.
   * @param names - skill names in boost order; unknown catalog names are skipped.
   * @returns disposer that drops this registration.
   */
  register(names: readonly string[]): () => void
  /**
   * Flattened boost names in registration order (later registrations append).
   * @returns deduped name list keeping first occurrence.
   */
  list(): readonly string[]
}

/**
 * Create the in-memory boost registry provided on the Client context.
 * @returns a {@link SkillSlashBoost} whose `register` returns a disposer.
 */
export function createSkillSlashBoost(): SkillSlashBoost {
  const stacks: string[][] = []
  return {
    register(names) {
      const entry = names.filter(name => name.length > 0)
      stacks.push(entry)
      return () => {
        const index = stacks.indexOf(entry)
        if (index >= 0) stacks.splice(index, 1)
      }
    },
    list() {
      const seen = new Set<string>()
      const out: string[] = []
      for (const stack of stacks) {
        for (const name of stack) {
          if (seen.has(name)) continue
          seen.add(name)
          out.push(name)
        }
      }
      return out
    },
  }
}

/**
 * Prepend boost hits, then keep the rest in their original order.
 * @param skills - catalog entries (typically name-sorted from the Host).
 * @param boost - boost names from {@link SkillSlashBoost.list}.
 * @returns reordered catalog for a blank `/` query.
 */
export function applySkillSlashBoost<T extends { readonly name: string }>(
  skills: readonly T[],
  boost: readonly string[],
): readonly T[] {
  if (boost.length === 0) return skills
  const byName = new Map(skills.map(skill => [skill.name, skill]))
  const head: T[] = []
  const boosted = new Set<string>()
  for (const name of boost) {
    const hit = byName.get(name)
    if (hit === undefined) continue
    head.push(hit)
    boosted.add(name)
  }
  if (head.length === 0) return skills
  return [...head, ...skills.filter(skill => !boosted.has(skill.name))]
}
