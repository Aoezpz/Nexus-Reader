import { HTMLElement, parse } from 'node-html-parser'
import { abbrevOf } from '@shared/roster'
import { allSteps, type ProgressionData } from '@shared/progression'
import type { Monument, RecordCell, RecordMark } from '@shared/leaderboard'
import type { ItemTip, SpellTip, Tip, TipKind } from '@shared/tooltip'
import { RESIST_NAMES } from '@shared/tooltip'

/**
 * Readers for the server website's markup - tscemu.com, as served.
 *
 * Pure functions, string in and data out, kept apart from the module that
 * fetches so the tests can feed them the site's real pages (tests/fixtures/tsc,
 * cut from live responses) instead of the network. The fetch path and the
 * tested path are the same code, not two walks that agree today.
 *
 * Every selector here was read off the site's own source
 * (tscemu-site/app/browse.py), not guessed from a screenshot. When the site's
 * markup moves, these are the lines that break - and they break loudly: a
 * page that yields nothing throws rather than reporting an empty world.
 */

/** Collapse whitespace the way HTML does, so scraped text compares cleanly. */
export const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()

const num = (s: string | undefined | null): number | null => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s ?? '')
  if (!m) return null
  const n = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/* ---------------------------------------------------------------------------
   Who is this
--------------------------------------------------------------------------- */

export interface SiteCharacter {
  /**
   * The site's key for the character, which is the name as it appears in the
   * URL (`/characters/<name>`). A string, because the site addresses
   * characters by name and has no numeric id to give.
   */
  id: string
  name: string
  level: number | null
  race: string | null
  /** In the app's own abbreviations - `['War', 'Clr', 'Mnk']`. */
  classes: string[]
  guild: string | null
  /** The site's gear score. */
  score: number | null
  /** Place among everyone running this exact trio, and how many that is. */
  trioRank: number | null
  trioOf: number | null
  overallRank: number | null
}

/**
 * Find a character by exact name in a `/characters?q=` result page.
 *
 * The search is a LIKE, so "Aod" would match "Aodeez" and "Aodrian". Only an
 * exact, case-insensitive name match is accepted; syncing the wrong
 * character's flags would be worse than syncing none.
 *
 * Rows are `ul.results.chars > li > a.chrow` (browse.character_results_html):
 * the trio plate, `.nm`, `.num` ("level 65<i>412 gear</i>") and `.meta` with
 * the three classes as full names.
 */
export function parseCharacterRows(html: string, name: string): SiteCharacter | null {
  const root = parse(html)
  const wanted = name.toLowerCase()

  for (const row of root.querySelectorAll('a.chrow')) {
    const found = clean(row.querySelector('.nm')?.text)
    if (found.toLowerCase() !== wanted) continue

    const href = row.getAttribute('href') ?? ''
    const key = /\/characters\/([^/?#]+)/.exec(href)?.[1]
    const id = key ? safeDecode(key) : found

    // `.num` is "level 65<i>412 gear</i>": the level is the number before the
    // <i>, and the score - when there is one - is inside it. An unrated
    // character carries <i class="none">unrated</i> instead, which num() reads
    // as nothing.
    const numEl = row.querySelector('.num')
    const levelText = clean(
      numEl?.childNodes.map((n) => (n instanceof HTMLElement ? '' : n.text)).join('')
    )
    const scoreText = clean(numEl?.querySelector('i')?.text)

    // The plate: "2 of 2 rated Warrior / Cleric / Monk characters, on gear
    // score" in its title, a dash when unplaced.
    const plate = row.querySelector('.trank')
    const plateTitle = plate?.getAttribute('title') ?? ''
    const placed = /(\d+)\s+of\s+(\d+)/.exec(plateTitle)

    return {
      id,
      name: found,
      level: num(levelText),
      race: null,
      classes: clean(row.querySelector('.meta')?.text)
        .split('·')
        .map((c) => abbrevOf(c))
        .filter((c): c is string => c !== null),
      guild: null,
      score: /unrated/i.test(scoreText) ? null : num(scoreText),
      trioRank: placed ? Number(placed[1]) : null,
      trioOf: placed ? Number(placed[2]) : null,
      overallRank: null
    }
  }
  return null
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/* ---------------------------------------------------------------------------
   The road: gates and flags
--------------------------------------------------------------------------- */

export interface SiteProgress {
  level: number | null
  /** App abbreviations, from the chips under the name. */
  classes: string[]
  /** Step keys, in the app's own key format, that the site shows as earned. */
  earned: string[]
  /**
   * Steps the site draws in its third state: a gate boss this character has
   * a logged kill on, that the account is NOT flagged for - a kill outside a
   * progression instance. Reported, never marked as earned.
   */
  killedUnflagged: string[]
  /** Steps the site shows that the bundled data has no entry for. */
  unknownSteps: string[]
}

/**
 * Read one character's `/characters/<name>/progression` page.
 *
 * Two structures on the page, both read the way the export script wrote the
 * bundled data (scripts/export-progression.mjs), so keys match by
 * construction:
 *
 *   * the four doors - `article.pgdoor`, its `h3` the chapter title, each
 *     `li.pgboss` a step with `.pgname`;
 *   * the five tiers - `details.pgtier`, its `.pgtname` the chapter title,
 *     each `li.pgstep` a step with `.pgname`.
 *
 * `done` on the li is earned. `part` is the third state (see
 * SiteProgress.killedUnflagged). Anything that does not match the bundled
 * data is reported rather than dropped - a silent mismatch would look like
 * "you are less flagged than you are".
 */
export function parseProgression(html: string, data: ProgressionData): SiteProgress {
  const root = parse(html)

  const chips = root.querySelector('.clchips')
  const level = num(clean(chips?.querySelector('.lvl')?.text))
  const classes = (chips?.querySelectorAll('.cl') ?? [])
    .map((c) => abbrevOf(clean(c.text)))
    .filter((c): c is string => c !== null)

  const byName = new Map<string, string>()
  for (const { chapter, step, key } of allSteps(data)) {
    byName.set(`${chapter.title}|${step.name}`.toLowerCase(), key)
    // Names are unique enough in practice; the fallback covers a chapter being
    // retitled on the site without the bundled data being regenerated.
    if (!byName.has(step.name.toLowerCase())) byName.set(step.name.toLowerCase(), key)
  }

  const earned: string[] = []
  const killedUnflagged: string[] = []
  const unknownSteps: string[] = []

  const take = (title: string, li: HTMLElement): void => {
    const stepName = clean(li.querySelector('.pgname')?.text)
    if (!stepName) return
    const done = li.classList.contains('done')
    const part = li.classList.contains('part')
    if (!done && !part) return

    const key = byName.get(`${title}|${stepName}`.toLowerCase()) ?? byName.get(stepName.toLowerCase())
    if (!key) {
      unknownSteps.push(`${title} / ${stepName}`)
      return
    }
    if (done) earned.push(key)
    else killedUnflagged.push(key)
  }

  for (const door of root.querySelectorAll('article.pgdoor')) {
    const title = clean(door.querySelector('h3')?.text)
    for (const li of door.querySelectorAll('li.pgboss')) take(title, li)
  }
  for (const tier of root.querySelectorAll('details.pgtier')) {
    const title = clean(tier.querySelector('.pgtname')?.text)
    for (const li of tier.querySelectorAll('li.pgstep')) take(title, li)
  }

  return { level, classes, earned, killedUnflagged, unknownSteps }
}

/* ---------------------------------------------------------------------------
   The raid records
--------------------------------------------------------------------------- */

/**
 * The monuments on `/leaderboards/raids` (browse.monuments_html).
 *
 * One `article.encard.mon` per encounter, carrying a `.matrix` of marks down
 * (First clear, Fastest kill, DPS) by party sizes across (Solo, Duo, Trio).
 * The matrix is a flat run of children: a `.mh.col` per bracket, then for
 * each mark a `.mh.row` followed by one `.cell` per bracket, in order. The
 * order is the structure, so it is walked rather than queried.
 *
 * A `sealed` card is an encounter nobody has done, and carries no matrix.
 */
export function parseMonuments(html: string, base: string): Monument[] {
  const root = parse(html)
  const out: Monument[] = []

  for (const card of root.querySelectorAll('article.encard')) {
    const link = card.querySelector('.ename h3 a')
    const name = clean(link?.text)
    if (!name) continue

    const href = link?.getAttribute('href') ?? ''
    const key =
      /^mon-(.+)$/.exec(card.getAttribute('id') ?? '')?.[1] ??
      /\/leaderboards\/boss\/([^/?#]+)/.exec(href)?.[1] ??
      name.toLowerCase()

    const metaEl = card.querySelector('.ename .meta')
    const metaBits = (metaEl?.querySelectorAll('span') ?? [])
      .filter((s) => !s.classList.contains('rsub') && !s.classList.contains('fell'))
      .map((s) => clean(s.text))
      .filter(Boolean)

    const brackets = card
      .querySelectorAll('.matrix .mh.col')
      .map((h) => ({
        label: clean(h.childNodes.map((n) => (n instanceof HTMLElement ? '' : n.text)).join('')),
        count: num(clean(h.querySelector('i')?.text)) ?? 0
      }))

    const marks: RecordMark[] = []
    const matrix = card.querySelector('.matrix')
    let current: RecordMark | null = null
    for (const child of matrix?.childNodes ?? []) {
      if (!(child instanceof HTMLElement)) continue
      if (child.classList.contains('mh') && child.classList.contains('row')) {
        const label = clean(child.text)
        current = { key: markKey(label), label, cells: [] }
        marks.push(current)
        continue
      }
      if (!current || !child.classList.contains('cell')) continue
      const bracket = brackets[current.cells.length]?.label ?? `#${current.cells.length + 1}`
      current.cells.push(parseCell(child, bracket))
    }

    out.push({
      key,
      ordinal: clean(card.querySelector('.eord')?.text) || null,
      name,
      subtitle: clean(metaEl?.querySelector('.rsub')?.text) || null,
      meta: metaBits.join(' · ') || null,
      fell: clean(metaEl?.querySelector('.fell')?.text) || null,
      accent: /--accent:\s*(#[0-9a-f]{3,8})/i.exec(card.getAttribute('style') ?? '')?.[1] ?? null,
      sealed: card.classList.contains('sealed') || marks.length === 0,
      brackets,
      marks,
      url: href ? new URL(href, base).toString() : base
    })
  }

  if (out.length === 0) {
    throw new Error('no monuments found — the raid records page markup has changed')
  }
  return out
}

function markKey(label: string): RecordMark['key'] {
  const l = label.toLowerCase()
  if (l.startsWith('first')) return 'first'
  if (l.startsWith('fastest')) return 'fastest'
  if (l === 'dps') return 'dps'
  return l
}

function parseCell(cell: HTMLElement, bracket: string): RecordCell {
  if (cell.classList.contains('open')) {
    return { bracket, open: true, value: null, date: null, party: [] }
  }
  const party = cell.querySelectorAll('.who').map((who) => ({
    name: clean(who.querySelector('.wn')?.text),
    // The crests are the client's class icons, each titled with the full
    // class name. The title is the only text there is.
    classes: who
      .querySelectorAll('.crest')
      .map((c) => abbrevOf(c.getAttribute('title') ?? ''))
      .filter((c): c is string => c !== null)
  }))
  return {
    bracket,
    open: false,
    value: clean(cell.querySelector('.v')?.text) || null,
    date: clean(cell.querySelector('.d')?.text) || null,
    party
  }
}

/* ---------------------------------------------------------------------------
   Hover cards
--------------------------------------------------------------------------- */

/** One row of a `/search?q=&in=items|spells` result list. */
export interface SearchRow {
  id: number
  name: string
  /** "4 AC · +10 HP · +10 Mana" for an item; the first effect line for a spell. */
  num: string
  /** "Armor · Head · All Classes" / "Alteration · Single · Cleric 39". */
  meta: string
}

/**
 * The `ul.results` list the site's search renders for items and spells
 * (browse.search_view). Each row links to `/items/<id>` or `/spells/<id>`
 * and carries a one-line summary, which is the whole of what the fallback
 * card can honestly show.
 */
export function parseSearchRows(html: string): SearchRow[] {
  const root = parse(html)
  const out: SearchRow[] = []
  for (const a of root.querySelectorAll('ul.results > li > a')) {
    const href = a.getAttribute('href') ?? ''
    const id = Number(/\/(?:items|spells|discs)\/(\d+)/.exec(href)?.[1] ?? 0)
    if (!id) continue
    out.push({
      id,
      name: clean(a.querySelector('.nm')?.text),
      num: clean(a.querySelector('.num')?.text),
      meta: clean(a.querySelector('.meta')?.text)
    })
  }
  return out
}

/** The tier the site appends to an upgraded copy's name - not part of the name the log uses. */
const TIER_SUFFIX = /\s*\((?:Enchanted|Legendary)\)$/i

/** The row whose name is exactly this, tier suffix aside. */
export function exactSearchRow(rows: SearchRow[], name: string): SearchRow | null {
  const wanted = name.toLowerCase()
  return (
    rows.find((r) => r.name.toLowerCase() === wanted) ??
    rows.find((r) => r.name.replace(TIER_SUFFIX, '').toLowerCase() === wanted) ??
    null
  )
}

/**
 * A card from a search row alone.
 *
 * This is the fallback for a site that has not deployed the tip endpoint,
 * and it is deliberately modest: the row's summary line is split into stats
 * ("4 AC" -> AC: 4, "+10 HP" -> HP: +10) and its type line kept as a note.
 * Nothing is invented to fill the card out.
 */
export function tipFromSearchRow(kind: TipKind, row: SearchRow): Tip {
  if (kind === 'item') {
    const stats: ItemTip['stats'] = []
    for (const bit of row.num.split('·').map(clean).filter(Boolean)) {
      // "4 AC", "+10 HP", "38/44" (damage/delay), "+100 End"
      const m = /^([+-]?\d[\d,]*(?:\/\d+)?)\s+(.+)$/.exec(bit)
      if (m) stats.push({ label: m[2], value: m[1] })
      else stats.push({ label: bit, value: '' })
    }
    return {
      kind: 'item',
      name: row.name.replace(TIER_SUFFIX, ''),
      id: row.id,
      notes: row.meta ? [row.meta] : [],
      stats: stats.filter((s) => s.value !== ''),
      extras: stats.filter((s) => s.value === '').map((s) => s.label)
    }
  }

  const classes: SpellTip['classes'] = []
  for (const bit of row.meta.split('·').map(clean)) {
    const m = /^(.+?)\s+(\d+)$/.exec(bit)
    const abbrev = m ? abbrevOf(m[1]) : null
    if (m && abbrev) classes.push({ abbrev, level: Number(m[2]) })
  }
  return {
    kind: 'spell',
    name: row.name,
    id: row.id,
    mana: null,
    castSeconds: null,
    recastSeconds: null,
    durationTicks: null,
    range: null,
    resist: null,
    effects: row.num ? [row.num] : [],
    classes
  }
}

/**
 * A card from the site's own `/items/tip` and `/spells/tip` answer
 * (tscemu-site/app/server.py, page_tip). The shape is the app's own, agreed
 * on both sides; what this does is refuse to trust it blindly - every field
 * is coerced, so a site that changes a type cannot crash a hover.
 */
export function tipFromJson(kind: TipKind, json: unknown): { found: boolean; tip: Tip | null } | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.found !== 'boolean') return null
  if (!o.found) return { found: false, tip: null }

  const id = int(o.id)
  const name = str(o.name)
  if (id === null || !name) return null

  if (kind === 'item') {
    return {
      found: true,
      tip: {
        kind: 'item',
        name,
        id,
        notes: strings(o.notes),
        stats: pairs(o.stats),
        extras: strings(o.extras)
      }
    }
  }

  const resistId = int(o.resist_type)
  const classes: SpellTip['classes'] = []
  if (Array.isArray(o.classes)) {
    for (const c of o.classes) {
      if (!c || typeof c !== 'object') continue
      const cc = c as Record<string, unknown>
      const abbrev = abbrevOf(str(cc.abbr) || str(cc.name))
      const level = int(cc.level)
      if (abbrev && level !== null && level > 0) classes.push({ abbrev, level })
    }
  }
  const ms = (v: unknown): number | null => {
    const n = int(v)
    return n !== null && n > 0 ? n / 1000 : null
  }
  return {
    found: true,
    tip: {
      kind: 'spell',
      name,
      id,
      mana: positive(o.mana),
      castSeconds: ms(o.cast_ms),
      recastSeconds: ms(o.recast_ms),
      durationTicks: positive(o.duration_ticks),
      range: positive(o.range),
      resist: str(o.resist) || (resistId !== null ? (RESIST_NAMES[resistId] ?? null) : null),
      effects: strings(o.effects),
      classes
    }
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const int = (v: unknown): number | null => {
  const n = Number(v)
  return v !== null && v !== '' && Number.isFinite(n) ? n : null
}
const positive = (v: unknown): number | null => {
  const n = int(v)
  return n !== null && n > 0 ? n : null
}
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
const pairs = (v: unknown): Array<{ label: string; value: string }> =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({ label: str(x.label), value: str(x.value) }))
        .filter((x) => x.label)
    : []
