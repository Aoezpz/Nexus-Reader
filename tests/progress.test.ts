import { describe, expect, it } from 'vitest'
import {
  allSteps,
  isConfirmed,
  pruneMarks,
  summarizeProgress,
  type ProgressionData,
  type ProgressState
} from '../src/shared/progression'
import data from '../data/progression.json'

/**
 * What happens to flagging state when the app is pointed at a new server.
 *
 * The state below is not invented: it is `triune-progress.json` as found on
 * 2026-09-20, after a 0.2.0 install that had synced against PTDex was carried
 * forward to The Second Calling. It is the case that produced the bug -
 * tscemu.com showed the elemental planes fully flagged for a character who had
 * earned those flags on Project Triune.
 */

const PROGRESSION = data as unknown as ProgressionData

const REAL_STATE: ProgressState = {
  'tier-4-the-elemental-planes/fennin ro, the tyrant of fire': { at: 1786541860042, source: 'ptdex' },
  'tier-4-the-elemental-planes/xegony, the queen of air': { at: 1786541860042, source: 'ptdex' },
  'tier-4-the-elemental-planes/coirnav, the avatar of water': { at: 1786541860042, source: 'ptdex' },
  'tier-4-the-elemental-planes/a mystical arbitor of earth': { at: 1786541860042, source: 'ptdex' },
  'tier-4-the-elemental-planes/the avatar of earth': { at: 1786541860042, source: 'ptdex' },
  'door-1-ruins-of-kunark/lord nagafen': { at: 1789949610000, source: 'log', by: 'Braxus' },
  'door-1-ruins-of-kunark/lady vox': { at: 1789949621000, source: 'log', by: 'Braxus' }
}

describe('pruneMarks', () => {
  it("drops the previous server's flags even when the step still exists", () => {
    // Every one of these keys IS in the bundled data - stock EverQuest bosses
    // are on both servers - so the "unknown key" rule alone kept all five.
    const valid = new Set(allSteps(PROGRESSION).map((s) => s.key))
    for (const key of Object.keys(REAL_STATE)) expect(valid.has(key)).toBe(true)

    const { kept, unknown, foreign } = pruneMarks(PROGRESSION, REAL_STATE)
    expect(unknown).toBe(0)
    expect(foreign).toBe(5)
    expect(Object.keys(kept).sort()).toEqual([
      'door-1-ruins-of-kunark/lady vox',
      'door-1-ruins-of-kunark/lord nagafen'
    ])
  })

  it('leaves the elemental planes empty rather than fully flagged', () => {
    const before = chapter(summarizeProgress(PROGRESSION, REAL_STATE), 'elemental')
    const after = chapter(summarizeProgress(PROGRESSION, pruneMarks(PROGRESSION, REAL_STATE).kept), 'elemental')

    expect(before.earned).toBe(before.total) // the bug: 5 of 5, on Triune's word
    expect(after.earned).toBe(0)
  })

  it('keeps a kill this server saw, and it stays unconfirmed', () => {
    const { kept } = pruneMarks(PROGRESSION, REAL_STATE)
    const mark = kept['door-1-ruins-of-kunark/lord nagafen']
    expect(mark?.source).toBe('log')
    expect(isConfirmed(mark)).toBe(false)
  })

  it('drops a key no bundled step has', () => {
    const { kept, unknown, foreign } = pruneMarks(PROGRESSION, {
      'door-9-some-old-chapter/a mob that moved on': { at: 1, source: 'site' }
    })
    expect(unknown).toBe(1)
    expect(foreign).toBe(0)
    expect(kept).toEqual({})
  })

  it('never touches a tick you made by hand', () => {
    const key = allSteps(PROGRESSION)[0].key
    const { kept } = pruneMarks(PROGRESSION, { [key]: { at: 1, source: 'manual' } })
    expect(kept[key]?.source).toBe('manual')
  })
})

function chapter(
  summary: ReturnType<typeof summarizeProgress>,
  match: string
): { earned: number; total: number } {
  for (const section of summary.sections) {
    for (const c of section.chapters) {
      if (c.title.toLowerCase().includes(match)) return { earned: c.earned, total: c.total }
    }
  }
  throw new Error(`no chapter matching "${match}"`)
}
