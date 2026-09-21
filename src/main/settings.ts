import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, LEGACY_DEFAULTS, type Settings } from '@shared/ipc'

const store = new Store<{ settings: Settings }>({
  name: 'triune-helper',
  defaults: { settings: DEFAULT_SETTINGS },
  // A config file that fails to parse - truncated by a crash, or saved by an
  // editor that added a BOM - must not be fatal. Without this, electron-store
  // throws during module load and the app dies before it can draw a window,
  // with no way for the user to recover short of deleting the file by hand.
  clearInvalidConfig: true
})

/**
 * Move the previous server's defaults to this one's, once.
 *
 * 0.3.0 pointed the app at The Second Calling. A settings file from an
 * earlier build still holds the old site and the old shortname - not because
 * anybody chose them, but because the old build wrote its defaults out. Left
 * alone, an updated install would keep looking for `eqlog_*_multiclass.txt`
 * and asking a website it no longer has any business with.
 *
 * Only a value that EQUALS the old default is moved. Anything else was typed
 * by a person, and a person's choice is not ours to second-guess - somebody
 * pointing the app at a third server keeps their setting.
 */
function carryDefaultsForward(): void {
  const stored = store.get('settings')
  if (!stored) return
  const patch: Partial<Settings> = {}
  if (stored.ptdexBase === LEGACY_DEFAULTS.ptdexBase) patch.ptdexBase = DEFAULT_SETTINGS.ptdexBase
  if (stored.serverShortname === LEGACY_DEFAULTS.serverShortname) {
    patch.serverShortname = DEFAULT_SETTINGS.serverShortname
  }
  if (Object.keys(patch).length === 0) return
  store.set('settings', { ...stored, ...patch })
  console.log(`[settings] carried forward: ${Object.keys(patch).join(', ')}`)
}

carryDefaultsForward()

export function getSettings(): Settings {
  // Merge over defaults so a settings file written by an older build still
  // yields every key the current code expects.
  return { ...DEFAULT_SETTINGS, ...store.get('settings') }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  store.set('settings', next)
  return next
}

/**
 * Common EverQuest install locations. We only ever read from the Logs
 * subfolder - the app never writes into the game directory.
 *
 * Emulator launchers each pick their own root, so this list is a guess-list
 * rather than a spec, and being wrong is free: a candidate only wins if its
 * Logs folder actually holds a file matching the configured server shortname.
 * Adding a server's usual folder here costs one `existsSync` on a path that
 * isn't there.
 */
const CANDIDATE_ROOTS = [
  'C:\\TSC Client',
  'C:\\TSC',
  'C:\\The Second Calling',
  'C:\\Second Calling\\TSC Client',
  'C:\\Games\\TSC Client',
  'C:\\Games\\The Second Calling',
  'C:\\ProjectTriune',
  'C:\\Triune',
  'C:\\THJ',
  'C:\\EverQuest',
  'C:\\EQ',
  'C:\\Games\\EverQuest',
  'C:\\Program Files (x86)\\Sony\\EverQuest',
  'C:\\Program Files\\Sony\\EverQuest',
  'D:\\EverQuest',
  'D:\\Games\\EverQuest'
]

/**
 * Look for a Logs folder that actually contains logs for our server. Returns
 * null rather than guessing, so a wrong folder never silently becomes the
 * configured one.
 */
export function autodetectLogFolder(serverShortname: string): string | null {
  const suffix = `_${serverShortname.toLowerCase()}.txt`
  for (const root of CANDIDATE_ROOTS) {
    const logs = join(root, 'Logs')
    if (!existsSync(logs)) continue
    try {
      const hit = readdirSync(logs).some(
        (f) => f.toLowerCase().startsWith('eqlog_') && f.toLowerCase().endsWith(suffix)
      )
      if (hit) return logs
    } catch {
      // Unreadable candidate (permissions, disconnected drive) - just move on.
    }
  }
  return null
}
