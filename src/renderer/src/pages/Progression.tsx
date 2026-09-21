import { useEffect, useMemo, useState } from 'react'
import {
  isConfirmed,
  isManualStep,
  stepKey,
  type ProgChapter,
  type ProgressionData,
  type ProgressState,
  type ProgressSummary
} from '@shared/progression'
import { Aurora, Starfield } from '../components/Ambient'

/**
 * Flagging, live.
 *
 * The structure comes from the server's website; the state is the app's own
 * and updates the moment a gate boss dies in your log. Two honesties on this
 * page, both the server's before they are the app's:
 *
 *   * Steps that no log line announces - the "go and hail that NPC" ones -
 *     are ticked by hand and labelled as such, because a tracker that
 *     silently guesses is worse than one that admits what it cannot see.
 *   * A kill is not a flag. A gate boss killed outside a progression instance
 *     grants nothing on this server, so a mark the log made is drawn as
 *     KILLED, and only a sync from the site - or your own hand - turns it into
 *     FLAGGED. The page counts both, and says how many are which.
 */
export function Progression(): JSX.Element {
  const [data, setData] = useState<ProgressionData | null>(null)
  const [state, setState] = useState<ProgressState>({})
  const [summary, setSummary] = useState<ProgressSummary | null>(null)
  const [onlyRemaining, setOnlyRemaining] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [justFlagged, setJustFlagged] = useState<string[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  useEffect(() => {
    void window.triune.invoke('progress:get').then((r) => {
      setData(r.data)
      setState(r.state)
      setSummary(r.summary)
      // Open the first chapter that still has work in it.
      const first = r.summary.sections
        .flatMap((s) => s.chapters)
        .find((c) => c.earned < c.total)
      setOpen(first?.id ?? null)
    })

    return window.triune.on('progress:flagged', (p) => {
      setSummary(p.summary)
      setState(p.state)
      setJustFlagged(p.keys)
    })
  }, [])

  const toggle = async (key: string, earned: boolean): Promise<void> => {
    const next = await window.triune.invoke('progress:set', { key, earned })
    setSummary(next)
    setState((prev) => {
      const copy = { ...prev }
      if (earned) copy[key] = { at: Date.now(), source: 'manual' }
      else delete copy[key]
      return copy
    })
  }

  const pct = summary && summary.total > 0 ? Math.round((summary.earned / summary.total) * 100) : 0

  const chapterById = useMemo(() => {
    const map = new Map<string, ProgChapter>()
    for (const s of data?.sections ?? []) for (const c of s.chapters) map.set(c.id, c)
    return map
  }, [data])

  if (!data || !summary) {
    return (
      <div className="page">
        <div className="empty">Loading progression…</div>
      </div>
    )
  }

  return (
    <div className="page prog">
      {/* ---- headline ---- */}
      <header className="prog-hero">
        <Aurora />
        <Starfield count={30} seed={5} />
        <div className="ph-in">
          <div className="ph-dial" role="img" aria-label={`${pct} percent complete`}>
            <svg viewBox="0 0 120 120">
              <circle className="track" cx="60" cy="60" r="52" />
              <circle
                className="fill"
                cx="60"
                cy="60"
                r="52"
                style={{ strokeDasharray: `${(pct / 100) * 326.7} 326.7` }}
              />
            </svg>
            <div className="ph-num">
              <b>{pct}</b>
              <span>%</span>
            </div>
          </div>

          <div className="ph-copy">
            <p className="eyebrow">the long road</p>
            <h1>The Road</h1>
            <p className="lede">
              Four doors and forty-one flags, ending at the Plane of Time. Kills are read from your logs as
              they happen; the flags themselves are the account&apos;s, and the site is what confirms them.
            </p>
            <div className="ph-tally">
              {summary.sections.map((s) => (
                <div className="t" key={s.id}>
                  <span className="n num">
                    {s.earned}
                    <i>/{s.total}</i>
                  </span>
                  <span className="l">{s.name.replace(/^The /, '')}</span>
                </div>
              ))}
              <div className="t">
                <span className="n num">{summary.total - summary.earned}</span>
                <span className="l">Remaining</span>
              </div>
              {summary.unconfirmed > 0 && (
                <div className="t" title="Killed in your log, not yet confirmed as a flag by the site. Sync to check.">
                  <span className="n num warn">{summary.unconfirmed}</span>
                  <span className="l">Killed, unconfirmed</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ---- what's next ---- */}
      {summary.next.length > 0 && (
        <section className="panel prog-next">
          <div className="phead">
            <span className="t">Next up</span>
            <span className="spacer" />
            <label className="toggle">
              <input
                type="checkbox"
                checked={onlyRemaining}
                onChange={(e) => setOnlyRemaining(e.target.checked)}
              />
              only remaining
            </label>
            <button
              className="btn primary"
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              disabled={syncing}
              title="Read the account's flags and your characters' levels from the server's website"
              onClick={() => {
                setSyncing(true)
                setSyncNote(null)
                void window.triune
                  .invoke('site:sync')
                  .then((r) => {
                    if (r.summary) setSummary(r.summary)
                    if (r.state) setState(r.state)
                    const ok = r.characters.filter((c) => c.found)
                    const bad = r.characters.filter((c) => !c.found)
                    const unknown = r.characters.flatMap((c) => c.unknownSteps)
                    const unflagged = Math.max(0, ...r.characters.map((c) => c.killedUnflagged))
                    setSyncNote(
                      [
                        ok.length > 0
                          ? `Synced ${ok.map((c) => `${c.name}${c.level ? ` (${c.level})` : ''}`).join(', ')}.`
                          : null,
                        bad.length > 0
                          ? `Couldn't sync ${bad.map((c) => `${c.name} — ${c.error ?? 'not found'}`).join('; ')}`
                          : null,
                        unflagged > 0
                          ? `The site has ${unflagged} gate kill${unflagged === 1 ? '' : 's'} on record that the account is not flagged for — killed outside a progression instance.`
                          : null,
                        unknown.length > 0
                          ? `${unknown.length} step(s) on the site aren't in the bundled data: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}`
                          : null
                      ]
                        .filter(Boolean)
                        .join(' ')
                    )
                  })
                  .finally(() => setSyncing(false))
              }}
            >
              {syncing ? 'Syncing…' : 'Sync from the site'}
            </button>
            <button
              className={confirmReset ? 'btn danger' : 'btn'}
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              title="Clear every flag — use this if progress was recorded from the wrong Logs folder"
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  window.setTimeout(() => setConfirmReset(false), 5000)
                  return
                }
                setConfirmReset(false)
                void window.triune.invoke('progress:reset').then((s) => {
                  setSummary(s)
                  setState({})
                })
              }}
            >
              {confirmReset ? 'Clear everything?' : 'Reset'}
            </button>
          </div>
          <div className="pbody">
            {syncNote && (
              <p className="fhint" style={{ marginTop: 0 }}>
                {syncNote}
              </p>
            )}
            <div className="nextlist">
              {summary.next.map((n) => (
                <div className="nx" key={n.key}>
                  <span className="nx-mark" aria-hidden="true" />
                  <span className="nx-name">{n.step.name}</span>
                  <span className="nx-where">
                    {n.plane ?? n.step.zone ?? ''}
                    {n.step.level ? ` · lvl ${n.step.level}` : ''}
                  </span>
                  <span className="nx-ch">{n.chapter}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---- the climb ---- */}
      {summary.sections.map((sec) => (
        <section key={sec.id} className="prog-sec">
          <div className="prog-seghead">
            <span className="sn">{sec.name}</span>
            <span className="sd">{data.sections.find((s) => s.id === sec.id)?.detail}</span>
            <span className="spacer" />
            <span className="sc num">
              {sec.earned}/{sec.total}
            </span>
          </div>

          {sec.chapters.map((chSum) => {
            const ch = chapterById.get(chSum.id)
            if (!ch) return null
            const done = chSum.earned === chSum.total
            if (onlyRemaining && done) return null
            const isOpen = open === ch.id

            return (
              <article className={`prog-ch${done ? ' done' : ''}${isOpen ? ' open' : ''}`} key={ch.id}>
                <button className="pc-head" type="button" onClick={() => setOpen(isOpen ? null : ch.id)}>
                  <span className="pc-node">{done ? '✓' : chSum.earned}</span>
                  <span className="pc-title">
                    {ch.title}
                    {ch.era && <em>{ch.era}</em>}
                    {ch.blurb && <small>{ch.blurb}</small>}
                  </span>
                  <span className="pc-count num">
                    {chSum.earned}/{chSum.total}
                  </span>
                  <span className="pc-mini">
                    <i style={{ width: `${chSum.total ? (chSum.earned / chSum.total) * 100 : 0}%` }} />
                  </span>
                </button>

                {isOpen && (
                  <div className="pc-body">
                    {ch.groups.map((g) => (
                      <div className="pc-grp" key={`${ch.id}-${g.plane ?? 'x'}`}>
                        {g.plane && (
                          <div className="pc-gh">
                            <span className="gn">{g.plane}</span>
                            {g.planeShort && <span className="gz">{g.planeShort}</span>}
                          </div>
                        )}
                        {g.steps.map((step) => {
                          const key = stepKey(ch.id, step)
                          const mark = state[key]
                          const earned = !!mark
                          if (onlyRemaining && earned) return null
                          const manual = isManualStep(step)
                          // Three states, not two: nothing, a kill the log saw,
                          // and a flag the site or your own hand confirmed.
                          const confirmed = isConfirmed(mark)
                          const how =
                            mark?.source === 'log'
                              ? 'killed in your log'
                              : mark?.source === 'manual'
                                ? 'ticked by hand'
                                : 'flagged on the account, per the site'

                          return (
                            <div
                              className={`pc-st${earned ? (confirmed ? ' on' : ' killed') : ''}${justFlagged.includes(key) ? ' fresh' : ''}`}
                              key={key}
                            >
                              <button
                                className="pc-tick"
                                type="button"
                                aria-pressed={earned}
                                title={
                                  earned
                                    ? `${how[0].toUpperCase()}${how.slice(1)}${mark.by ? ` (${mark.by})` : ''} — click to clear`
                                    : 'Mark as flagged'
                                }
                                onClick={() => void toggle(key, !earned)}
                              >
                                {earned ? (confirmed ? '✓' : '•') : ''}
                              </button>
                              <div className="pc-tx">
                                <div className="pc-nm">
                                  {step.name}
                                  {step.badge && <span className="stage">{step.badge}</span>}
                                  {manual && !earned && (
                                    <span
                                      className="byhand"
                                      title={
                                        step.kind === 'hail'
                                          ? 'A hail, not a kill — no log line announces it'
                                          : 'No log line announces this one'
                                      }
                                    >
                                      {step.kind === 'hail' ? 'hail · by hand' : 'by hand'}
                                    </span>
                                  )}
                                  {earned && !confirmed && (
                                    <span
                                      className="unconfirmed"
                                      title="The log saw this die with you there. On this server a kill outside a progression instance grants no flag, so it is not counted as one until the site says so. Sync to check."
                                    >
                                      killed · flag unconfirmed
                                    </span>
                                  )}
                                </div>
                                {step.how && <div className="pc-how">{step.how}</div>}
                                {(step.zone || step.level || step.opens) && (
                                  <div className="pc-where">
                                    {step.zone}
                                    {step.level ? <span className="lv">lvl {step.level}</span> : null}
                                    {step.zoneShort ? <span className="sh">{step.zoneShort}</span> : null}
                                    {step.opens ? <span className="opens">⚑ {step.opens}</span> : null}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {ch.opens && <div className="pc-opens">⚑ {ch.opens}</div>}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}
