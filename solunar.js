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

const Solunar = (() => {
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  // Translate via the app's global t() — falls back to the key if app.js isn't loaded yet
  const tr = k => (typeof t === 'function') ? t(k) : k;

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
    return (L - RA) * 4; // minutes
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
    const L = ((218.316 + 13.176396 * d) % 360 + 360) % 360;
    const M = ((134.963 + 13.064993 * d) % 360 + 360) % 360;
    const F = ((93.272  + 13.229350 * d) % 360 + 360) % 360;
    return ((L + 6.289 * Math.sin(M * DEG) + 0.214 * Math.sin(2 * M * DEG) - 1.274 * Math.sin((2*L - M) * DEG) - 0.658 * Math.sin(2*L * DEG)) % 360 + 360) % 360;
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
    const jDay  = jd(date);
    const d     = jDay - 2451545.0;
    const phase = ((d / 29.53059) % 1 + 1) % 1;
    return phase;
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
   * Returns major1, major2, minor1, minor2 each as { start, end } UTC Date objects.
   * Major periods: ±1 hour around moon upper/lower transit.
   * Minor periods: ±30 min around moonrise/moonset.
   */
  function getSolunarPeriods(date, lat, lon) {
    const transit = getMoonTransitUTC(date, lon);

    // Lower transit ≈ 12h 25min after upper transit
    const antiTransit = new Date(transit.getTime() + 12 * 3600000 + 25 * 60000);

    const { rise, set } = getMoonRiseSetUTC(date, lat, lon);

    const MAJOR_HALF = 3600000;   // ±1 hour
    const MINOR_HALF = 1800000;   // ±30 min

    return {
      major1: { start: new Date(transit.getTime()     - MAJOR_HALF), end: new Date(transit.getTime()     + MAJOR_HALF) },
      major2: { start: new Date(antiTransit.getTime() - MAJOR_HALF), end: new Date(antiTransit.getTime() + MAJOR_HALF) },
      minor1: rise ? { start: new Date(rise.getTime() - MINOR_HALF), end: new Date(rise.getTime() + MINOR_HALF) } : null,
      minor2: set  ? { start: new Date(set.getTime()  - MINOR_HALF), end: new Date(set.getTime() + MINOR_HALF) } : null,
      transit,
      antiTransit,
      rise,
      set,
    };
  }

  /**
   * solunarScore(dateTime, periods)
   * Returns { score: 0–30, label, period }
   * where score contribution to add to overall fishing score.
   */
  function solunarScore(dateTime, periods) {
    const t = dateTime.getTime();

    // Full inside period
    if (periods.major1 && t >= periods.major1.start && t <= periods.major1.end)
      return { score: 18, label: '🌙 ' + tr('sol_culm'),  period: 'major' };
    if (periods.major2 && t >= periods.major2.start && t <= periods.major2.end)
      return { score: 18, label: '🌙 ' + tr('sol_under'), period: 'major' };
    if (periods.minor1 && t >= periods.minor1.start && t <= periods.minor1.end)
      return { score: 10, label: '🌙 ' + tr('sol_rise'),  period: 'minor' };
    if (periods.minor2 && t >= periods.minor2.start && t <= periods.minor2.end)
      return { score: 10, label: '🌙 ' + tr('sol_set'),   period: 'minor' };

    // Approaching (within 2 hours of major, 1 hour of minor)
    const APPROACH_MAJOR = 7200000;
    const APPROACH_MINOR = 3600000;

    for (const [period, half, key] of [
      [periods.major1, APPROACH_MAJOR, 'major'],
      [periods.major2, APPROACH_MAJOR, 'major'],
      [periods.minor1, APPROACH_MINOR, 'minor'],
      [periods.minor2, APPROACH_MINOR, 'minor'],
    ]) {
      if (!period) continue;
      const center = (period.start.getTime() + period.end.getTime()) / 2;
      const dist = Math.abs(t - center);
      if (dist < half * 3) {
        const frac = 1 - dist / (half * 3);
        const maxScore = key === 'major' ? 12 : 6;
        return { score: Math.round(maxScore * frac * 0.5), label: '🌙 ' + tr('sol_approach'), period: key };
      }
    }

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
  return { getSunTimes, getSolunarPeriods, getMoonPhase, moonPhaseLabel, solunarScore, timeOfDayScore, getMoonTransitUTC };
})();
