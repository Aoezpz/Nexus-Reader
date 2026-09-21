import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  blessingRows,
  censusRows,
  GROUPING_WINDOW_MS,
  MARKET_WINDOW_MS,
  recent,
  type ServerData
} from '@shared/server'
import type { ChampionsResult } from '@shared/site'
import { abbrevOf, classColor, CLASS_NAMES } from '@shared/roster'
import { countdown, duration } from '@shared/timers'
import { Aurora, Starfield } from '../components/Ambient'
import { Tipped } from '../components/Tip'

/**
 * The world outside your group.
 *
 * One caveat governs the whole page and is printed on it rather than buried
 * here: everything below was heard on a broadcast channel while you were
 * logged in. It is a sample of the server taken during your play, never a
 * total, and the page says so where somebody might otherwise read a count as
 * a population.
 *
 * Five views rather than one long scroll, because they are read in completely
 * different ways. Grouping and the market are live feeds you would leave open;
 * blessings are a glance you take once a session; the census is reference
 * material. Stacked, the feeds sat below two screens of the other two, which
 * meant the things that change most often were the hardest to see - see TABS
 * for the order that fixes it.
 *
 * The fifth, Tonight, is the exception to the page's caveat: it is not
 * heard on a channel, it is read off the server's website, which sees the
 * whole server rather than the part of it that shouted near you.
 */
export type ServerView = 'tonight' | 'blessings' | 'players' | 'grouping' | 'market'

/**
 * Tab order, most-watched first.
 *
 * The two live feeds lead, because they are the reason to open this page at
 * all - trade and grouping change by the minute. Tonight is the site's own
 * record of what happened, worth a look once a session. Blessings are a
 * glance, and the census is reference material nobody watches, so they sit at
 * the end.
 *
 * Declared here rather than inline so the order lives in one place; the
 * sections below render on `view` and their order in the file does not matter.
 */
const TABS: Array<[ServerView, string]> = [
  ['market', 'Auction & trade'],
  ['grouping', 'Grouping'],
  ['tonight', 'Tonight'],
  ['blessings', 'Blessings'],
  ['players', 'Who is out there']
]

/** Which intents the market list is showing. */
type MarketFilter = 'all' | 'sell' | 'buy' | 'give'

export function Server({
  view,
  onView
}: {
  view: ServerView
  onView: (v: ServerView) => void
}): JSX.Element {
  const [data, setData] = useState<ServerData>({
    blessings: [],
    census: {},
    groups: [],
    offers: [],
    bazaar: null,
    appliedAt: null
  })
  const [now, setNow] = useState(() => Date.now())
  const [confirmReset, setConfirmReset] = useState(false)
  const [filter, setFilter] = useState<MarketFilter>('all')

  // The Hall, from the site. Asked for when the tab is opened, and cached in
  // main for five minutes, so flicking between tabs costs nothing.
  const [hall, setHall] = useState<ChampionsResult | null>(null)
  const [hallBusy, setHallBusy] = useState(false)
  const loadHall = useCallback(async (force = false) => {
    setHallBusy(true)
    setHall(await window.triune.invoke('site:champions', { force }))
    setHallBusy(false)
  }, [])
  useEffect(() => {
    if (view === 'tonight' && !hall) void loadHall()
  }, [view, hall, loadHall])

  const load = useCallback(async () => {
    setData(await window.triune.invoke('server:get'))
  }, [])

  useEffect(() => {
    void load()
    const poll = window.setInterval(() => void load(), 5000)
    const beat = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(beat)
    }
  }, [load])

  // Both feeds age out on their own: `now` ticks every second, so a row leaves
  // the list the moment it passes the window rather than at the next reload.
  const groups = useMemo(
    () => recent(data.groups, now, GROUPING_WINDOW_MS).slice(0, 150),
    [data.groups, now]
  )
  const blessings = useMemo(() => blessingRows(data.blessings, now), [data.blessings, now])
  const census = useMemo(() => censusRows(data.census), [data.census])
  const live = blessings.filter((b) => b.active).length

  // Newest first, inside the window, and only what the filter asks for. The row
  // cap is generous now the market has the page to itself - at thirty rows a
  // busy evening scrolled out of view in under an hour.
  const fresh = useMemo(() => recent(data.offers, now, MARKET_WINDOW_MS), [data.offers, now])
  const offers = useMemo(
    () => (filter === 'all' ? fresh : fresh.filter((o) => o.intent === filter)).slice(0, 150),
    [fresh, filter]
  )

  // Counted over the same window the list shows, so a filter reading zero can
  // never sit next to a button claiming there are twelve.
  const counts = useMemo(
    () => ({
      all: fresh.length,
      sell: fresh.filter((o) => o.intent === 'sell').length,
      buy: fresh.filter((o) => o.intent === 'buy').length,
      give: fresh.filter((o) => o.intent === 'give').length
    }),
    [fresh]
  )

  return (
    <div className="page zones">
      <header className="loot-hero">
        <Aurora />
        <Starfield count={26} seed={41} />
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">what the world is doing</p>
            <h1>Server</h1>
            <p className="lede">
              World blessings, who is arriving and levelling, and what is being auctioned — everything the
              server broadcast while you were logged in.
            </p>
            <div className="seg" style={{ marginTop: 'var(--s-3)' }}>
              {TABS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="lh-total">
            <span className="n">{live}</span>
            <span className="l">
              blessing{live === 1 ? '' : 's'} running
              {census.players.length > 0 ? ` · ${census.players.length} players seen` : ''}
            </span>
          </div>
        </div>
      </header>

      {/* ---- Tonight, from the site ---- */}
      {view === 'tonight' && (
        <section className="panel">
          <div className="phead">
            <span className="t">Tonight in the Hall</span>
            <span className="meta">
              {hall?.data
                ? `${hall.data.kills.toLocaleString()} kills on record · ${hall.data.active} active · ${hall.data.hours.toLocaleString()} hours played`
                : hallBusy
                  ? 'reading the site…'
                  : 'from the site'}
            </span>
          </div>
          <div className="pbody">
            {hall?.error && (
              <p className="err" style={{ marginTop: 0 }}>
                {hall.error}
                {hall.stale && ' Showing the last copy that loaded.'}
              </p>
            )}
            {!hall?.data && !hall?.error && <p className="fhint" style={{ marginBottom: 0 }}>Reading the site…</p>}
            {hall?.data && (
              <div className="tonight">
                <div>
                  <div className="tm-sub">Champions · the standings</div>
                  {hall.data.leaders.length === 0 ? (
                    <p className="fhint">Nobody is ranked yet.</p>
                  ) : (
                    <div className="podium">
                      {hall.data.leaders.map((l) => (
                        <div className={`step p${l.place}`} key={l.name}>
                          <span className="place num">{l.place}</span>
                          <span className="nm">{l.name}</span>
                          <span className="cchips sm">
                            {l.classes.map((c, i) => {
                              const a = abbrevOf(c)
                              return a ? (
                                <span className="cchip" key={`${a}-${i}`} title={CLASS_NAMES[a]} style={{ color: classColor(a) }}>
                                  {a}
                                </span>
                              ) : null
                            })}
                          </span>
                          <span className="vv num">{l.display}</span>
                          <span className="lv">level {l.level}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {hall.data.newest && (
                    <p className="fhint">
                      Newest soul: <b>{hall.data.newest.name}</b>, {hall.data.newest.when}.
                    </p>
                  )}

                  <div className="tm-sub" style={{ marginTop: 'var(--s-4)' }}>The Chronicle · firsts that never change</div>
                  <div className="chron">
                    {hall.data.chronicle.map((c) => (
                      <div className="ev" key={c.title}>
                        <span className="d">{c.date || '—'}</span>
                        <span className="w">{c.title}</span>
                        <span className="who">{c.who}</span>
                        <span className="dt">{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="tm-sub">What happened · the last thirty days</div>
                  {hall.data.events.length === 0 ? (
                    <p className="fhint">Nothing has happened yet that the game wrote down.</p>
                  ) : (
                    <div className="offers">
                      {hall.data.events.map((e, i) => (
                        <div className="offer feed" key={`${e.when}-${i}`}>
                          <span className={`o-tag ${e.kind === 'born' ? 'none' : e.first ? 'give' : 'sell'}`}>
                            {e.kind === 'born' ? 'new' : e.first ? 'first' : 'clear'}
                          </span>
                          <span className="o-who">{e.party.map((p) => p.name).join(' + ')}</span>
                          <span className="o-text">
                            {e.kind === 'born' ? (
                              'stepped through the gate'
                            ) : (
                              <>
                                <b>{e.name}</b>, {e.bracket.toLowerCase()}, {e.duration}
                                {e.dps ? ` · ${e.dps.toLocaleString()} dps` : ''}
                              </>
                            )}
                          </span>
                          <span className="o-when dim">{e.when.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <p className="fhint" style={{ marginBottom: 0 }}>
              The one tab on this page that is not a sample: it is read from the server&apos;s website, which
              sees every clear and every new character whether or not you were logged in. Asked for once when
              the tab opens and held for five minutes.
            </p>
            <div className="row" style={{ marginTop: 'var(--s-3)' }}>
              <button className="btn" type="button" disabled={hallBusy} onClick={() => void loadHall(true)}>
                {hallBusy ? 'Refreshing…' : 'Refresh'}
              </button>
              {hall?.data && (
                <button className="btn" type="button" onClick={() => void window.triune.invoke('shell:open', hall.data!.boardUrl)}>
                  Open the standings
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- Blessings ---- */}
      {view === 'blessings' && (
      <section className="panel">
        <div className="phead">
          <span className="t">World blessings</span>
          <span className="meta">stated by the server, counted down here</span>
        </div>
        <div className="pbody">
          {/* The one thing you can be certain of, so it sits above the table:
              the game said this about you directly, where every row below is
              assembled from a broadcast that may predate the app. */}
          {data.appliedAt !== null && (
            <div className="applied">
              <span className="a-dot" aria-hidden="true" />
              World buffs were applied to you <b>{duration(now - data.appliedAt)} ago</b>
              <span className="dim"> · {new Date(data.appliedAt).toLocaleTimeString()}</span>
            </div>
          )}

          {blessings.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              No blessing announcement has been read yet. Taking the buffs yourself does not produce one —
              the line that carries a name and a duration is a separate broadcast that only fires when
              somebody <em>activates or extends</em> a blessing, which may have been hours before you
              logged in. The app now reads back through the log on startup looking for those, so this
              usually fills in on the next launch.
            </p>
          ) : (
            <div className="ztable">
              <div className="zrow zhead brow">
                <span className="z-name">Blessing</span>
                <span className="z-n">Remaining</span>
                <span className="z-n">Ends</span>
                <span className="z-n">Heard</span>
              </div>
              {blessings.map((b) => (
                <div className={b.active ? 'zrow brow up' : 'zrow brow'} key={b.name}>
                  <span
                    className="z-bar"
                    style={{ width: `${Math.min(100, (b.remainingMs / Math.max(1, b.statedMs)) * 100)}%` }}
                    aria-hidden="true"
                  />
                  <span className="z-name">{b.name}</span>
                  <span className={b.active ? 'z-n num good' : 'z-n num dim'}>
                    {b.active ? countdown(b.remainingMs) : 'expired'}
                  </span>
                  <span className="z-n num dim">
                    {new Date(b.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="z-n num dim">{duration(now - b.seenAt)} ago</span>
                </div>
              ))}
            </div>
          )}
          <p className="fhint" style={{ marginBottom: 0 }}>
            The server states a remaining duration when a blessing is switched on or extended, and that is
            the only thing it ever says about them — <strong>there is no expiry message</strong>. So a
            blessing that started while you were logged out is invisible here, and one somebody cancelled
            early would still be counting down. Treat a running timer as &ldquo;probably&rdquo;, not
            &ldquo;certainly&rdquo;.
          </p>
        </div>
      </section>
      )}

      {/* ---- Census ---- */}
      {view === 'players' && (
      <section className="panel">
        <div className="phead">
          <span className="t">Who is out there</span>
          <span className="meta">
            {census.players.length} seen · {census.trios.length} trio{census.trios.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="pbody">
          {census.players.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              Nobody yet. Names arrive when the server announces a first login, a level, or a server-first
              trio.
            </p>
          ) : (
            <>
              <div className="tm-sub">Trio combinations seen</div>
              <div className="triogrid">
                {census.trios.slice(0, 12).map((t) => (
                  <div className="triocard" key={t.trio}>
                    <span className="tc-n num">{t.count}</span>
                    {/* Split on the slashes rather than printing the raw
                        string: "Paladin/Necromancer/Enchanter" contains no
                        space, so nothing can wrap it and it ran straight out
                        of the card. Each class is its own flex item, which
                        gives the line somewhere to break. */}
                    <span className="tc-t">
                      {t.trio.split('/').map((c, i) => (
                        <span className="tc-c" key={`${c}-${i}`}>
                          {i > 0 && <i className="tc-slash">/</i>}
                          {c}
                        </span>
                      ))}
                    </span>
                    {t.firstBy && <span className="tc-first">first: {t.firstBy}</span>}
                  </div>
                ))}
              </div>

              <div className="tm-sub">Most recently heard from</div>
              <div className="ztable">
                {census.players.slice(0, 20).map((p) => (
                  <div className="zrow crow" key={p.name}>
                    <span className="z-name">
                      {p.name}
                      {p.serverFirst && <span className="s-first">server first</span>}
                    </span>
                    {/* Same overflow hazard as the cards above, but a table row
                        cannot grow - so this one truncates and keeps the full
                        string in the tooltip. */}
                    <span className="c-classes" title={p.classes}>
                      {p.classes}
                    </span>
                    <span className="z-n num">{p.level ?? '—'}</span>
                    <span className="z-n num dim">{duration(now - p.lastSeen)} ago</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="fhint" style={{ marginBottom: 0 }}>
            A sample, not a census — only broadcasts made while you were logged in reach this list. The
            first-login message names <em>one</em> class, not the trio; a player&apos;s full trio only
            appears once they level or take a server first, which is why some rows show a single class.
          </p>
        </div>
      </section>
      )}

      {/* ---- Grouping ---- */}
      {view === 'grouping' && (
        <section className="panel">
          <div className="phead">
            <span className="t">Grouping</span>
            <span className="meta">
              {groups.length} in the last 2 hours
            </span>
          </div>
          <div className="pbody">
            {groups.length === 0 ? (
              <p className="fhint" style={{ marginBottom: 0 }}>
                Nothing heard. Shouts about forming or joining a group appear here — LFG, LFM, &ldquo;need
                2 more&rdquo;, &ldquo;anyone want to do DN&rdquo;, &ldquo;anyone doing progression&rdquo;.
              </p>
            ) : (
              <div className="offers">
                {groups.map((g, i) => (
                  <div className="offer" key={`${g.at}-${i}`}>
                    <span
                      className={`o-tag ${g.kind ?? 'none'}`}
                      title={
                        g.kind === 'forming'
                          ? 'Has a group and wants people'
                          : g.kind === 'seeking'
                            ? 'Looking to join something'
                            : 'About grouping, but does not say which way round'
                      }
                    >
                      {g.kind === 'forming' ? 'LFM' : g.kind === 'seeking' ? 'LFG' : 'group'}
                    </span>
                    <span className="o-who">{g.caller}</span>
                    {/* Always the raw line. A group call is a sentence, not a
                        record - there is no structure in it worth lifting out,
                        and inventing one is what went wrong on the market tab. */}
                    <span className="o-text" title={g.text}>
                      {g.text}
                    </span>
                    <span className="o-when num dim">{duration(now - g.at)} ago</span>
                  </div>
                ))}
              </div>
            )}
            <p className="fhint" style={{ marginBottom: 0 }}>
              Read off <code>/auction</code> and <code>/ooc</code>, the same two channels as the market —
              these are the shouts about people rather than goods, which used to be dropped or, worse,
              filed as sales. <b>LFM</b> means the line reads as somebody who has a group and wants
              bodies; <b>LFG</b> as somebody looking to join. A line that is merely <em>about</em> a zone
              is not a group call and does not appear.
            </p>
          </div>
        </section>
      )}

      {/* ---- Market ---- */}
      {view === 'market' && (
      <section className="panel">
        <div className="phead">
          <span className="t">Auction &amp; trade</span>
          <span className="meta">
            {offers.length === counts.all
              ? `${counts.all} in the last 6 hours`
              : `${offers.length} of ${counts.all} in the last 6 hours`}
          </span>
        </div>
        {/* A feed is worth filtering; three stacked panels were not. Counts are
            on the buttons because an empty result should be obviously empty
            rather than look like a page that failed to load. */}
        <div className="pbody" style={{ paddingBottom: 0, overflow: 'visible' }}>
          <div className="seg">
            {(
              [
                ['all', 'Everything'],
                ['sell', 'Selling'],
                ['buy', 'Buying'],
                ['give', 'Free']
              ] as Array<[MarketFilter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                disabled={counts[id] === 0 && id !== 'all'}
                onClick={() => setFilter(id)}
              >
                {label} <span className="dim">{counts[id]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="pbody">
          {data.offers.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              Nothing heard. Lines from <code>/auction</code> and <code>/ooc</code> appear here when they
              mention WTS, WTB, WTT or a tiered item name.
            </p>
          ) : offers.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              Nothing matching that filter yet.
            </p>
          ) : (
            <div className="offers">
              {offers.map((o, i) => (
                <div className="offer" key={`${o.at}-${i}`}>
                  <span
                    className={`o-tag ${o.intent ?? 'none'}`}
                    title={
                      o.intent === null
                        ? 'No WTS/WTB/WTT in the line — kept as trade traffic, but shown exactly as it was typed'
                        : undefined
                    }
                  >
                    {o.intent === 'sell'
                      ? 'WTS'
                      : o.intent === 'buy'
                        ? 'WTB'
                        : o.intent === 'trade'
                          ? 'WTT'
                          : o.intent === 'give'
                            ? 'FREE'
                            : 'list'}
                  </span>
                  <span className="o-who">{o.seller}</span>
                  {/* Item links are only drawn for a line that SAID what it
                      wanted.

                      A line with no WTS/WTB/WTT is kept, because it is still
                      trade traffic, but it is shown exactly as it was typed.
                      Lifting names out of it and rendering them as the same
                      orange links a real listing gets made a shout with no
                      marker read as a price list - the app supplying structure
                      the speaker never did, which is the one thing this page is
                      not allowed to do. What it says now is only what was said.

                      Where the intent IS stated, the names are separated,
                      because run together they read as one absurd item name.
                      Each is a tooltip, which doubles as the check: a name the
                      extractor merged out of two adjacent items comes back "no
                      item by that name" from the site. */}
                  <span className="o-text" title={o.text}>
                    {o.intent !== null && o.items.length > 0
                      ? o.items.map((it, n) => (
                          <span key={it}>
                            {n > 0 && <span className="o-sep">·</span>}
                            <Tipped
                              kind="item"
                              name={it.replace(/\s*\((?:Legendary|Enchanted|Glamour)\)$/, '')}
                            >
                              <span className="lootname">{it}</span>
                            </Tipped>
                          </span>
                        ))
                      : o.text}
                  </span>
                  <span className="o-when num dim">{duration(now - o.at)} ago</span>
                </div>
              ))}
            </div>
          )}
          <p className="fhint" style={{ marginBottom: 0 }}>
            A chat scraper, not a market index. Item names are only lifted from a line that said what it
            wanted — a <code>list</code> row named no WTS/WTB/WTT, so it is shown word for word rather than
            turned into a price list nobody offered. Even then the names are only lifted when they carry a
            tier in brackets, and sellers who run several together without punctuation will have two merge
            into one — hover a name to check it against the site, which is how you spot those. Most lines carry
            no price at all, and <code>/bazaar</code> trader stock never reaches the log. Hover any row to
            read the line exactly as it was said.
          </p>
          <div className="row" style={{ marginTop: 'var(--s-3)' }}>
            <button
              className={confirmReset ? 'btn danger' : 'btn'}
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  window.setTimeout(() => setConfirmReset(false), 5000)
                  return
                }
                setConfirmReset(false)
                void window.triune.invoke('server:reset').then(setData)
              }}
            >
              {confirmReset ? 'Clear everything?' : 'Clear server history'}
            </button>
          </div>
        </div>
      </section>
      )}
    </div>
  )
}
