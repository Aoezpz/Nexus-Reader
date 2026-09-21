import { describe, expect, it } from 'vitest'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'
import { isSpellName, seconds, ticksToText } from '../src/shared/tooltip'

function ctx(self = 'Hexzo'): ParseContext {
  return { self, petOwners: new Map(), players: new Set([self]) }
}

function parse(body: string, c: ParseContext = ctx()): ParsedEvent {
  const line = tokenize(`[Wed Aug 12 03:12:50 2026] ${body}`, c.self, 0)
  expect(line, `tokenize failed for: ${body}`).not.toBeNull()
  return parseLine(line!, c)
}

describe('loot lines', () => {
  it('reads your own loot in the first person', () => {
    const ev = parse('--You have looted a Cord of Potameid Braids.--')
    expect(ev.kind).toBe('loot')
    expect(ev.item).toBe('Cord of Potameid Braids')
    expect(ev.attacker).toEqual({ name: 'Hexzo', kind: 'self' })
    expect(ev.broadcast).toBeUndefined()
  })

  it("reads somebody else's loot without claiming it", () => {
    const ev = parse('--Braxus has looted a Golden Rod.--')
    expect(ev.item).toBe('Golden Rod')
    expect(ev.target?.name).toBe('Braxus')
    // No attacker, so the merge rule counts it from the primary log only.
    expect(ev.attacker).toBeUndefined()
  })

  it('reads a discovery broadcast, tier and all', () => {
    // A real line, verbatim from a real log - this is the commonest way an item
    // name reaches the app on this server.
    const ev = parse('Wrexkz has discovered: Cord of Potameid Braids (Enchanted).')
    expect(ev.kind).toBe('loot')
    expect(ev.item).toBe('Cord of Potameid Braids')
    expect(ev.tier).toBe('Enchanted')
    expect(ev.target?.name).toBe('Wrexkz')
    // Flagged, because thirty of these an hour would bury the stream.
    expect(ev.broadcast).toBe(true)
  })

  it('keeps a comma-and-parenthesis item name in one piece', () => {
    const ev = parse('Yeger has discovered: Urmiir, Sword of Beast Slaying (Legendary).')
    expect(ev.item).toBe('Urmiir, Sword of Beast Slaying')
    expect(ev.tier).toBe('Legendary')
  })
})

describe('isSpellName', () => {
  /**
   * The test is casing, and it works because both halves are produced by this
   * codebase: the parser lower-cases weapon verbs when it canonicalises them,
   * and leaves spell names as the client printed them.
   */
  it('takes capitalised names as spells', () => {
    for (const s of ['Time Rend', 'Cry of Thunder Strike', 'Flames of Kesh`yk Effect III']) {
      expect(isSpellName(s), s).toBe(true)
    }
  })

  it('leaves weapon skills alone', () => {
    for (const s of ['slash', 'kick', 'crush', 'backstab', 'frenzy on']) {
      expect(isSpellName(s), s).toBe(false)
    }
  })

  it("does not ask the site about labels the app invented", () => {
    expect(isSpellName('Heal')).toBe(false)
    expect(isSpellName('Unattributed')).toBe(false)
    expect(isSpellName('Damage Shield')).toBe(false)
    expect(isSpellName('')).toBe(false)
  })
})

// The card readers themselves - the site's JSON answer and its search rows -
// are tested against the site's real markup in site.test.ts.

describe('unit formatting', () => {
  it('drops a pointless decimal from a cast time', () => {
    expect(seconds(1)).toBe('1s')
    expect(seconds(2.5)).toBe('2.5s')
    expect(seconds(0)).toBeNull()
    expect(seconds(null)).toBeNull()
  })

  it('turns buff ticks into the time players actually think in', () => {
    expect(ticksToText(5)).toBe('30s')
    expect(ticksToText(10)).toBe('1m')
    expect(ticksToText(15)).toBe('1.5m')
    expect(ticksToText(0)).toBeNull()
  })
})
