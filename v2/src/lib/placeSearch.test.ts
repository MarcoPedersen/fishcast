import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePlaceSearch, locationFromSearch, municipalityShown, SEARCH_DEBOUNCE_MS } from './placeSearch'
import { geocode, type GeoResult } from './weather'
import { langReady, setLang } from './i18n'
import { STRINGS } from '@/test/strings'

vi.mock('./weather', () => ({ geocode: vi.fn() })) // never the network

const place = (name: string, lat = 56, lon = 10): GeoResult => ({ name, admin1: '', lat, lon, country: 'DK' })

/** A geocoder whose answers the test releases by hand, in any order. */
function manualGeocoder() {
  const calls: { q: string; answer: (r: GeoResult[]) => void; fail: (e: Error) => void }[] = []
  const fn = vi.fn((q: string) => new Promise<GeoResult[]>((answer, fail) => { calls.push({ q, answer, fail }) }))
  return { fn, calls }
}

async function type(s: ReturnType<typeof usePlaceSearch>, text: string) {
  s.query.value = text
  s.onInput()
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
}

describe('place search ordering', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ignores an older query answering after a newer one', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Hund')
    await type(s, 'Hundested')
    expect(g.calls.map((c) => c.q)).toEqual(['Hund', 'Hundested'])
    g.calls[1].answer([place('Hundested')])
    g.calls[0].answer([place('Hundige'), place('Hundborg')]) // the slow one lands last
    await vi.advanceTimersByTimeAsync(0)
    expect(s.results.value.map((r) => r.name)).toEqual(['Hundested'])
  })

  it('a pick cancels the pending search — no "no places found" under the emptied box', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    s.query.value = 'Køge'
    s.onInput()
    s.reset() // add() picked a result within the debounce
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2)
    expect(g.fn).not.toHaveBeenCalled()
    expect(s.searched.value).toBe(false)
    expect(s.busy.value).toBe(false)
  })

  it('a pick also discards a search already in flight', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Køge')
    s.reset()
    g.calls[0].answer([place('Køge')])
    await vi.advanceTimersByTimeAsync(0)
    expect(s.results.value).toEqual([])
    expect(s.searched.value).toBe(false)
  })

  it('a failed request says so instead of "no places found"', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Hundested')
    g.calls[0].fail(new TypeError('Failed to fetch')) // offline on the phone
    await vi.advanceTimersByTimeAsync(0)
    expect(s.failed.value).toBe(true)
    expect(s.searched.value).toBe(false)
    expect(s.busy.value).toBe(false)
  })

  it('a genuine empty answer is "no places found"', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Xyzzy')
    g.calls[0].answer([])
    await vi.advanceTimersByTimeAsync(0)
    expect(s.searched.value).toBe(true)
    expect(s.failed.value).toBe(false)
  })

  it('clearing the box drops the in-flight answer', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Køge')
    s.query.value = ''
    s.onInput()
    g.calls[0].answer([place('Køge')])
    await vi.advanceTimersByTimeAsync(0)
    expect(s.results.value).toEqual([])
  })
})

/**
 * Open-Meteo answers with the six best matches in the world. Asked so, a
 * Danish postcode, which the "no places found" line says to try, found the
 * cities abroad that share it: "8000" gave Zürich, Burgas, Amiens, Brügge,
 * Arvada and Koolkerke, and no Aarhus; "3100" put Toulouse above Hornbæk;
 * and "Lund" gave six Lunds abroad and none of Denmark's. (Open-Meteo's
 * answers on 23 November 2026.)
 */
describe('the place search looks in Denmark first', () => {
  const abroad = (name: string, lat: number, lon: number, country: string): GeoResult => ({ ...place(name, lat, lon), country })
  const WORLD: Record<string, GeoResult[]> = {
    '8000': [abroad('Zürich', 47.37, 8.55, 'CH'), abroad('Burgas', 42.5, 27.47, 'BG'), abroad('Amiens', 49.9, 2.3, 'FR')],
    Malmö: [abroad('Malmø', 55.6, 13.0, 'SE')],
    Kiel: [abroad('Kiel', 54.32, 10.13, 'DE'), abroad('Kielce', 50.87, 20.63, 'PL'), place('Kielstrup', 56.5, 9.8)],
    // Asked in Danish, Open-Meteo spells the Swedish names the Danish way:
    // Mölle (Kullen) comes back as "Mølle", and Malmö as "Malmø".
    Mölle: [abroad('Mølle', 56.28, 12.5, 'SE'), abroad('Mollem', 50.93, 4.22, 'BE'), abroad('Molles', 46.11, 3.55, 'FR')],
    Mølle: [abroad('Mølle', 56.28, 12.5, 'SE'), abroad('Mollem', 50.93, 4.22, 'BE')],
  }
  const DENMARK: Record<string, GeoResult[]> = {
    '8000': [place('Aarhus C', 56.16, 10.2)], Malmö: [],
    // Open-Meteo matches loosely within Denmark: a name abroad always found some.
    Kiel: [place('Kielstrup', 56.5, 9.8), place('Kelstrup', 55.2, 9.4), place('Keldbymagle', 54.98, 12.37)],
    Mölle: [place('Mollerup', 56.1, 9.9)], Mølle: [place('Mollerup', 56.1, 9.9)],
  }
  const answer = async (q: string, _lang: string, country?: string) => ((country === 'DK' ? DENMARK : WORLD)[q] ?? [])

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(geocode).mockImplementation(answer)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(geocode).mockReset()
  })

  it('a Danish postcode finds its town, not the cities abroad that share it', async () => {
    const s = usePlaceSearch()
    await type(s, '8000')
    expect(s.results.value.map((r) => r.name)).toEqual(['Aarhus C'])
  })

  it('a place found only abroad is still found', async () => {
    const s = usePlaceSearch()
    await type(s, 'Malmö')
    expect(s.results.value.map((r) => r.name)).toEqual(['Malmø'])
    expect(s.searched.value).toBe(true)
  })

  // The round Q review: Denmark's loose matches hid the place abroad that was
  // typed. "Kiel" gave Kielstrup, Kelstrup and Keldbymagle, and "Mölle"
  // (Kullen) gave Mollerup: the search of the world never ran. Both are asked
  // at once now, and a place abroad whose name begins with what was typed
  // comes after Denmark's, each place once.
  it("a place abroad named as typed comes after Denmark's look-alikes", async () => {
    const s = usePlaceSearch()
    await type(s, 'Kiel')
    expect(s.results.value.map((r) => r.name)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle', 'Kiel', 'Kielce'])
    await type(s, 'Mölle')
    expect(s.results.value.map((r) => r.name)).toEqual(['Mollerup', 'Mølle', 'Mollem', 'Molles'])
  })

  // The e2e: "Mölle" showed Mollem and Molles and not Mølle itself. ø is a
  // letter of its own, not o with an accent, so stripping accents left
  // "mølle", which does not begin with "molle".
  it('ö and ø are the same letter to the search, whichever was typed', async () => {
    const s = usePlaceSearch()
    await type(s, 'Mölle')
    expect(s.results.value.map((r) => r.name)).toContain('Mølle')
    await type(s, 'Mølle')
    expect(s.results.value.map((r) => r.name)).toEqual(['Mollerup', 'Mølle', 'Mollem'])
  })

  it('asks Denmark and the world at once, and keeps what one of them answers', async () => {
    const s = usePlaceSearch()
    await type(s, 'Kiel')
    expect(vi.mocked(geocode).mock.calls).toEqual([['Kiel', 'da', 'DK'], ['Kiel', 'da']])
    vi.mocked(geocode).mockImplementation(async (q, lang, country) => {
      if (!country) throw new TypeError('Failed to fetch')
      return answer(q, lang, country)
    })
    await type(s, '8000')
    expect(s.results.value.map((r) => r.name)).toEqual(['Aarhus C'])
    expect(s.failed.value).toBe(false)
    vi.mocked(geocode).mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    await type(s, 'Lund')
    expect(s.failed.value).toBe(true) // neither answered: offline, most likely
  })

  /**
   * Denmark's and the world's answers, released by hand: held(q, 'DK')
   * answers or fails the request for Denmark's places, held(q, 'world') the
   * other one.
   */
  function heldGeocode() {
    const asked: { q: string; dk: boolean; answer: () => void; fail: (e: Error) => void }[] = []
    vi.mocked(geocode).mockImplementation((q, _lang, country) => new Promise<GeoResult[]>((done, fail) => {
      const dk = country === 'DK'
      asked.push({ q, dk, answer: () => done((dk ? DENMARK : WORLD)[q] ?? []), fail })
    }))
    return (q: string, where: 'DK' | 'world') => asked.find((a) => a.q === q && a.dk === (where === 'DK'))!
  }
  const names = (s: ReturnType<typeof usePlaceSearch>) => s.results.value.map((r) => r.name)
  const state = (s: ReturnType<typeof usePlaceSearch>) => ({ busy: s.busy.value, searched: s.searched.value, failed: s.failed.value })

  // With Denmark answered and the world's request hanging, Denmark's places
  // waited for the world's 10 s deadline under 'Søger…'. They come first
  // either way, so they show at once, and the abroad matches join them.
  it("shows Denmark's places as they come, and adds the abroad matches when the world answers", async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await type(s, 'Kiel')
    held('Kiel', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle'])
    expect(state(s)).toEqual({ busy: true, searched: false, failed: false }) // the world is still asked
    held('Kiel', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle', 'Kiel', 'Kielce'])
    expect(state(s)).toEqual({ busy: false, searched: true, failed: false })
  })

  it("keeps a Danish postcode's town alone, and Denmark's places when the world gives up", async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await type(s, '8000')
    held('8000', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Aarhus C'])
    held('8000', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Aarhus C'])
    await type(s, 'Kiel')
    held('Kiel', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    held('Kiel', 'world').fail(new DOMException('The operation timed out.', 'TimeoutError'))
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle'])
    expect(state(s)).toEqual({ busy: false, searched: true, failed: false })
  })

  // Shown before Denmark answered, the places abroad would move down under Denmark's.
  it('waits for Denmark when the world answers first', async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await type(s, 'Kiel')
    held('Kiel', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual([])
    expect(state(s)).toEqual({ busy: true, searched: false, failed: false })
    held('Kiel', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle', 'Kiel', 'Kielce'])
  })

  it('waits for the world when Denmark has none, and says it failed only when both fail', async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await type(s, 'Malmö')
    held('Malmö', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual([])
    expect(state(s)).toEqual({ busy: true, searched: false, failed: false })
    held('Malmö', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Malmø'])
    await type(s, 'Mölle')
    held('Mölle', 'DK').fail(new TypeError('Failed to fetch'))
    await vi.advanceTimersByTimeAsync(0)
    expect(state(s)).toEqual({ busy: true, searched: false, failed: false })
    held('Mölle', 'world').fail(new TypeError('Failed to fetch'))
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual([])
    expect(state(s)).toEqual({ busy: false, searched: false, failed: true })
  })

  /** Runs a search for q whose two requests answer, or fail, at once. */
  async function done(s: ReturnType<typeof usePlaceSearch>, held: ReturnType<typeof heldGeocode>, q: string, fail?: Error) {
    await type(s, q)
    for (const where of ['DK', 'world'] as const) {
      if (fail) held(q, where).fail(fail)
      else held(q, where).answer()
    }
    await vi.advanceTimersByTimeAsync(0)
  }

  // The search's state, in one line for a screen reader (role=status in the
  // views): 'Søger…' and the failed line were said at best, the places found
  // never, and 'Ingen steder fundet' not as a status.
  it('says in one line where the search is: searching, how many places it found, none, or failed', async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    expect(s.said.value).toBe('')
    await type(s, 'Kiel')
    expect(s.said.value).toBe(STRINGS.da.geo_searching)
    held('Kiel', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.said.value).toBe('3 steder fundet. Søger…') // Denmark's, and the world still asked
    held('Kiel', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.said.value).toBe('5 steder fundet.')
    await type(s, 'Malmö')
    expect(s.said.value).toBe(STRINGS.da.geo_searching) // the places shown are the last search's
    held('Malmö', 'DK').answer()
    held('Malmö', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.said.value).toBe('1 sted fundet.')
    await done(s, held, 'Xyzzy')
    expect(s.said.value).toBe(STRINGS.da.geo_no_results)
    await done(s, held, 'Lund', new TypeError('Failed to fetch'))
    expect(s.said.value).toBe(STRINGS.da.geo_failed)
    s.query.value = ''
    s.onInput()
    expect(s.said.value).toBe('')
    await done(s, held, '8000')
    s.reset() // a pick
    expect(s.said.value).toBe('')
  })

  it('says it in English', async () => {
    setLang('en')
    try {
      await langReady()
      const held = heldGeocode()
      const s = usePlaceSearch()
      await type(s, 'Kiel')
      held('Kiel', 'DK').answer()
      await vi.advanceTimersByTimeAsync(0)
      expect(s.said.value).toBe('3 places found. Searching…')
      held('Kiel', 'world').answer()
      await vi.advanceTimersByTimeAsync(0)
      expect(s.said.value).toBe('5 places found.')
      await done(s, held, 'Malmö')
      expect(s.said.value).toBe('1 place found.')
      await done(s, held, 'Xyzzy')
      expect(s.said.value).toBe(STRINGS.en.geo_no_results)
    } finally {
      setLang('da')
    }
  })

  it("never lets an older query's Denmark replace a newer one's, and a pick or a clear drops what is still to come", async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await type(s, 'Kiel')
    await type(s, 'Mölle')
    held('Mölle', 'DK').answer()
    held('Kiel', 'DK').answer() // the slow one lands last
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Mollerup'])
    s.reset() // a pick while the world is still asked
    held('Mölle', 'world').answer()
    held('Kiel', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual([])
    expect(state(s)).toEqual({ busy: false, searched: false, failed: false })
    await type(s, '8000')
    s.query.value = ''
    s.onInput() // the box cleared before Denmark answered
    held('8000', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual([])
    expect(state(s)).toEqual({ busy: false, searched: false, failed: false })
  })

  // Typed over while the world is still asked, Denmark's places are the last
  // search's: no longer "found", and no line under them says it searches.
  it("says only that it searches once the next query is typed over this one's first places", async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await type(s, 'Kiel')
    held('Kiel', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.more.value).toBe(true)
    s.query.value = 'Malmö'
    s.onInput()
    expect(names(s)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle'])
    expect(s.more.value).toBe(false)
    expect(s.said.value).toBe(STRINGS.da.geo_searching)
  })

  // Denmark with none leaves the last search's places up, as before, until
  // the world answers. They are not this search's, so it says only that it searches.
  it('keeps the last places while Denmark has none and the world is still asked', async () => {
    const held = heldGeocode()
    const s = usePlaceSearch()
    await done(s, held, 'Kiel')
    await type(s, 'Malmö')
    held('Malmö', 'DK').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Kielstrup', 'Kelstrup', 'Keldbymagle', 'Kiel', 'Kielce'])
    expect(s.more.value).toBe(false)
    expect(s.said.value).toBe(STRINGS.da.geo_searching)
    held('Malmö', 'world').answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(s)).toEqual(['Malmø'])
    expect(s.said.value).toBe('1 sted fundet.')
  })
})

describe('locationFromSearch', () => {
  it('infers water and bottom type like the map does, instead of leaving them blank', () => {
    // Silkeborg, beside Langsø: blank used to mean "brackish" and sea tides.
    const loc = locationFromSearch({ name: 'Silkeborg', admin1: 'Midtjylland', lat: 56.17, lon: 9.55, country: 'DK' })
    expect(loc).toMatchObject({ name: 'Silkeborg, Midtjylland', lat: 56.17, lon: 9.55, waterType: 'fresh' })
    expect(loc.bottomType).toEqual(expect.any(String))
  })

  // Gurre Sø, Esrum Sø, Furesø and Arresø are four of the five spots nearest
  // Espergærde: the lakes' 'mixed' outvoted Helsingør Kysten's 'stone'.
  it('guesses the bottom type from the spots of the water it guesses', () => {
    const loc = locationFromSearch({ name: 'Espergærde', admin1: 'Region Hovedstaden', lat: 55.99078, lon: 12.55296, country: 'DK' })
    expect(loc).toMatchObject({ waterType: 'brackish', bottomType: 'stone' })
  })

  // Every spot within 40 km goes to the guess, not the five nearest: those
  // are four lakes and Helsingør Kysten at Hillerød, and its 'stone' alone
  // would decide (geo.ts inferBottomType).
  it('lets the five nearest spots of its water vote, not those of the five nearest', () => {
    const loc = locationFromSearch({ name: 'Hillerød', admin1: 'Region Hovedstaden', lat: 55.92857, lon: 12.30639, country: 'DK' })
    expect(loc).toMatchObject({ waterType: 'brackish', bottomType: 'mixed' })
  })

  it('omits the region when there is none', () => {
    expect(locationFromSearch(place('Hundested', 55.96, 11.85)).name).toBe('Hundested')
  })

  // Both Hjerting were saved as 'Hjerting, Region Syddanmark': two spots of
  // one name, though the list told them apart. Each is named as its row read.
  it('names a place with a twin in the results by its municipality too, as its row reads', () => {
    const coast: GeoResult = { name: 'Hjerting', admin1: 'Region Syddanmark', admin2: 'Esbjerg Kommune', lat: 55.5261, lon: 8.35802, country: 'DK' }
    const inland: GeoResult = { name: 'Hjerting', admin1: 'Region Syddanmark', admin2: 'Vejen Kommune', lat: 55.39258, lon: 9.03757, country: 'DK' }
    expect([coast, inland].map((r) => locationFromSearch(r, [coast, inland]).name))
      .toEqual(['Hjerting, Esbjerg Kommune, Region Syddanmark', 'Hjerting, Vejen Kommune, Region Syddanmark'])
    expect(locationFromSearch(coast, [coast]).name).toBe('Hjerting, Region Syddanmark')
    expect(locationFromSearch(coast).name).toBe('Hjerting, Region Syddanmark')
  })

  // The water guess reads words such as "sø" or "vig" in the name, and a
  // municipality can hold one (Furesø, Lemvig). The name given decides it
  // as before: a twin is no lake for its municipality's name.
  it("guesses a twin's water as it would without the municipality", () => {
    const at = (admin2: string): GeoResult => ({ name: 'Hornbæk', admin1: 'Region Hovedstaden', admin2, lat: 56.09027, lon: 12.45693, country: 'DK' })
    const twins = [at('Helsingør Kommune'), at('Furesø Kommune')]
    expect(twins.map((r) => locationFromSearch(r, twins).waterType)).toEqual(twins.map((r) => locationFromSearch(r).waterType))
  })
})

describe('municipalityShown', () => {
  const at = (name: string, admin1: string, admin2: string): GeoResult => ({ ...place(name), admin1, admin2 })

  it('names the municipality of two places that share a name and a region', () => {
    const coast = at('Hjerting', 'Region Syddanmark', 'Esbjerg Kommune')
    const inland = at('Hjerting', 'Region Syddanmark', 'Vejen Kommune')
    expect([coast, inland].map((r) => municipalityShown(r, [coast, inland]))).toEqual(['Esbjerg Kommune', 'Vejen Kommune'])
  })

  // The region already tells these two apart, so the municipality would only
  // lengthen the line.
  it('names none for two places that share a name but not a region', () => {
    const north = at('Lund', 'Region Nordjylland', 'Aalborg Kommune')
    const south = at('Lund', 'Region Syddanmark', 'Vejle Kommune')
    expect([north, south].map((r) => municipalityShown(r, [north, south]))).toEqual(['', ''])
  })

  // Most answers are several places of one region: only a shared name makes
  // two lines alike.
  it('names none for two places that share a region but not a name', () => {
    const west = at('Hundested', 'Region Hovedstaden', 'Halsnæs Kommune')
    const north = at('Hornbæk', 'Region Hovedstaden', 'Helsingør Kommune')
    expect([west, north].map((r) => municipalityShown(r, [west, north]))).toEqual(['', ''])
  })

  it('names none for a place alone in the list', () => {
    const lone = at('Hornbæk', 'Region Hovedstaden', 'Helsingør Kommune')
    expect(municipalityShown(lone, [lone])).toBe('')
  })
})
