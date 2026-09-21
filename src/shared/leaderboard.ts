/**
 * The raid records, as the app models them.
 *
 * The server's website owns this data - the game writes a row for every
 * character standing there when a raid boss dies, and the site folds those
 * into clears (tscemu-site/app/raids.py) - so the app never computes or
 * submits any of it. This is a read-only window onto the site's monuments, so
 * you can see where the records stand without leaving the game.
 *
 * A monument is one encounter. Its matrix runs marks down (first clear,
 * fastest kill, DPS) and party sizes across (solo, duo, trio), which is the
 * site's own layout: "what is the trio record" is a column and "who was
 * first" is a row.
 */

export interface RecordParty {
  name: string
  /** The app's abbreviations - `['War', 'Pal', 'Mnk']`. */
  classes: string[]
}

export interface RecordCell {
  /** "Solo", "Duo", "Trio" - the column this cell sits in. */
  bracket: string
  /** Nobody has done it at this party size. */
  open: boolean
  /** "17s", "73,845", or a date for the first-clear row. Null when open. */
  value: string | null
  /** When it happened, for the rows whose value is not itself a date. */
  date: string | null
  party: RecordParty[]
}

export interface RecordMark {
  key: 'first' | 'fastest' | 'dps' | string
  label: string
  /** One per bracket, in the monument's bracket order. */
  cells: RecordCell[]
}

export interface Monument {
  key: string
  /** "I" .. "IX" - the encounter's place in the site's own order. */
  ordinal: string | null
  name: string
  /** "Full gauntlet", "Uqua, the Ocean God Chantry". */
  subtitle: string | null
  /** "4 ranked clears · 4 who have done it", or "unclaimed". */
  meta: string | null
  /** "record fell yesterday", when the site says. */
  fell: string | null
  /** The accent the site gives this encounter, reused so the two agree. */
  accent: string | null
  /** Nobody has done it at all. No matrix. */
  sealed: boolean
  brackets: Array<{ label: string; count: number }>
  marks: RecordMark[]
  /** Deep link back to the encounter on the site. */
  url: string
}

export interface LeaderboardData {
  monuments: Monument[]
  /** Epoch ms this snapshot was fetched. */
  fetchedAt: number
  source: string
}

export interface LeaderboardResult {
  data: LeaderboardData | null
  /** Populated when the fetch or the parse failed; the UI shows it verbatim. */
  error: string | null
  /** True while a fetch is in flight and we're showing a cached copy. */
  stale: boolean
}
