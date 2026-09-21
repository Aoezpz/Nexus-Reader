import type { LeaderboardData, LeaderboardResult } from '@shared/leaderboard'
import { request, root } from './http'
import { parseMonuments } from './siteparse'

/**
 * Reads the raid records off the server's website.
 *
 * There is no JSON endpoint for these - the site renders them server-side
 * (tscemu-site/app/browse.py, monuments_html) - so this scrapes its markup.
 * That is fragile by nature, and it is handled by being loud rather than
 * clever: if the selectors stop matching, the page says so and offers the
 * website, instead of quietly showing empty boards that look like nobody has
 * killed anything.
 *
 * Fetched through Electron's `net` rather than global fetch so it uses the
 * app's proxy and certificate handling, and never from the renderer, which
 * stays locked to a self-only CSP.
 */

const CACHE_MS = 5 * 60 * 1000

let cache: LeaderboardData | null = null
let inflight: Promise<LeaderboardResult> | null = null

export async function getLeaderboard(base: string, force = false): Promise<LeaderboardResult> {
  if (!base) {
    return { data: null, error: 'No server website configured — set one in Preferences.', stale: false }
  }
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return { data: cache, error: null, stale: false }
  }
  if (inflight) return inflight

  const url = `${root(base)}/leaderboards/raids`
  inflight = request(url)
    .then((html) => {
      cache = { monuments: parseMonuments(html, root(base)), fetchedAt: Date.now(), source: url }
      return { data: cache, error: null, stale: false }
    })
    .catch((err: Error) => ({
      // A cached copy is better than nothing when the site is briefly down, but
      // it is labelled stale so nobody reads an hour-old record as current.
      data: cache,
      error: `Couldn't read the records: ${err.message}`,
      stale: cache !== null
    }))
    .finally(() => {
      inflight = null
    })

  return inflight
}
