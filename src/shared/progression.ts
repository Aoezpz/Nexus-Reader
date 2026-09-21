import type { ParsedEvent } from './parser/types'

/**
 * The road to the Plane of Time.
 *
 * The structure is bundled (see scripts/export-progression.mjs, which lifts it
 * from the server's website). The STATE is the app's own: a step is marked
 * the moment its boss dies in your log, which is what makes this live rather
 * than a page you refresh after a raid.
 *
 * Two things the structure is honest about, because the server is:
 *
 *   * **Not every step is a kill.** "Hail Adler Fuirstel" and "a trial before
 *     the Tribunal" are things you do, and no log line reliably marks them -
 *     those are ticked by hand, and the UI says so rather than pretending it
 *     detected them.
 *   * **A kill is not a flag.** On this server a gate boss killed outside a
 *     progression instance grants nothing, and the site draws that as its own
 *     state. So a mark that came from the log is shown as *killed*, and only
 *     the site's sync or your own hand can say *flagged*. See `isConfirmed`.
 */

/** What kind of thing a step is, which decides whether the log can see it. */
export type StepKind = 'kill' | 'hail' | 'event'

export interface ProgStep {
  name: string
  /** "2 stages" and similar, straight from the page. */
  badge: string | null
  stages: number
  /**
   * The name the log writes when the thing dies, where it differs from the
   * step's own name - "Fennin Ro" for "Fennin Ro, the Tyrant of Fire". Null
   * when they are the same.
   */
  mob: string | null
  kind: StepKind
  zone: string | null
  level: number | null
  /** How to get it, for the steps that aren't just "kill this". */
  how: string | null
  /** What it unlocks, when the site says. */
  opens: string | null
  // Carried from the 0.2.0 data so an older bundled file still typechecks.
  npcId?: number | null
  zoneId?: number | null
  zoneShort?: string | null
}

export interface ProgGroup {
  plane: string | null
  planeShort: string | null
  steps: ProgStep[]
}

export interface ProgChapter {
  id: string
  title: string
  era: string | null
  blurb: string | null
  opens: string | null
  rows: number
  stages: number
  badgeCount: number | null
  groups: ProgGroup[]
}

export interface ProgSection {
  id: string
  name: string
  detail: string
  chapters: ProgChapter[]
}

export interface ProgressionData {
  source: string
  extractedAt: string
  note: string
  sections: ProgSection[]
}

/**
 * How a step came to be marked.
 *
 * `log` is a kill the app saw - a strong hint, not a flag. `site` is what the
 * server's website says the account holds. `manual` is your own hand.
 * `ptdex` is what an older build wrote for a site sync, read as `site`.
 */
export type ProgSource = 'log' | 'manual' | 'site' | 'ptdex'

export interface ProgMark {
  at: number
  source: ProgSource
  /** Which character's log saw it, when we know. */
  by?: string
}

/** stepKey -> mark. Flat, because flags are account-wide on this server. */
export type ProgressState = Record<string, ProgMark>

/** Stable id for a step: chapter + name, so renaming a chapter is visible. */
export function stepKey(chapterId: string, step: ProgStep): string {
  return `${chapterId}/${step.name.toLowerCase()}`
}

/**
 * Steps that no log line announces - a hail, a trial, a delivery. They can
 * only be ticked by hand or by the site. Older bundled data carried no kind
 * and marked hails by having no NPC behind them; that reading is kept as the
 * fallback.
 */
export function isManualStep(step: ProgStep): boolean {
  if (step.kind) return step.kind !== 'kill'
  return step.npcId === null || step.npcId === undefined
}

/**
 * Is this mark the flag itself, or only the kill?
 *
 * The site and your own hand both say "flagged". The log says only "this
 * died with you there", which on this server is not the same thing.
 */
export function isConfirmed(mark: ProgMark | undefined): boolean {
  return !!mark && mark.source !== 'log'
}

/** The name the log will write when this step's boss dies. */
export function mobName(step: ProgStep): string {
  return (step.mob ?? step.name).toLowerCase()
}

/** Every step, flattened, with the chapter it belongs to. */
export function allSteps(data: ProgressionData): Array<{
  section: ProgSection
  chapter: ProgChapter
  group: ProgGroup
  step: ProgStep
  key: string
}> {
  const out: Array<{
    section: ProgSection
    chapter: ProgChapter
    group: ProgGroup
    step: ProgStep
    key: string
  }> = []
  for (const section of data.sections) {
    for (const chapter of section.chapters) {
      for (const group of chapter.groups) {
        for (const step of group.steps) {
          out.push({ section, chapter, group, step, key: stepKey(chapter.id, step) })
        }
      }
    }
  }
  return out
}

/**
 * Index of killable step names, lowercased, for O(1) lookup against every
 * death event. Built once and reused - a linear scan of 57 steps per kill line
 * would be fine, but this also collapses the "which chapter was that" question
 * into the same lookup.
 */
export function buildKillIndex(data: ProgressionData): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const { step, key } of allSteps(data)) {
    if (isManualStep(step)) continue
    const name = mobName(step)
    const keys = index.get(name)
    if (keys) keys.push(key)
    else index.set(name, [key])
  }
  return index
}

/**
 * Scan events for kills that complete a step.
 *
 * Returns only NEW marks, so the caller can tell the difference between "you
 * just killed a gate boss" - which is worth announcing - and "you killed
 * Nagafen again".
 */
export function detectProgress(
  events: ParsedEvent[],
  index: Map<string, string[]>,
  current: ProgressState
): Record<string, ProgMark> {
  const fresh: Record<string, ProgMark> = {}

  for (const e of events) {
    if (e.kind !== 'death') continue
    const target = e.target?.name
    if (!target) continue
    // A player dying is not a flag, however much it feels like one.
    if (e.target?.kind === 'self') continue

    const keys = index.get(target.toLowerCase())
    if (!keys) continue

    for (const key of keys) {
      if (current[key] || fresh[key]) continue
      fresh[key] = { at: e.ts, source: 'log', by: e.attacker?.name }
    }
  }

  return fresh
}

export interface ProgressSummary {
  earned: number
  total: number
  /** Of `earned`, how many are a kill the log saw and nothing more. */
  unconfirmed: number
  /** Per-section and per-chapter tallies, for the headline and the rails. */
  sections: Array<{
    id: string
    name: string
    earned: number
    total: number
    chapters: Array<{ id: string; title: string; earned: number; total: number }>
  }>
  /** The next few unfinished steps, nearest chapter first. */
  next: Array<{ key: string; step: ProgStep; chapter: string; plane: string | null }>
}

export function summarizeProgress(
  data: ProgressionData,
  state: ProgressState,
  nextLimit = 6
): ProgressSummary {
  let unconfirmed = 0
  const sections = data.sections.map((section) => {
    const chapters = section.chapters.map((chapter) => {
      let earned = 0
      let total = 0
      for (const group of chapter.groups) {
        for (const step of group.steps) {
          total += 1
          const mark = state[stepKey(chapter.id, step)]
          if (mark) {
            earned += 1
            if (!isConfirmed(mark)) unconfirmed += 1
          }
        }
      }
      return { id: chapter.id, title: chapter.title, earned, total }
    })
    return {
      id: section.id,
      name: section.name,
      earned: chapters.reduce((n, c) => n + c.earned, 0),
      total: chapters.reduce((n, c) => n + c.total, 0),
      chapters
    }
  })

  const next: ProgressSummary['next'] = []
  for (const { chapter, group, step, key } of allSteps(data)) {
    if (next.length >= nextLimit) break
    if (state[key]) continue
    next.push({ key, step, chapter: chapter.title, plane: group.plane })
  }

  return {
    earned: sections.reduce((n, s) => n + s.earned, 0),
    total: sections.reduce((n, s) => n + s.total, 0),
    unconfirmed,
    sections,
    next
  }
}
