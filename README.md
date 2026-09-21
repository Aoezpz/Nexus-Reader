# Nexus Reader

**The Second Calling's log companion.** It reads the log files EverQuest
already writes and turns them into a live DPS meter, a fight timeline, trigger
alerts, the road to the Plane of Time and the server's raid records.

It is pointed at one server on purpose: the defaults, the bundled progression
data and the hover cards all come from it. The
site is a **data source, not a dependency** — clear the address in Preferences
and the app runs entirely on its bundled data with no network access at all,
and pointing it at another server's site is a text field.

**It only reads your log.** Nothing is injected into EverQuest, no game file is
touched, no memory is read, and nothing is played for you. Turn logging off and
the app has nothing to show.

---

## Getting started

1. Install and run it. It is a per-user install like Discord — no admin prompt.
2. In game, type `/log on` for **each character you box**.
3. That's it. The app finds `eqlog_<Character>_TSC.txt` on its own, usually
   under `…\TSC Client\Logs\`. If your install lives somewhere unusual, point it
   at the right folder in **Preferences** and it attaches immediately.

Windows will warn about an unrecognised app the first time you run the
installer. That is SmartScreen reacting to an unsigned binary, not a virus
warning — there is no code-signing certificate for this project, and the
reputation that suppresses the warning is bought, not earned by being safe.

## What it does

| Section | What you get |
|---|---|
| **Combat** | Live meter with per-skill breakdowns, a rolling DPS curve, damage by mob, procs, and the raw stream. A **Timeline** view puts one lane per skill so you can see misses as gaps. |
| **Progression** | The four expansion doors and the forty-one flags to the Plane of Time. A kill is marked the moment the boss dies in your log; the flag itself is confirmed by syncing from the site, because on this server a kill outside a progression instance grants nothing. |
| **Leaderboards** | The Hall's raid records — first clear, fastest kill and top DPS for every encounter, at every party size. Read-only. |
| **Alerts** | Rules over log lines with sounds and speech. Shareable as one `TRIA1:` string you can paste into Discord. |
| **Leveling** | Levels, ability points and kill rate per character. |
| **Loot** | What dropped and what the server auto-sold, priced in copper so the arithmetic is exact. |
| **Zones** | A lifetime ledger: where the hours went, kills and coin per zone. |
| **Mobs** | A bestiary — kills, kill times, damage traded, and which mobs have actually killed you. |
| **Timers** | Countdowns you set, plus respawn windows worked out from gaps between your own kills. |
| **Server** | Auction and grouping traffic heard on the broadcast channels, and **Tonight**: the site's own standings, thirty-day feed and chronicle of firsts. |
| **Overlays** | Always-on-top meter and stream windows. They open **locked** — click-through, so a stray click lands on the game instead of stealing focus from it. |

The title bar shows how many souls are in the world, read from the site once a
minute. Preferences carries nine color schemes — **Moonrise**, the server's own
palette, is the default — and a **Rebuild from logs** button that replays every
`eqlog` on disk into the lifetime ledgers, so a folder with a year of history in
it does not start at zero.

### Boxing a trio

All three clients write a log, and any line that isn't about *you* appears in
**all three**. Summing them would triple every mob swing and every group-mate's
damage. So each event is counted from exactly one log: your own swings from
your own log, your pet from its owner's log, everything else from the log you
nominate as **primary** in Preferences.

The test suite asserts that three logs of one fight total exactly what one log
of that fight totals — and that two genuinely simultaneous identical hits are
*not* collapsed into one.

### Boxing several accounts that are not grouped

Reading somebody's log is not evidence they are standing next to you. Two
characters at different camps share no lines at all, so there are no duplicates
to remove — and routing everything through one "primary" log would throw away
whatever happened to the other one. So an event whose **target** is one of your
characters is counted from that character's own log, whoever is primary, and the
party strip shows the group of the character selected in the title bar rather
than every log that happens to be open.

### Overlays need borderless windowed mode

Exclusive fullscreen owns the display outright and nothing can draw above it.
That is how DirectX works, not something the app can route around.

## Things it deliberately does not do

- **No XP percentage.** EverQuest logs record *that* you gained experience,
  never how much. The Leveling page charts levels, ability points and rates.
  An XP bar would have to be invented.
- **No leaderboard submissions.** The game server records every clear itself.
  The app only reads the records.
- **No calling a kill a flag.** The log proves a boss died with you there. On
  this server that is not the same as being flagged, so the page says *killed*
  until the site says *flagged*.
- **No guessing at flags it cannot see.** Hails and trials — "hail Mavuin",
  "a trial before the Tribunal" — are marked *by hand* and say so.

## Development

```bash
npm install
npm run dev        # app + hot reload
npm test           # parser, merge, alerts, voice and site-markup suites
npm run build      # typecheck + bundle
npm run package    # Windows installer -> release/<version>/
```

Drive the UI without the game running:

```bash
node scripts/replay.mjs --out "C:\temp\Logs" --speed 4
```

It writes three synthetic character logs in real time, duplicating third-party
lines across all three exactly the way real clients do — which is the point,
since that duplication is what the merge rule exists to handle.

### Regenerating bundled data

```bash
node scripts/export-progression.mjs --character <Name>   # data/progression.json, from tscemu.com
node scripts/export-buffs.mjs "<TSC Client>\spells_us.txt" # data/buffs.json, from the client
node scripts/make-icon.mjs                                 # build/icon.png + icon.ico
```

### The site's markup

Everything the app reads off tscemu.com — character rows, the progression
page, the raid records, search results — is parsed in
`src/main/siteparse.ts` against fixtures cut from the live site in
`tests/fixtures/tsc/`. When the site's markup moves, `npm test` says which
reader broke. The hover cards come from two small JSON routes the site serves
for the purpose (`/items/tip`, `/spells/tip`), falling back to the search page
on a site that has not deployed them.

### Finding what the parser misses

```bash
node scripts/unparsed.mjs "<path>\eqlog_<Char>_TSC.txt"
```

Ranks every log line the parser currently ignores, commonest first. Almost every
feature in the app started here — heals, absorbs, specials and the buff board
were all found by reading that list rather than by guessing at what EverQuest
might write. The Server page's blessing and census readers were written against
a different server's log and have not yet been checked against a TSC one; this
is the script to do it with.

## Licence, credit and what this is not

MIT — see [LICENSE](LICENSE). The bundled data has its own provenance, set out
in [data/README.md](data/README.md): the buff index is derived from the
EverQuest client's `spells_us.txt` and is not this project's to license.

The idea came from **[EQ Legends Companion](https://github.com/jmoyers/everquest-companion)**
by Josh Moyers — a companion app for a different server that showed what a log
reader could be. No code was taken from it; the parser was built against real
logs from a live trio server. The shared shape of the two repos
(`src/main`, `src/preload`, `src/renderer`, `electron.vite.config.ts`,
`electron-builder.yml`) is the `create-electron` react-ts scaffold both started
from, not a common ancestor.

EverQuest is a trademark of Daybreak Game Company LLC. This project is not
affiliated with or endorsed by them. It reads a text file the game already
writes — no memory reads, no injection, nothing written near the game folder —
which is the same ground log parsers have stood on since GamParse.

### Known rough edges

- **Scraped pages can rot.** The raid records, character rows and progression
  page are read from the site's own markup, because there is no JSON for them.
  If the site changes, the page says so plainly rather than showing empty
  boards.
- **The Server page's broadcasts are unverified here.** World blessings, the
  first-login census and the auction feed were built against another server's
  log lines. They are hidden when nothing matches, not faked.
- **The buff board only shows unambiguous spells.** It reads effect messages out
  of the client's `spells_us.txt`, and keeps only those naming exactly one spell.
  "Your protection fades." belongs to 26 of them and is skipped rather than
  guessed at. There are no durations either — the log never states one.
- **Windows 11 "Natural" voices** may not be visible to the app's speech
  engine even when Windows lists them. Preferences shows exactly which voices
  it can see, so you can tell that apart from "not installed".
- **No code-signing certificate**, so SmartScreen warns on first run. That is
  bought reputation, not a safety judgement.
