import { useCallback, useEffect, useState } from 'react'
import type { LeaderboardResult, Monument, RecordCell } from '@shared/leaderboard'
import { classColor, CLASS_NAMES } from '@shared/roster'
import { Aurora, Starfield } from '../components/Ambient'

/**
 * The raid records, read from the server's website.
 *
 * Read-only by design: the game server records every clear itself, so there
 * is nothing here for the app to submit and no way for it to disagree with
 * the site. Each monument is drawn the way the site draws it - marks down,
 * party sizes across - and links back to the encounter's own page.
 */

const BRACKET_CLASS: Record<string, string> = { Solo: 'b1', Duo: 'b2', Trio: 'b3' }

export function Leaderboards(): JSX.Element {
  const [result, setResult] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setResult(await window.triune.invoke('leaderboard:get', { force }))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = (url: string): void => void window.triune.invoke('shell:open', url)

  const data = result?.data ?? null
  const claimed = data?.monuments.filter((m) => !m.sealed).length ?? 0

  return (
    <div className="page lb">
      <header className="lb-hero">
        <Aurora />
        <Starfield count={26} seed={9} />
        <div className="lb-hero-in">
          <div>
            <p className="eyebrow">raid records</p>
            <h1>The Hall</h1>
            <p className="lede">
              First clear, fastest kill and top DPS for every raid encounter, at every party size. Recorded
              by the server, not by this app.
            </p>
          </div>
          <span className="spacer" />
          <div className="lb-actions">
            <button className="btn" type="button" onClick={() => void load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {data && (
              <button className="btn" type="button" onClick={() => open(data.source)}>
                Open on the site
              </button>
            )}
          </div>
        </div>

        {data && (
          <div className="lb-totals">
            <div className="t">
              <span className="n num">{claimed}</span>
              <span className="l">of {data.monuments.length} claimed</span>
            </div>
            <div className="t">
              <span className="n num">{data.monuments.length - claimed}</span>
              <span className="l">unclaimed</span>
            </div>
          </div>
        )}
      </header>

      {result?.error && (
        <div className="panel">
          <div className="pbody">
            <p className="err" style={{ margin: 0 }}>
              {result.error}
              {result.stale && ' Showing the last copy that loaded.'}
            </p>
          </div>
        </div>
      )}

      {!data && loading && <div className="empty">Reading the records…</div>}

      {data?.monuments.map((m) => (
        <MonumentCard key={m.key} m={m} open={open} />
      ))}
    </div>
  )
}

function MonumentCard({ m, open }: { m: Monument; open: (url: string) => void }): JSX.Element {
  return (
    <section className={m.sealed ? 'lb-mon sealed' : 'lb-mon'} style={{ ['--acc' as string]: m.accent ?? 'var(--gold)' }}>
      <div className="lbm-head">
        {m.ordinal && <span className="lbm-ord">{m.ordinal}</span>}
        <div className="lbm-title">
          <h2>{m.name}</h2>
          <div className="lbm-meta">
            {m.subtitle && <span className="sub">{m.subtitle}</span>}
            {m.meta && <span>{m.meta}</span>}
            {m.fell && <span className="fell">{m.fell}</span>}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn" type="button" onClick={() => open(m.url)}>
          All rankings
        </button>
      </div>

      {m.sealed ? (
        <p className="lbm-invite">
          Nobody has done this yet. Every kill is recorded from the moment it happens and kept for good, so
          the first name here will be the first name here forever, at every party size.
        </p>
      ) : (
        <div className="lbm-matrix" style={{ gridTemplateColumns: `7rem repeat(${m.brackets.length}, minmax(0, 1fr))` }}>
          <span className="mh corner" />
          {m.brackets.map((b) => (
            <span className={`mh col ${BRACKET_CLASS[b.label] ?? ''}`} key={b.label}>
              {b.label}
              <i>{b.count}</i>
            </span>
          ))}
          {m.marks.map((mark) => (
            <MarkRow key={mark.key} label={mark.label} cells={mark.cells} kind={mark.key} />
          ))}
        </div>
      )}
    </section>
  )
}

function MarkRow({ label, cells, kind }: { label: string; cells: RecordCell[]; kind: string }): JSX.Element {
  return (
    <>
      <span className="mh row">{label}</span>
      {cells.map((c) => (
        <div className={c.open ? 'cell open' : 'cell'} key={c.bracket}>
          {c.open ? (
            <>
              <span className="v">open</span>
              <span className="d">nobody yet</span>
            </>
          ) : (
            <>
              <span className={`v ${kind}`}>{c.value}</span>
              <div className="party">
                {c.party.map((p) => (
                  <span className="who" key={p.name}>
                    <span className="wn">{p.name}</span>
                    <span className="cchips sm">
                      {p.classes.map((cl, i) => (
                        <span className="cchip" key={`${cl}-${i}`} title={CLASS_NAMES[cl] ?? cl} style={{ color: classColor(cl) }}>
                          {cl}
                        </span>
                      ))}
                    </span>
                  </span>
                ))}
              </div>
              {c.date && <span className="d">{c.date}</span>}
            </>
          )}
        </div>
      ))}
    </>
  )
}
