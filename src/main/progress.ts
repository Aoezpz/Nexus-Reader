import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import {
  allSteps,
  buildKillIndex,
  detectProgress,
  summarizeProgress,
  type ProgMark,
  type ProgressState,
  type ProgressionData,
  type ProgressSummary
} from '@shared/progression'
import data from '../../data/progression.json'

/**
 * Owns flagging state.
 *
 * The definitions are bundled and static; the state is the player's and lives
 * in their config, so a reinstall keeps it and no network is required to see
 * where you are. New flags are detected from kill lines as they happen.
 */

const PROGRESSION = data as unknown as ProgressionData
const KILL_INDEX = buildKillIndex(PROGRESSION)

const store = new Store<{ progress: ProgressState }>({
  name: 'triune-progress',
  defaults: { progress: {} },
  clearInvalidConfig: true
})

export class Progress {
  private state: ProgressState = store.get('progress')

  /**
   * Marks written by a 0.2.0 build against the previous server's data carry
   * that server's step keys, which will match nothing here - so on first load
   * against the new data any mark whose key names a step that no longer
   * exists is dropped. Kills seen in your log on THIS server keep their keys
   * and survive. A stale flag on a page is worse than a blank one.
   */
  private pruned = false

  constructor(private onFlag: (keys: string[], summary: ProgressSummary) => void) {}

  data(): ProgressionData {
    return PROGRESSION
  }

  summary(): ProgressSummary {
    return summarizeProgress(PROGRESSION, this.state)
  }

  marks(): ProgressState {
    if (!this.pruned) {
      this.pruned = true
      const valid = new Set(allSteps(PROGRESSION).map((s) => s.key))
      const kept: ProgressState = {}
      let dropped = 0
      for (const [key, mark] of Object.entries(this.state)) {
        if (valid.has(key)) kept[key] = mark
        else dropped++
      }
      if (dropped > 0) {
        this.state = kept
        this.persist()
        console.log(`[progress] dropped ${dropped} mark(s) for steps the bundled data no longer has`)
      }
    }
    return this.state
  }

  /** Feed merged combat events; returns the keys newly earned, if any. */
  observe(events: ParsedEvent[]): string[] {
    const fresh = detectProgress(events, KILL_INDEX, this.state)
    const keys = Object.keys(fresh)
    if (keys.length === 0) return []

    this.state = { ...this.state, ...fresh }
    this.persist()
    this.onFlag(keys, this.summary())
    return keys
  }

  /** Tick or untick by hand - for the steps no log line announces, and for
   *  correcting anything the parser got wrong. */
  set(key: string, earned: boolean): ProgressSummary {
    if (earned) {
      const mark: ProgMark = { at: Date.now(), source: 'manual' }
      this.state = { ...this.state, [key]: mark }
    } else {
      const next = { ...this.state }
      delete next[key]
      this.state = next
    }
    this.persist()
    return this.summary()
  }

  /**
   * Wipe every flag.
   *
   * Needed because flags are detected from whatever log folder is configured -
   * so pointing the app at a test folder, or at a friend's install, records
   * flags that are not yours. Without a reset the only fix would be deleting a
   * JSON file by hand.
   */
  reset(): ProgressSummary {
    this.state = {}
    this.persist()
    return this.summary()
  }

  /**
   * Bulk apply, used by the site sync.
   *
   * A site mark REPLACES a log mark for the same step: the log saw the kill,
   * the site holds the flag, and the flag is the stronger fact - it is what
   * lets the page stop saying "unconfirmed". A manual tick is left alone; you
   * said so, and the site agreeing changes nothing.
   */
  merge(keys: string[], source: ProgMark['source']): ProgressSummary {
    const next = { ...this.state }
    for (const key of keys) {
      const have = next[key]
      if (!have || have.source === 'log') next[key] = { at: have?.at ?? Date.now(), source, by: have?.by }
    }
    this.state = next
    this.persist()
    return this.summary()
  }

  private persist(): void {
    store.set('progress', this.state)
  }
}
