import type { ProgressionData } from '@shared/progression'
import type { Champions, ChampionsResult, WorldStatus } from '@shared/site'
import { clean, request, root } from './http'
import { parseCharacterRows, parseProgression, type SiteCharacter, type SiteProgress } from './siteparse'

/**
 * The server's website, asked for the things the log cannot say.
 *
 *   * **What level am I, and what am I?** A log states a level only when you
 *     ding, and never states a class. The site knows both, because the game
 *     server tells it.
 *   * **What am I flagged for?** Flags earned before the app existed are not
 *     in any log it will ever see - and on this server a kill is not a flag
 *     (see parseProgression).
 *   * **Who is in the world, and what happened tonight?** Two JSON answers the
 *     site already serves for its own homepage, read here for the title bar
 *     and the Server page.
 *
 * Every call is a GET of a public page, through the app's one request
 * helper. Nothing is written anywhere and no credential is ever attached.
 */

export type { SiteCharacter, SiteProgress }

/** Find a character by exact name. Null is a real answer: no such character. */
export async function findCharacter(base: string, name: string): Promise<SiteCharacter | null> {
  const html = await request(`${root(base)}/characters?q=${encodeURIComponent(clean(name))}`)
  return parseCharacterRows(html, name)
}

/** Read one character's road and translate it into step keys. */
export async function fetchProgress(
  base: string,
  character: SiteCharacter,
  data: ProgressionData
): Promise<SiteProgress> {
  const html = await request(`${root(base)}/characters/${encodeURIComponent(character.id)}/progression`)
  return parseProgression(html, data)
}

/* ---------------------------------------------------------------------------
   The two JSON answers
--------------------------------------------------------------------------- */

/**
 * How often the world count is re-asked. The site's own collector only moves
 * the number once a minute, so asking more often than that is asking the
 * same question twice.
 */
const WORLD_TTL_MS = 60_000
/** The Hall's answer is cached a minute on the site; five here keeps a busy evening to a dozen requests. */
const CHAMPIONS_TTL_MS = 5 * 60_000

let world: WorldStatus | null = null
let worldInflight: Promise<WorldStatus | null> | null = null

/**
 * Souls in the world, from `/world`.
 *
 * `counting: false` is a different fact from `souls: 0` - the first means
 * nothing is measuring, the second means nobody is on - and the app keeps the
 * distinction: a title bar that showed "0 souls" because the site's timer
 * died would be stating something it does not know. Unreachable is null.
 */
export function fetchWorld(base: string, now = Date.now()): Promise<WorldStatus | null> {
  if (!base) return Promise.resolve(null)
  if (world && now - world.fetchedAt < WORLD_TTL_MS) return Promise.resolve(world)
  if (worldInflight) return worldInflight

  worldInflight = request(`${root(base)}/world`)
    .then((text) => {
      const o = JSON.parse(text) as Record<string, unknown>
      world = {
        counting: o.counting === true,
        souls: Number(o.souls) || 0,
        characters: Number(o.characters) || 0,
        fetchedAt: Date.now()
      }
      return world
    })
    .catch(() => world)
    .finally(() => {
      worldInflight = null
    })
  return worldInflight
}

let champions: Champions | null = null
let championsInflight: Promise<ChampionsResult> | null = null

/**
 * Who holds each board and what happened lately, from `/champions`.
 *
 * Read as-is and passed through with its shape checked at the edges: the
 * podium, the thirty-day feed, the chronicle of firsts and the newest
 * character. The app draws it; it computes none of it.
 */
export function fetchChampions(base: string, force = false): Promise<ChampionsResult> {
  if (!base) {
    return Promise.resolve({ data: null, error: 'No server website configured — set one in Preferences.', stale: false })
  }
  if (!force && champions && Date.now() - champions.fetchedAt < CHAMPIONS_TTL_MS) {
    return Promise.resolve({ data: champions, error: null, stale: false })
  }
  if (championsInflight) return championsInflight

  championsInflight = request(`${root(base)}/champions`)
    .then((text) => {
      champions = readChampions(JSON.parse(text), base)
      return { data: champions, error: null, stale: false }
    })
    .catch((err: Error) => ({
      data: champions,
      error: `Couldn't read the Hall: ${err.message}`,
      stale: champions !== null
    }))
    .finally(() => {
      championsInflight = null
    })
  return championsInflight
}

/** Coerce the site's answer into the app's shape, dropping anything malformed. */
export function readChampions(json: unknown, base: string): Champions {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const home = (o.home && typeof o.home === 'object' ? o.home : {}) as Record<string, unknown>
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')
  const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

  return {
    ranked: n(o.ranked),
    leaders: list(o.leaders).map((l) => ({
      place: n(l.place),
      name: s(l.name),
      display: s(l.display),
      level: n(l.level),
      classes: names(l.classes)
    })),
    kills: n(o.kills),
    events: list(home.events).map((e) => ({
      kind: s(e.kind) === 'born' ? 'born' : 'clear',
      first: e.first === true,
      when: s(e.when),
      key: s(e.key),
      name: s(e.name),
      party: list(e.party).map((p) => ({ name: s(p.name), classes: names(p.trio) })),
      bracket: s(e.bracket_label),
      duration: s(e.duration),
      dps: n(e.dps)
    })),
    chronicle: list(o.chronicle ?? home.chronicle).map((c) => ({
      title: s(c.title),
      who: s(c.who),
      detail: s(c.detail),
      date: s(c.date),
      url: s(c.href) ? new URL(s(c.href), base).toString() : null
    })),
    newest:
      home.newest && typeof home.newest === 'object'
        ? { name: s((home.newest as Record<string, unknown>).name), when: s((home.newest as Record<string, unknown>).when) }
        : null,
    active: n(home.active),
    hours: n(home.hours),
    boardUrl: new URL(s(o.board_url) || '/leaderboards', base).toString(),
    raidsUrl: new URL(s(o.raids_url) || '/leaderboards/raids', base).toString(),
    fetchedAt: Date.now()
  }
}
