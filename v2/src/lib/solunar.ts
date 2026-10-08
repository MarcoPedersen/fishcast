// @ts-nocheck — ported 1:1 from v1 solunar.js; typed wrapper below
/**
 * FishCast — Solunar & Astronomical Calculations
 *
 * Calculates:
 *  - Sunrise / sunset times (NOAA algorithm)
 *  - Moon transit (overhead/underfoot) → Major solunar periods
 *  - Moonrise / moonset → Minor solunar periods
 *  - Moon phase (new/full/quarter)
 *  - Solunar score for a given UTC hour
 *
 * Accuracy: ~±5 min — adequate for fishing planning.
 */

import { t } from './i18n'

export const Solunar = (() => {
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  // Translate via the app's global t() — falls back to the key if app.js isn't loaded yet
  const tr = (k: string) => t(k);

  // ── Julian Date ───────────────────────────────────────────
  function jd(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  // ── Sun position helpers ──────────────────────────────────
  function sunDeclination(jDay) {
    const n = jDay - 2451545.0;
    const L = (280.460 + 0.9856474 * n) % 360;
    const g = (357.528 + 0.9856003 * n) % 360;
    const lambda = L + 1.915 * Math.sin(g * DEG) + 0.020 * Math.sin(2 * g * DEG);
    const eps = 23.439 - 0.0000004 * n;
    return Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG)) * RAD;
  }

  function equationOfTime(jDay) {
    const n = jDay - 2451545.0;
    const L = (280.460 + 0.9856474 * n) % 360;
    const g = (357.528 + 0.9856003 * n) % 360;
    const lambda = L + 1.915 * Math.sin(g * DEG) + 0.020 * Math.sin(2 * g * DEG);
    const eps = 23.439 - 0.0000004 * n;
    const RA = Math.atan2(Math.cos(eps * DEG) * Math.sin(lambda * DEG), Math.cos(lambda * DEG)) * RAD;
    // L is in [0,360) but atan2 gives RA in (-180,180], so from the autumn to the
    // spring equinox L - RA came out ≈ 360° + EoT — 1440 min — and every sun time
    // landed a whole day early, scoring all hours of half the year as 'night'.
    // Wrap to (-180,180] before converting; the true EoT is within ±17 min.
    let e = L - RA;
    e = ((e + 180) % 360 + 360) % 360 - 180;
    return e * 4; // minutes
  }

  /**
   * getSunTimes(date, lat, lon)
   * Returns { sunrise, sunset, solarNoon } as Date objects (UTC).
   * Returns null if sun doesn't rise/set (polar regions).
   */
  function getSunTimes(date, lat, lon) {
    const jDay = jd(date);
    const decl = sunDeclination(jDay);
    const eot  = equationOfTime(jDay);

    const cosHA = (Math.cos(90.833 * DEG) - Math.sin(lat * DEG) * Math.sin(decl * DEG))
                / (Math.cos(lat * DEG) * Math.cos(decl * DEG));

    if (cosHA < -1) return { sunrise: null, sunset: null, solarNoon: new Date(date.getTime()) };
    if (cosHA >  1) return { sunrise: null, sunset: null, solarNoon: null };

    const ha = Math.acos(cosHA) * RAD; // degrees

    // Solar noon UTC = 720 - (4 * lon) - eot  (in minutes)
    const noonMin = 720 - 4 * lon - eot;
    const riseMin = noonMin - ha * 4;
    const setMin  = noonMin + ha * 4;

    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    return {
      sunrise:   new Date(dayStart.getTime() + riseMin * 60000),
      sunset:    new Date(dayStart.getTime() + setMin  * 60000),
      solarNoon: new Date(dayStart.getTime() + noonMin * 60000),
    };
  }

  // ── Moon position ─────────────────────────────────────────
  function getMoonEclipticLon(jDay) {
    const d = jDay - 2451545.0;
    const L  = ((218.316 + 13.176396  * d) % 360 + 360) % 360; // mean longitude
    const M  = ((134.963 + 13.064993  * d) % 360 + 360) % 360; // mean anomaly
    const F  = ((93.272  + 13.229350  * d) % 360 + 360) % 360; // argument of latitude
    const D  = ((297.850 + 12.190749  * d) % 360 + 360) % 360; // mean elongation from the sun
    const Ms = ((357.529 + 0.98560028 * d) % 360 + 360) % 360; // sun's mean anomaly
    // Evection and variation are functions of the elongation D, not of L (the
    // port had −1.274·sin(2L−M) and −0.658·sin(2L)). That error reached ~2°,
    // which put the moon phase up to 6 h off and moon transits up to 15 min off.
    return ((L + 6.289 * Math.sin(M * DEG) + 1.274 * Math.sin((2 * D - M) * DEG) + 0.658 * Math.sin(2 * D * DEG)
      + 0.214 * Math.sin(2 * M * DEG) - 0.186 * Math.sin(Ms * DEG) - 0.114 * Math.sin(2 * F * DEG)) % 360 + 360) % 360;
  }

  // Sun's apparent ecliptic longitude — the same low-precision series as above.
  function sunEclipticLon(jDay) {
    const n = jDay - 2451545.0;
    const L = (280.460 + 0.9856474 * n) % 360;
    const g = (357.528 + 0.9856003 * n) % 360;
    return ((L + 1.915 * Math.sin(g * DEG) + 0.020 * Math.sin(2 * g * DEG)) % 360 + 360) % 360;
  }

  function getMoonRA(jDay) {
    const lon = getMoonEclipticLon(jDay);
    const lat = 0; // simplified (ecliptic latitude ≈ 0 for transit timing)
    const eps = 23.439;
    const lonR = lon * DEG, epsR = eps * DEG;
    const ra = Math.atan2(Math.sin(lonR) * Math.cos(epsR), Math.cos(lonR)) * RAD;
    return ((ra % 360) + 360) % 360; // degrees
  }

  function getGMST(jDay) {
    const T = (jDay - 2451545.0) / 36525.0;
    let gmst = 280.46061837 + 360.98564736629 * (jDay - 2451545.0) + 0.000387933 * T * T;
    return ((gmst % 360) + 360) % 360;
  }

  /**
   * getMoonTransitUTC(date, lon)
   * Returns UTC Date of moon transit (upper culmination) on the given date.
   * Accurate to ~±10 min.
   */
  function getMoonTransitUTC(date, lon) {
    // Start iterating from approximate noon
    let jDay = jd(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)));

    for (let i = 0; i < 60; i++) {
      const moonRA = getMoonRA(jDay);
      const gmst   = getGMST(jDay);
      const lst    = ((gmst + lon) % 360 + 360) % 360; // local sidereal time in degrees

      let ha = lst - moonRA; // hour angle in degrees
      if (ha > 180)  ha -= 360;
      if (ha < -180) ha += 360;

      // Moon moves ~0.549°/hour relative to stars → effective rate ~14.49°/hour
      const correction = ha / (360.985647 - 360 * 0.0366) * (-1);
      // Simpler: correction in days ≈ -HA / (360 * 1.0027)
      const corrDays = -ha / 360.985647;
      jDay += corrDays;

      if (Math.abs(ha) < 0.005) break;
    }

    return new Date((jDay - 2440587.5) * 86400000);
  }

  /**
   * getMoonTransits(fromMs, toMs, lon)
   * Every upper (hour angle 0°) and lower (180°) moon transit in [fromMs, toMs],
   * as [{ at: Date, kind: 'upper' | 'lower' }] in time order. The hour angle
   * grows ~2.4° per 10-minute step, so a crossing is never skipped and linear
   * interpolation inside the step is accurate to well under a minute.
   */
  function getMoonTransits(fromMs, toMs, lon) {
    const STEP = 10 * 60000;
    const ha = (ms) => {
      const jDay = ms / 86400000 + 2440587.5;
      return ((getGMST(jDay) + lon - getMoonRA(jDay)) % 360 + 360) % 360;
    };
    const out = [];
    let t0 = fromMs, h0 = ha(t0);
    while (t0 < toMs) {
      const t1 = t0 + STEP, h1 = ha(t1);
      let frac = null, kind = null;
      if (h1 < h0)                 { frac = (360 - h0) / (h1 + 360 - h0); kind = 'upper'; } // wrapped past 0°
      else if (h0 < 180 && h1 >= 180) { frac = (180 - h0) / (h1 - h0);       kind = 'lower'; }
      if (kind) {
        const at = t0 + frac * STEP;
        if (at >= fromMs && at <= toMs) out.push({ at: new Date(at), kind });
      }
      t0 = t1; h0 = h1;
    }
    return out;
  }

  /**
   * getMoonRiseSetUTC(date, lat, lon)
   * Returns approximate { rise, set } as Date objects (UTC).
   * Uses simplified iterative method.
   */
  function getMoonRiseSetUTC(date, lat, lon) {
    const results = { rise: null, set: null };
    const latR = lat * DEG;
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    // Sample moon altitude every 30 minutes and find sign changes
    let prevAlt = null;
    const altitudes = [];

    for (let h = 0; h <= 24; h += 0.5) {
      const t = new Date(dayStart.getTime() + h * 3600000);
      const jDay = jd(t);
      const moonLon = getMoonEclipticLon(jDay);
      const eps = 23.439 * DEG;
      const lonR = moonLon * DEG;
      const dec  = Math.asin(Math.sin(eps) * Math.sin(lonR));
      const ra   = Math.atan2(Math.sin(lonR) * Math.cos(eps), Math.cos(lonR)) * RAD;
      const lst  = getGMST(jDay) + lon;
      const ha   = (lst - ra) * DEG;
      const alt  = Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha)) * RAD;
      altitudes.push({ h, alt });
    }

    for (let i = 1; i < altitudes.length; i++) {
      const a = altitudes[i - 1];
      const b = altitudes[i];
      if (a.alt < 0 && b.alt >= 0 && !results.rise) {
        const frac = -a.alt / (b.alt - a.alt);
        results.rise = new Date(dayStart.getTime() + (a.h + frac * 0.5) * 3600000);
      }
      if (a.alt >= 0 && b.alt < 0 && !results.set) {
        const frac = a.alt / (a.alt - b.alt);
        results.set = new Date(dayStart.getTime() + (a.h + frac * 0.5) * 3600000);
      }
    }

    return results;
  }

  /**
   * getMoonPhase(date)
   * Returns 0–1 where 0 = new moon, 0.5 = full moon.
   */
  function getMoonPhase(date) {
    // The phase IS the moon's elongation from the sun. Counting mean synodic
    // months from J2000 instead (as the port did) put phase 0 on 1 Jan 2000,
    // five days before that month's new moon, so every phase ran ~5 days ahead.
    const jDay = jd(date);
    const elong = getMoonEclipticLon(jDay) - sunEclipticLon(jDay);
    return ((elong / 360) % 1 + 1) % 1;
  }

  function moonPhaseLabel(phase) {
    if (phase < 0.03 || phase > 0.97) return { label: '🌑 ' + tr('moon_lbl_new'),     score: 15 };
    if (phase < 0.22)                 return { label: '🌒 ' + tr('moon_lbl_waxing'),  score: 8  };
    if (phase < 0.28)                 return { label: '🌓 ' + tr('moon_lbl_quarter'), score: 5  };
    if (phase < 0.47)                 return { label: '🌔 ' + tr('moon_lbl_waxing'),  score: 8  };
    if (phase < 0.53)                 return { label: '🌕 ' + tr('moon_lbl_full'),    score: 15 };
    if (phase < 0.72)                 return { label: '🌖 ' + tr('moon_lbl_waning'),  score: 8  };
    if (phase < 0.78)                 return { label: '🌗 ' + tr('moon_lbl_quarter'), score: 5  };
    return                                    { label: '🌘 ' + tr('moon_lbl_waning'),  score: 8  };
  }

  /**
   * getSolunarPeriods(date, lat, lon)
   * Returns `majors` (every major period of the day, each { start, end, kind }),
   * plus major1/major2 (the day's first upper / lower one) and minor1/minor2,
   * as UTC Date objects.
   * Major periods: ±1 hour around moon upper/lower transit.
   * Minor periods: ±30 min around moonrise/moonset.
   *
   * Memoised per (local day, place to 3 decimals ≈ 100 m), and computed FROM
   * those rounded coordinates, so a result depends on its key alone (0.0005°
   * moves a transit by well under a second). The 28 h transit scan costs ~113 µs
   * against ~32 µs before it, and scoreWindow asks once per window and method
   * (twice for an overnight one) — the same few hundred (day, spot) pairs again
   * and again on every rescore. The result is SHARED, so it is frozen; its
   * Dates must not be changed either.
   */
  const PERIODS_CACHE_MAX = 512; // 18 spots + 8 compare spots × 8 days, with room for catch backtests
  const periodsCache = new Map();
  function getSolunarPeriods(date, lat, lon) {
    const y = date.getUTCFullYear(), m = date.getUTCMonth(), d = date.getUTCDate();
    const la = Math.round(lat * 1000) / 1000, lo = Math.round(lon * 1000) / 1000;
    // Local midnight in the key, not just y/m/d: the scan window is local, so a
    // change of time zone mid-session must not reuse the other zone's answer.
    const key = `${new Date(y, m, d).getTime()}|${la}|${lo}`;
    let hit = periodsCache.get(key);
    if (hit) {
      periodsCache.delete(key); // re-insert: Map order is the LRU order
      periodsCache.set(key, hit);
      return hit;
    }
    hit = computeSolunarPeriods(y, m, d, la, lo);
    periodsCache.set(key, hit);
    if (periodsCache.size > PERIODS_CACHE_MAX) periodsCache.delete(periodsCache.keys().next().value);
    return hit;
  }

  function computeSolunarPeriods(y, m, d, lat, lon) {
    // The day is a local calendar day, encoded as UTC midnight of its local date
    // parts (the window convention). The moon transits every ~12h25m, so a day
    // holds two or three; take all of them from 2 h before local midnight to 2 h
    // after the next. Only the transit nearest UTC noon plus one 12h25m later
    // used to be modelled, which dropped a lower transit before the upper one —
    // often the dawn major — on most days.
    const transits = getMoonTransits(
      new Date(y, m, d).getTime() - 2 * 3600000,
      new Date(y, m, d + 1).getTime() + 2 * 3600000,
      lon,
    );

    const { rise, set } = getMoonRiseSetUTC(new Date(Date.UTC(y, m, d)), lat, lon);

    const MAJOR_HALF = 3600000;   // ±1 hour
    const MINOR_HALF = 1800000;   // ±30 min
    const around = (at, half) => Object.freeze({ start: new Date(at.getTime() - half), end: new Date(at.getTime() + half) });

    const transit     = transits.find((x) => x.kind === 'upper')?.at ?? null;
    const antiTransit = transits.find((x) => x.kind === 'lower')?.at ?? null;

    return Object.freeze({
      majors: Object.freeze(transits.map(({ at, kind }) => Object.freeze({ ...around(at, MAJOR_HALF), kind }))),
      major1: transit     ? around(transit, MAJOR_HALF)     : null,
      major2: antiTransit ? around(antiTransit, MAJOR_HALF) : null,
      minor1: rise ? around(rise, MINOR_HALF) : null,
      minor2: set  ? around(set, MINOR_HALF)  : null,
      transit,
      antiTransit,
      rise,
      set,
    });
  }

  /**
   * solunarScore(dateTime, periods)
   * Returns { score: 0–18, label, period }
   * where score contribution to add to overall fishing score, and period is
   * 'major' / 'minor' inside a period, 'approach-major' / 'approach-minor' on
   * the ramp towards one, or null.
   */
  function solunarScore(dateTime, periods) {
    const t = dateTime.getTime();

    // Full inside period
    for (const p of periods.majors) {
      if (t >= p.start && t <= p.end)
        return { score: 18, label: '🌙 ' + tr(p.kind === 'lower' ? 'sol_under' : 'sol_culm'), period: 'major' };
    }
    if (periods.minor1 && t >= periods.minor1.start && t <= periods.minor1.end)
      return { score: 10, label: '🌙 ' + tr('sol_rise'),  period: 'minor' };
    if (periods.minor2 && t >= periods.minor2.start && t <= periods.minor2.end)
      return { score: 10, label: '🌙 ' + tr('sol_set'),   period: 'minor' };

    // Approaching: a ramp from the period's centre out to 6 h for a major, 3 h
    // for a minor (3 × the constants below), worth at most half the period's
    // inside score. Take the strongest ramp rather than the first period listed,
    // which could be a major 5 h away while another is 1.5 h away.
    const APPROACH_MAJOR = 7200000;
    const APPROACH_MINOR = 3600000;

    let best = null;
    for (const [period, half, key] of [
      ...periods.majors.map((p) => [p, APPROACH_MAJOR, 'major']),
      [periods.minor1, APPROACH_MINOR, 'minor'],
      [periods.minor2, APPROACH_MINOR, 'minor'],
    ]) {
      if (!period) continue;
      const center = (period.start.getTime() + period.end.getTime()) / 2;
      const dist = Math.abs(t - center);
      if (dist < half * 3) {
        const frac = 1 - dist / (half * 3);
        const maxScore = key === 'major' ? 12 : 6;
        const score = Math.round(maxScore * frac * 0.5);
        if (!best || score > best.score) best = { score, key };
      }
    }
    // Reported as 'approach-*', never 'major': species solunarMajor bonuses
    // test for 'major', and were paid up to 6 h out (309 of October's 720
    // hours). A ramp that rounds to 0 gets no label, so it shows no tag.
    if (best && best.score > 0)
      return { score: best.score, label: '🌙 ' + tr('sol_approach'), period: 'approach-' + best.key };

    return { score: 0, label: null, period: null };
  }

  /**
   * timeOfDayScore(dateTime, sunTimes)
   * Returns { score, label }
   */
  function timeOfDayScore(dateTime, sunTimes) {
    if (!sunTimes.sunrise || !sunTimes.sunset) return { score: 0, label: null, period: null };

    const t   = dateTime.getTime();
    const sr  = sunTimes.sunrise.getTime();
    const ss  = sunTimes.sunset.getTime();
    const sn  = sunTimes.solarNoon.getTime();

    const PRE_DAWN  = sr - 60 * 60000;   // 1h before sunrise
    const DAWN_END  = sr + 2 * 3600000;  // 2h after sunrise
    const PRE_DUSK  = ss - 90 * 60000;   // 1.5h before sunset
    const POST_DUSK = ss + 60 * 60000;   // 1h after sunset

    if (t >= PRE_DAWN && t <= DAWN_END) {
      // Dawn window — best period
      const center = sr;
      const dist   = Math.abs(t - center);
      const frac   = Math.max(0, 1 - dist / (90 * 60000));
      return { score: Math.round(5 + 18 * frac), label: '🌅 ' + tr('tod_dawn'), period: 'dawn' };
    }
    if (t >= PRE_DUSK && t <= POST_DUSK) {
      // Dusk window
      const center = ss;
      const dist   = Math.abs(t - center);
      const frac   = Math.max(0, 1 - dist / (75 * 60000));
      return { score: Math.round(5 + 13 * frac), label: '🌇 ' + tr('tod_dusk'), period: 'dusk' };
    }
    if (t < sr - 3600000 || t > ss + 3600000) {
      // Night
      return { score: 5, label: '🌙 ' + tr('tod_night'), period: 'night' };
    }
    // Midday penalty
    const midDist = Math.abs(t - sn);
    if (midDist < 2 * 3600000) {
      return { score: -8, label: '☀️ ' + tr('tod_midday'), period: 'midday' };
    }
    return { score: 2, label: null, period: null };
  }

  // Public API
  return { getSunTimes, getSolunarPeriods, getMoonPhase, moonPhaseLabel, solunarScore, timeOfDayScore, getMoonTransitUTC, PERIODS_CACHE_MAX };
})();
