import { describe, it, expect } from 'vitest'
import { quickStartNote, quickStartPicks } from './quickStart'
import { STRINGS } from '@/test/strings'

const ctx = { locations: [], forecastIds: new Set<string>() }
const NOV = 11

/**
 * "⚡ Hurtig start" promises "Find pladser nær dig". With the location prompt
 * declined it put Fornæs Fyr, Kegnæs Fyr and Svendborgsundbroen — Djursland,
 * Als and Fyn — on the dashboard without a word that these were the country's
 * picks, not spots near the user.
 */
describe('the quick start', () => {
  it('takes the spots nearest the user when it has a position', () => {
    const r = quickStartPicks({ lat: 56.44, lon: 10.95 }, NOV, ctx) // Djursland
    expect(r.where).toBe('near')
    expect(r.results).toHaveLength(3)
    expect(quickStartNote(r.where)).toBeNull()
  })

  it('says so when it had no position and picked spots from across the country', () => {
    const r = quickStartPicks(null, NOV, ctx)
    expect(r.where).toBe('no_position')
    expect(r.results).toHaveLength(3)
    expect(quickStartNote(r.where)).toBe(STRINGS.da.quick_start_no_pos)
  })

  it('says so when no known spot is near the position', () => {
    const r = quickStartPicks({ lat: 52.52, lon: 13.4 }, NOV, ctx) // Berlin
    expect(r.where).toBe('none_near')
    expect(r.results).toHaveLength(3)
    expect(quickStartNote(r.where)).toBe(STRINGS.da.quick_start_none_near)
  })
})

describe('where it is said', () => {
  const sources = import.meta.glob<string>(['/src/views/*.vue'], { query: '?raw', import: 'default', eager: true })
  const src = (path: string) => sources[path] ?? ''

  it('the welcome screen shows the note after a quick start', () => {
    const v = src('/src/views/WelcomeView.vue')
    expect(v).toMatch(/quickStartPicks\(/)
    expect(v).toMatch(/const note = quickStartNote\(where\)\s+if \(note\) showToast\(note/)
  })

  // The quick start sets no target species, and the setup guide lets "Vis
  // fiskeforhold" through with none: scores 52 "Middel" that were 79 "Godt"
  // once Havørred was picked, with nothing saying the score was general.
  it('the dashboard says when no target species are picked, with the way to pick them', () => {
    const v = src('/src/views/DashboardView.vue')
    expect(v).toMatch(/<p v-else class="targets none">[^<]*\{\{ t\('dash_no_targets'\) \}\}\s*<RouterLink :to="\{ name: 'species' \}">\{\{ t\('dash_pick_targets'\) \}\}<\/RouterLink>/)
  })
})
