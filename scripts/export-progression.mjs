/**
 * Extracts the road to the Plane of Time from the server's website into
 * `data/progression.json`, which the app bundles.
 *
 * The page it reads is per-character (`/characters/<name>/progression`), but
 * only the STATE is - the doors, tiers, bosses and flags are the same for
 * everyone. So this takes the definitions and throws the character's ticks
 * away; the app tracks state itself, from the log, and can seed from the site
 * at runtime.
 *
 * The chapter titles written here are read back by src/main/siteparse.ts when
 * it syncs a character - the door's `h3` and the tier's `.pgtname`, verbatim -
 * so the two agree by construction rather than by care.
 *
 *   node scripts/export-progression.mjs
 *   node scripts/export-progression.mjs --base https://tscemu.com --character Aodeez
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from 'node-html-parser'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const BASE = args.get('base') ?? 'https://tscemu.com'
const CHARACTER = args.get('character') ?? 'Aodeez'
const OUT = args.get('out') ?? join(process.cwd(), 'data', 'progression.json')
const URL_ = `${BASE}/characters/${encodeURIComponent(CHARACTER)}/progression`

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * What kind of step this is, which decides whether the log can see it.
 *
 * The site does not say outright, but it says enough: a step whose note tells
 * you to hail somebody is a hail; a trial you choose one of, or a run of
 * deliveries, is an event; a gate boss is a kill. The rule is written down
 * here so a wrong call is a line to fix, not a guess to argue about - and the
 * app labels every non-kill "by hand" on the page, so a wrong call is visible
 * rather than silent.
 */
function kindOf(name, note, hasPick) {
  const known = KNOWN_KINDS[name]
  if (known) return known
  if (hasPick) return 'event'
  if (/\bhail\b|conversation, not a fight|speak to him again/i.test(note)) return 'hail'
  if (/^(a|the) trial\b/i.test(name)) return 'event'
  if (/deliver|gathered from|handed over/i.test(note)) return 'event'
  return 'kill'
}

/**
 * Steps the wording rule gets wrong, settled by name. Each is a case where
 * the note says one thing and the step is another: Saryrn's note ends "back
 * down the tower to report it", but Saryrn is a kill; the Carprin line's note
 * says "hail him, do not kill him" about ONE member of a line you otherwise
 * kill your way down. The Maelins are conversations whose notes never use the
 * word.
 */
const KNOWN_KINDS = {
  'Loreseeker Maelin': 'hail',
  'Grand Librarian Maelin': 'hail',
  "Mavuin's case": 'hail',
  'The Carprin line': 'event',
  Saryrn: 'kill',
  'The Manaetic Behemoth': 'kill',
  'A Construct of Nightmares': 'kill'
}

/**
 * The name the log writes when the thing dies. "Fennin Ro, the Tyrant of
 * Fire" is the site's title; the corpse is "Fennin Ro". Everything after the
 * first comma is title, not name.
 */
function mobOf(name) {
  const mob = name.replace(/,.*$/, '').trim()
  return mob === name ? null : mob
}

const res = await fetch(URL_)
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
const root = parse(await res.text())

// ---- the four doors ------------------------------------------------------

const doors = []
for (const door of root.querySelectorAll('article.pgdoor')) {
  const title = clean(door.querySelector('h3')?.text)
  if (!title) continue
  // "Door 1 · RoK"
  const dnum = clean(door.querySelector('.pgdnum')?.text)
  const era = dnum.split('·').map(clean).filter(Boolean).pop() ?? null

  const steps = door.querySelectorAll('li.pgboss').map((li) => {
    const name = clean(li.querySelector('.pgname')?.text)
    return {
      name,
      badge: null,
      stages: 1,
      mob: mobOf(name),
      kind: 'kill',
      zone: clean(li.querySelector('.pgwhere')?.text) || null,
      level: Number(clean(li.querySelector('.pglvl')?.text)) || null,
      how: null,
      opens: null
    }
  })

  // "27 zones" + "Chardok · Chardok: The Halls of Betrayal · … · and 20 more"
  const unlock = door.querySelector('.pgunlock')
  const opens = unlock
    ? `${clean(unlock.querySelector('b')?.text)}: ${clean(unlock.querySelector('span')?.text)}`
    : null

  doors.push({
    id: `door-${doors.length + 1}-${slug(title)}`,
    title,
    era: dnum || era,
    blurb: null,
    opens,
    rows: steps.length,
    stages: steps.length,
    badgeCount: Number(/(\d+)\s+of\s+(\d+)/.exec(clean(door.querySelector('.pgdcount')?.text))?.[2] ?? 0) || null,
    groups: [{ plane: null, planeShort: null, steps }]
  })
}

// ---- the five tiers ------------------------------------------------------

const tiers = []
for (const tier of root.querySelectorAll('details.pgtier')) {
  const title = clean(tier.querySelector('.pgtname')?.text)
  if (!title) continue
  const era = clean(tier.querySelector('.pgnum')?.text) || null

  const groups = []
  for (const grp of tier.querySelectorAll('.pggroup')) {
    const h4 = grp.querySelector('h4')
    const plane = clean(h4?.childNodes.map((n) => (n.rawTagName === 'span' ? '' : n.text)).join('')) || null

    const steps = []
    for (const li of grp.querySelectorAll('li.pgstep')) {
      const name = clean(li.querySelector('.pgname')?.text)
      if (!name) continue
      const note = clean(li.querySelector('.pgnote')?.text)
      // "2 of 2 stages · Plane of Innovation" - the stage count rides in
      // front of the zone, separated by the middle dot.
      const where = clean(li.querySelector('.pgwhere')?.text)
      const bits = where.split('·').map(clean)
      const stageBit = bits.find((b) => /stages?$/.test(b))
      const stages = Number(/of\s+(\d+)\s+stages?/.exec(stageBit ?? '')?.[1] ?? 1) || 1
      const zone = bits.filter((b) => b !== stageBit).join(' · ') || plane
      const hasPick = !!li.querySelector('.pgpick')
      const kind = kindOf(name, note, hasPick)

      steps.push({
        name,
        badge: stages > 1 ? `${stages} stages` : null,
        stages,
        mob: kind === 'kill' ? mobOf(name) : null,
        kind,
        zone,
        level: null,
        how: note || null,
        opens: clean(li.querySelector('.pgopens')?.text) || null
      })
    }
    if (steps.length > 0) groups.push({ plane, planeShort: null, steps })
  }

  const rows = groups.reduce((n, g) => n + g.steps.length, 0)
  const stages = groups.reduce((n, g) => n + g.steps.reduce((m, s) => m + s.stages, 0), 0)
  const badgeCount = Number(/(\d+)\s+of\s+(\d+)/.exec(clean(tier.querySelector('.pgtcount')?.text))?.[2] ?? 0) || null
  if (badgeCount !== null && badgeCount !== rows) {
    console.warn(`  note "${title}": page counts ${badgeCount}, rows ${rows}`)
  }

  tiers.push({
    id: `tier-${tiers.length + 1}-${slug(title)}`,
    title,
    era,
    blurb: clean(tier.querySelector('.pgblurb')?.text) || null,
    opens: null,
    rows,
    stages,
    badgeCount,
    groups
  })
}

const sections = []
if (doors.length > 0) {
  const bosses = doors.reduce((n, d) => n + d.rows, 0)
  sections.push({
    id: 'the-expansion-gates',
    name: 'The expansion gates',
    detail: `${bosses} bosses · ${doors.length} doors`,
    chapters: doors
  })
}
if (tiers.length > 0) {
  const flags = tiers.reduce((n, t) => n + t.rows, 0)
  sections.push({
    id: 'the-road-to-time',
    name: 'The road to Time',
    detail: `${flags} flags · ${tiers.length} tiers`,
    chapters: tiers
  })
}

const total = sections.reduce((s, sec) => s + sec.chapters.reduce((c, ch) => c + ch.rows, 0), 0)
if (total === 0) {
  console.error('extracted nothing - the page markup has changed; fix the selectors above')
  process.exit(1)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: URL_,
      extractedAt: new Date().toISOString(),
      note: 'Definitions only. Per-character state is tracked by the app, never taken from this file. Flags are account-wide on this server, and a kill outside a progression instance grants no flag.',
      sections
    },
    null,
    2
  )}\n`
)

console.log(`wrote ${OUT} (${total} steps)`)
for (const sec of sections) {
  console.log(`  ${sec.name}: ${sec.chapters.length} chapters`)
  for (const ch of sec.chapters) {
    const kinds = ch.groups.flatMap((g) => g.steps).reduce((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {})
    console.log(`    ${ch.title} — ${ch.rows} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`)
  }
}
