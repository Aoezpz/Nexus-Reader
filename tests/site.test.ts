import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exactSearchRow,
  parseCharacterRows,
  parseMonuments,
  parseProgression,
  parseSearchRows,
  tipFromJson,
  tipFromSearchRow
} from '../src/main/siteparse'
import { readChampions } from '../src/main/site'
import { allSteps, isManualStep, type ProgressionData } from '../src/shared/progression'
import { abbrevOf } from '../src/shared/roster'
import data from '../data/progression.json'

/**
 * The server website's markup, read the way the app reads it.
 *
 * Every fixture under tests/fixtures/tsc was cut from a live response of
 * tscemu.com on 2026-09-20 - not typed from memory of what the site looks
 * like. If one of these fails against a fresh copy of the page, the site's
 * markup moved, and the parser is what has to follow it.
 */

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'tsc', name), 'utf8')

const PROGRESSION = data as unknown as ProgressionData

describe('abbrevOf', () => {
  it('folds every spelling the site uses into one', () => {
    expect(abbrevOf('Warrior')).toBe('War')
    expect(abbrevOf('WAR')).toBe('War')
    // The one class whose name the site writes without a space and the app
    // with one, and whose site code is not the app's.
    expect(abbrevOf('Shadowknight')).toBe('SK')
    expect(abbrevOf('Shadow Knight')).toBe('SK')
    expect(abbrevOf('SHD')).toBe('SK')
    expect(abbrevOf('SK')).toBe('SK')
    expect(abbrevOf('Beastlord')).toBe('Bst')
  })

  it('never turns a stray word into a chip', () => {
    expect(abbrevOf('Level 65')).toBeNull()
    expect(abbrevOf('')).toBeNull()
    expect(abbrevOf('·')).toBeNull()
  })
})

describe('parseCharacterRows', () => {
  const html = fixture('characters.html')

  it('reads the row by exact name', () => {
    const c = parseCharacterRows(html, 'Aodeez')
    expect(c).not.toBeNull()
    expect(c?.id).toBe('Aodeez')
    expect(c?.name).toBe('Aodeez')
    expect(c?.level).toBe(1)
    expect(c?.classes).toEqual(['War', 'Clr', 'Mnk'])
    expect(c?.score).toBe(13.7)
    expect(c?.trioRank).toBe(2)
    expect(c?.trioOf).toBe(2)
  })

  it('is case-insensitive on the name and strict on the match', () => {
    expect(parseCharacterRows(html, 'aodeez')?.name).toBe('Aodeez')
    // The search is a LIKE, so a prefix would match on the site; it must not here.
    expect(parseCharacterRows(html, 'Aod')).toBeNull()
  })

  it('returns null, not a guess, on markup it has never seen', () => {
    expect(parseCharacterRows('<p>nothing</p>', 'Aodeez')).toBeNull()
  })
})

describe('parseProgression', () => {
  const html = [
    fixture('progression-head.html'),
    fixture('progression-gates.html'),
    fixture('progression-tiers.html')
  ].join('\n')

  it('reads the level and the classes from the chips', () => {
    const p = parseProgression(html, PROGRESSION)
    expect(p.level).toBe(1)
    expect(p.classes).toEqual(['War', 'Clr', 'Mnk'])
  })

  it('maps every step on a fully flagged page to a bundled key', () => {
    // The fixture character has every door and every tier done, so this is
    // also the proof that the export script and the parser agree on titles.
    const p = parseProgression(html, PROGRESSION)
    const total = allSteps(PROGRESSION).length
    expect(p.unknownSteps).toEqual([])
    expect(p.earned).toHaveLength(total)
    expect(new Set(p.earned).size).toBe(total)
    expect(p.killedUnflagged).toEqual([])
  })

  it('keeps the third state apart from earned', () => {
    // A gate boss killed outside a progression instance: the site draws it as
    // `part`, and it must not become a flag here.
    const tweaked = html.replace(
      '<li class="pgboss done"><span class="pgmark" aria-hidden="true">&#10003;</span><span class="pgbody"><span class="pgname">Lord Nagafen</span>',
      '<li class="pgboss part"><span class="pgmark" aria-hidden="true">&#8226;</span><span class="pgbody"><span class="pgname">Lord Nagafen</span>'
    )
    const p = parseProgression(tweaked, PROGRESSION)
    expect(p.killedUnflagged).toEqual(['door-1-ruins-of-kunark/lord nagafen'])
    expect(p.earned).not.toContain('door-1-ruins-of-kunark/lord nagafen')
  })

  it('reports a step the bundled data does not know rather than dropping it', () => {
    const tweaked = html.replace('<span class="pgname">Lady Vox</span>', '<span class="pgname">Lady Vox the Renewed</span>')
    const p = parseProgression(tweaked, PROGRESSION)
    expect(p.unknownSteps).toEqual(['Ruins of Kunark / Lady Vox the Renewed'])
  })
})

describe('the bundled road', () => {
  it('holds the four doors and the five tiers', () => {
    expect(PROGRESSION.sections.map((s) => s.id)).toEqual(['the-expansion-gates', 'the-road-to-time'])
    expect(PROGRESSION.sections[0].chapters).toHaveLength(4)
    expect(PROGRESSION.sections[1].chapters).toHaveLength(5)
    expect(allSteps(PROGRESSION)).toHaveLength(57)
  })

  it('labels the hails and trials as things the log cannot see', () => {
    const byName = new Map(allSteps(PROGRESSION).map((s) => [s.step.name, s.step]))
    expect(isManualStep(byName.get('Adler Fuirstel')!)).toBe(true)
    expect(isManualStep(byName.get('A trial before the Tribunal')!)).toBe(true)
    expect(isManualStep(byName.get('Loreseeker Maelin')!)).toBe(true)
    expect(isManualStep(byName.get('Grummus')!)).toBe(false)
    expect(isManualStep(byName.get('Saryrn')!)).toBe(false)
    expect(isManualStep(byName.get('Lord Nagafen')!)).toBe(false)
  })

  it('knows the corpse name where it differs from the title', () => {
    const byName = new Map(allSteps(PROGRESSION).map((s) => [s.step.name, s.step]))
    expect(byName.get('Fennin Ro, the Tyrant of Fire')?.mob).toBe('Fennin Ro')
    expect(byName.get('Xegony, the Queen of Air')?.mob).toBe('Xegony')
    expect(byName.get('Grummus')?.mob).toBeNull()
  })
})

describe('parseMonuments', () => {
  const monuments = parseMonuments(fixture('raids.html'), 'https://tscemu.com')

  it('reads every encounter in the site\'s order', () => {
    expect(monuments.map((m) => m.key)).toEqual([
      'kerafyrm', 'seru', 'plane_of_time', 'zebuxoruk', 'uqua', 'inktuta', 'qvic', 'txevu', 'tacvi'
    ])
    expect(monuments.map((m) => m.ordinal)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'])
  })

  it('reads a claimed monument as marks down and brackets across', () => {
    const k = monuments[0]
    expect(k.name).toBe('Kerafyrm the Sleeper')
    expect(k.sealed).toBe(false)
    expect(k.accent).toBe('#9fd8ff')
    expect(k.meta).toBe('4 ranked clears · 4 who have done it')
    expect(k.fell).toBe('record fell yesterday')
    expect(k.brackets).toEqual([
      { label: 'Solo', count: 3 },
      { label: 'Duo', count: 1 },
      { label: 'Trio', count: 0 }
    ])
    expect(k.marks.map((m) => m.key)).toEqual(['first', 'fastest', 'dps'])
    for (const mark of k.marks) expect(mark.cells.map((c) => c.bracket)).toEqual(['Solo', 'Duo', 'Trio'])
  })

  it('reads a cell: value, date and the party with their classes', () => {
    const fastest = monuments[0].marks[1]
    expect(fastest.cells[0]).toEqual({
      bracket: 'Solo',
      open: false,
      value: '17s',
      date: '2026-09-18',
      party: [{ name: 'Vegetabaal', classes: ['War', 'Pal', 'Mnk'] }]
    })
    const duo = fastest.cells[1]
    expect(duo.value).toBe('4:42')
    expect(duo.party.map((p) => p.name)).toEqual(['Anewt', 'Singabaal'])
    // The Bard crest is a GIF with a different class on its element, and its
    // title is still the class.
    expect(duo.party[1].classes).toEqual(['Rng', 'Brd', 'Rog'])
    expect(fastest.cells[2]).toEqual({ bracket: 'Trio', open: true, value: null, date: null, party: [] })
  })

  it('reads the first-clear row as dates', () => {
    expect(monuments[0].marks[0].cells[0].value).toBe('2026-09-10')
    expect(monuments[0].marks[0].cells[0].date).toBeNull()
  })

  it('reads a sealed monument as sealed, with its subtitle', () => {
    const uqua = monuments.find((m) => m.key === 'uqua')!
    expect(uqua.sealed).toBe(true)
    expect(uqua.subtitle).toBe('Uqua, the Ocean God Chantry')
    expect(uqua.meta).toBe('unclaimed')
    expect(uqua.marks).toEqual([])
    expect(uqua.url).toBe('https://tscemu.com/leaderboards/boss/uqua')
  })

  it('is loud rather than empty when the markup has moved', () => {
    expect(() => parseMonuments('<div class="nothing"></div>', 'https://tscemu.com')).toThrow(/markup/)
  })
})

describe('search rows as hover cards', () => {
  it('reads the item results', () => {
    const rows = parseSearchRows(fixture('search-items.html'))
    expect(rows).toHaveLength(9)
    expect(rows[0]).toEqual({
      id: 2001001,
      name: 'Cloth Cap (Legendary)',
      num: '4 AC · +10 HP · +10 Mana',
      meta: 'Armor · Head · All Classes'
    })
  })

  it('picks the exact name, tier suffix aside, and nothing looser', () => {
    const rows = parseSearchRows(fixture('search-items.html'))
    // The site shows the best tier of each item, so "Cloth Cap" comes back as
    // "Cloth Cap (Legendary)" - the same item, and the log never writes the tier.
    expect(exactSearchRow(rows, 'Cloth Cap')?.id).toBe(2001001)
    expect(exactSearchRow(rows, 'cloth cap')?.id).toBe(2001001)
    // "Cloth Cape" and "Large Cloth Cap" are in the list and must not match.
    expect(exactSearchRow(rows, 'Cloth Ca')).toBeNull()
  })

  it('turns an item row into a card without inventing anything', () => {
    const rows = parseSearchRows(fixture('search-items.html'))
    const tip = tipFromSearchRow('item', exactSearchRow(rows, 'Cloth Cap')!)
    expect(tip).toEqual({
      kind: 'item',
      name: 'Cloth Cap',
      id: 2001001,
      notes: ['Armor · Head · All Classes'],
      stats: [
        { label: 'AC', value: '4' },
        { label: 'HP', value: '+10' },
        { label: 'Mana', value: '+10' }
      ],
      extras: []
    })
  })

  it('turns a spell row into a card with its one effect line and class', () => {
    const rows = parseSearchRows(fixture('search-spells.html'))
    const tip = tipFromSearchRow('spell', exactSearchRow(rows, 'Complete Heal')!)
    expect(tip.kind).toBe('spell')
    if (tip.kind !== 'spell') return
    expect(tip.id).toBe(13)
    expect(tip.effects).toEqual(['Increase Hitpoints by 7500'])
    expect(tip.classes).toEqual([{ abbrev: 'Clr', level: 39 }])
    expect(tip.mana).toBeNull()
  })
})

describe('tipFromJson', () => {
  it('reads the site\'s item answer', () => {
    const r = tipFromJson('item', {
      found: true,
      kind: 'item',
      id: 1001,
      name: 'Cloth Cap',
      notes: ['Armor · Head', 'All Classes · All Races'],
      stats: [{ label: 'AC', value: '2' }, { label: 'Weight', value: '0.2' }],
      extras: ['Slot 1: type 7'],
      url: '/items/1001'
    })
    expect(r?.found).toBe(true)
    expect(r?.tip).toEqual({
      kind: 'item',
      name: 'Cloth Cap',
      id: 1001,
      notes: ['Armor · Head', 'All Classes · All Races'],
      stats: [{ label: 'AC', value: '2' }, { label: 'Weight', value: '0.2' }],
      extras: ['Slot 1: type 7']
    })
  })

  it('reads the site\'s spell answer, milliseconds and all', () => {
    const r = tipFromJson('spell', {
      found: true,
      kind: 'spell',
      id: 13,
      name: 'Complete Heal',
      mana: 400,
      cast_ms: 10000,
      recast_ms: 0,
      duration_ticks: 0,
      range: 100,
      resist: '',
      resist_type: 1,
      effects: ['Increase Hitpoints by 7500'],
      classes: [{ name: 'Cleric', abbr: 'CLR', level: 39 }]
    })
    expect(r?.tip).toEqual({
      kind: 'spell',
      name: 'Complete Heal',
      id: 13,
      mana: 400,
      castSeconds: 10,
      recastSeconds: null,
      durationTicks: null,
      range: 100,
      resist: 'Magic',
      effects: ['Increase Hitpoints by 7500'],
      classes: [{ abbrev: 'Clr', level: 39 }]
    })
  })

  it('treats a miss as a real answer and a wrong shape as no answer', () => {
    expect(tipFromJson('item', { found: false })).toEqual({ found: false, tip: null })
    expect(tipFromJson('item', { hello: 'world' })).toBeNull()
    expect(tipFromJson('item', 'nope')).toBeNull()
    expect(tipFromJson('item', { found: true, name: 'x' })).toBeNull()
  })
})

describe('readChampions', () => {
  it('reads the site\'s /champions answer', () => {
    const c = readChampions(JSON.parse(fixture('champions.json')), 'https://tscemu.com')
    expect(c.ranked).toBe(13)
    expect(c.leaders[0]).toEqual({
      place: 1,
      name: 'Vegetabaal',
      display: '1,000',
      level: 65,
      classes: ['Warrior', 'Paladin', 'Monk']
    })
    expect(c.kills).toBe(4548)
    expect(c.events).toHaveLength(7)
    expect(c.events[0]).toMatchObject({
      kind: 'clear',
      first: false,
      name: 'Kerafyrm the Sleeper',
      bracket: 'Solo',
      duration: '4:09',
      dps: 4914
    })
    expect(c.events[0].party).toEqual([{ name: 'Einnod', classes: ['MAG', 'ENC', 'BST'] }])
    expect(c.events[1]).toMatchObject({ kind: 'born', name: 'Lihar' })
    expect(c.chronicle[0]).toEqual({
      title: 'First soul',
      who: 'Deezel',
      detail: 'the first character created on this server',
      date: '17 Aug 2026',
      url: null
    })
    expect(c.chronicle[1].url).toBe('https://tscemu.com/guilds/2')
    expect(c.newest).toEqual({ name: 'Lihar', when: '2026-09-18 19:04' })
    expect(c.raidsUrl).toBe('https://tscemu.com/leaderboards/raids')
  })

  it('survives an empty or malformed answer', () => {
    const c = readChampions({}, 'https://tscemu.com')
    expect(c.leaders).toEqual([])
    expect(c.events).toEqual([])
    expect(c.newest).toBeNull()
    expect(readChampions(null, 'https://tscemu.com').ranked).toBe(0)
  })
})
