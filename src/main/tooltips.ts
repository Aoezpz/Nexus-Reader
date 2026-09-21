import Store from 'electron-store'
import type { Tip, TipKind, TipResult } from '@shared/tooltip'
import { clean, request, root } from './http'
import { exactSearchRow, parseSearchRows, tipFromJson, tipFromSearchRow } from './siteparse'

/**
 * Item and spell hover cards, read from the server's website.
 *
 * Two routes, tried in order:
 *
 *   * **`/items/tip?name=` and `/spells/tip?name=`** - a small JSON answer the
 *     site serves for exactly this purpose (tscemu-site/app/server.py,
 *     page_tip). It resolves the name the log gave to the one item or spell it
 *     means and returns the card as rows, decoded by the site, which owns the
 *     bitmasks and the effect formulas.
 *   * **`/search?q=&in=`** - the site's own search page, when the endpoint is
 *     not there (a 404 means the site is running a build without it). The
 *     result list carries a one-line summary per hit, which is the whole of
 *     what the card can honestly show, and that is what it shows.
 *
 * Everything is cached to disk, including misses. A stream scrolling past at a
 * hundred lines a second must never turn into a hundred requests, and hovering
 * the same spell twice must not cost anything the second time. The cache is
 * keyed on the site as well as the name, so pointing the app at a different
 * site never serves the old one's cards.
 */

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MISSING_TTL_MS = 24 * 60 * 60 * 1000
/** Names longer than this are not names; they are a parser accident. */
const MAX_NAME = 64

interface Cached {
  tip: Tip | null
  at: number
}

interface Persisted {
  tips: Record<string, Cached>
}

const store = new Store<Persisted>({
  name: 'triune-tooltips',
  defaults: { tips: {} },
  clearInvalidConfig: true
})

const cache = new Map<string, Cached>(
  // Entries from before the cache was keyed on the site carry no '@'. They are
  // the previous server's cards and are dropped rather than served.
  Object.entries(store.get('tips') ?? {}).filter(([k]) => k.includes('@'))
)
/** Collapses a burst of hovers on the same name into one request. */
const inflight = new Map<string, Promise<TipResult>>()
let saveTimer: NodeJS.Timeout | null = null

const key = (base: string, kind: TipKind, name: string): string =>
  `${kind}:${name.toLowerCase()}@${root(base).replace(/^https?:\/\//, '')}`

function persistSoon(): void {
  if (saveTimer) return
  // Batched: hovering down a skill list would otherwise write the file once per
  // name, and the file grows to hold every spell the trio has ever cast.
  saveTimer = setTimeout(() => {
    saveTimer = null
    store.set('tips', Object.fromEntries(cache))
  }, 3000)
  saveTimer.unref()
}

export function flushTooltips(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  store.set('tips', Object.fromEntries(cache))
}

export async function lookupTip(base: string, kind: TipKind, name: string): Promise<TipResult> {
  const trimmed = clean(name)
  if (!base) return { found: false, tip: null, error: 'No server website configured.' }
  if (!trimmed || trimmed.length > MAX_NAME) return { found: false, tip: null, error: null }

  const k = key(base, kind, trimmed)
  const hit = cache.get(k)
  if (hit) {
    const ttl = hit.tip ? FOUND_TTL_MS : MISSING_TTL_MS
    if (Date.now() - hit.at < ttl) return { found: hit.tip !== null, tip: hit.tip, error: null }
  }

  const pending = inflight.get(k)
  if (pending) return pending

  const job = (async (): Promise<TipResult> => {
    try {
      const tip = await fetchTip(base, kind, trimmed)
      cache.set(k, { tip, at: Date.now() })
      persistSoon()
      return { found: tip !== null, tip, error: null }
    } catch (err) {
      // Unreachable is not "no such spell", so it is not cached as one - the
      // next hover after the network comes back should succeed.
      return { found: false, tip: null, error: (err as Error).message }
    } finally {
      inflight.delete(k)
    }
  })()

  inflight.set(k, job)
  return job
}

/**
 * Whether the site answered "I do not have that route" rather than "I do not
 * have that item". The request helper rejects a 404 with its status line, and
 * a missing endpoint is the one 404 worth falling back on - a missing item is
 * a 200 with `found: false`.
 */
let endpointMissing = false

async function fetchTip(base: string, kind: TipKind, name: string): Promise<Tip | null> {
  const path = kind === 'item' ? 'items' : 'spells'

  if (!endpointMissing) {
    try {
      const text = await request(`${root(base)}/${path}/tip?name=${encodeURIComponent(name)}`)
      const answer = tipFromJson(kind, JSON.parse(text))
      if (answer) return answer.tip
      // Parsed, but not the shape agreed on both sides. Treat as the endpoint
      // being something else at that path, and fall back.
    } catch (err) {
      if (!/^404\b/.test((err as Error).message) && !(err instanceof SyntaxError)) throw err
      // Remembered for this run only: a site that gains the endpoint after a
      // deploy is picked up on the next launch, and a site that never had it
      // costs one extra request per launch and no more.
      endpointMissing = true
    }
  }

  const html = await request(`${root(base)}/search?q=${encodeURIComponent(name)}&in=${path}`)
  const row = exactSearchRow(parseSearchRows(html), name)
  return row ? tipFromSearchRow(kind, row) : null
}
