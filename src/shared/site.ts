/**
 * What the server's website tells the app about the world, as the app
 * models it.
 *
 * Both of these are JSON the site already serves for its own homepage
 * (`/world`, `/champions`). The app reads them and draws them; it computes
 * none of it and submits nothing.
 */

/** Souls in the world right now. */
export interface WorldStatus {
  /**
   * Whether anything is measuring. False is "the site's counter is not
   * running", which is a different fact from "nobody is on" - so the UI shows
   * nothing rather than zero when this is false.
   */
  counting: boolean
  souls: number
  characters: number
  fetchedAt: number
}

export interface ChampionLeader {
  place: number
  name: string
  /** The site's own formatted figure - "1,000". */
  display: string
  level: number
  /** Full class names as the site writes them. */
  classes: string[]
}

export interface HallEvent {
  kind: 'clear' | 'born'
  /** A first clear of that encounter at that party size. */
  first: boolean
  /** "2026-09-19 12:27", as the site prints it. */
  when: string
  key: string
  name: string
  party: Array<{ name: string; classes: string[] }>
  bracket: string
  duration: string
  dps: number
}

export interface ChronicleEntry {
  title: string
  who: string
  detail: string
  date: string
  url: string | null
}

export interface Champions {
  ranked: number
  leaders: ChampionLeader[]
  /** Distinct kills on record, as the site counts them. */
  kills: number
  events: HallEvent[]
  chronicle: ChronicleEntry[]
  newest: { name: string; when: string } | null
  /** Characters active in the last while, and hours played - the site's own figures. */
  active: number
  hours: number
  boardUrl: string
  raidsUrl: string
  fetchedAt: number
}

export interface ChampionsResult {
  data: Champions | null
  error: string | null
  stale: boolean
}
