/**
 * Microgrid simulation profiles
 * Time-series generation for solar, wind, load based on:
 * - Time of day (0-24h)
 * - Day of week (0=Mon, 6=Sun)
 * - Season ('summer' | 'winter')
 */

export type Season = 'summer' | 'winter';

// ─── Weather profiles ─────────────────────────────────────────────────────────

/** Solar irradiance W/m² at given hour (0-24) and season */
export function solarIrradiance(hour: number, season: Season, cloudCover: number): number {
  const rise   = season === 'summer' ? 6   : 8;
  const set    = season === 'summer' ? 20  : 17;
  const peak   = season === 'summer' ? 950 : 420;

  if (hour < rise || hour > set) return 0;
  const t = (hour - rise) / (set - rise);              // 0→1 across daylight
  const base = Math.sin(t * Math.PI) * peak;
  return Math.max(0, base * (1 - cloudCover * 0.82));
}

/** Wind speed m/s — noisy, seasonally biased */
export function windSpeedProfile(season: Season, prevSpeed: number, rng: () => number): number {
  const base  = season === 'summer' ? 5  : 8;          // winter windier
  const noise = (rng() - 0.5) * 2;                     // ±1 m/s random walk
  const next  = prevSpeed + noise * 0.4 + (base - prevSpeed) * 0.05;
  return Math.max(0, Math.min(18, next));
}

/** Ambient temperature °C */
export function ambientTemp(hour: number, season: Season): number {
  const base  = season === 'summer' ? 28 : 7;
  const swing = season === 'summer' ? 7  : 5;
  // sinusoidal: min at 6h, max at 15h
  return base + swing * Math.sin((hour - 6) / 24 * 2 * Math.PI - Math.PI / 2);
}

/** Cloud cover persistence model — 0..1 */
export function nextCloudCover(prev: number, rng: () => number): number {
  const drift = (rng() - 0.5) * 0.15;
  return Math.max(0, Math.min(1, prev + drift));
}

// ─── Generation profiles ──────────────────────────────────────────────────────

const SOLAR_PANEL_AREA_M2  = 400;   // 80 kWp @ 200 W/m²
const SOLAR_EFFICIENCY      = 0.20;  // 20%
const SOLAR_MAX_KW          = 80;

const WIND_MAX_KW = 40;
/** Wind turbine power curve (simplified): 0 below 3 m/s, rated at 12 m/s */
export function windPowerKW(speed: number): number {
  if (speed < 3)  return 0;
  if (speed > 15) return 0;                            // feathered above 15 m/s
  if (speed < 12) return WIND_MAX_KW * ((speed - 3) / 9) ** 2;
  return WIND_MAX_KW;
}

export function solarPowerKW(irradiance: number): number {
  return Math.min(SOLAR_MAX_KW, irradiance * SOLAR_PANEL_AREA_M2 * SOLAR_EFFICIENCY / 1000);
}

// ─── Load profiles ────────────────────────────────────────────────────────────

const HOSPITAL_BASE_KW = 20;

/**
 * Hospital demand — relatively flat with slight day/night variation
 */
export function hospitalDemandKW(_hour: number, _season: Season): number {
  // Night: slightly lower (fewer staff)
  return HOSPITAL_BASE_KW;
}

/**
 * Residential demand (base 30 kW peak)
 * - Weekday: low at night, moderate day, peak 18-22h
 * - Weekend: moderate all day, later peak
 * - Summer: +20% (AC)   Winter: +35% (heating)
 */
export function residentialDemandKW(
  hour: number,
  season: Season,
  isWeekend: boolean,
): number {
  const seasonFactor = season === 'summer' ? 1.20 : 1.35;

  let base: number;
  if (isWeekend) {
    // Weekend: people home more during day
    if (hour < 7)       base = 0.35;
    else if (hour < 10) base = 0.55;
    else if (hour < 14) base = 0.65;
    else if (hour < 18) base = 0.60;
    else if (hour < 23) base = 0.90;   // evening peak
    else                base = 0.45;
  } else {
    // Weekday: gone during work hours
    if (hour < 6)       base = 0.30;
    else if (hour < 8)  base = 0.55;   // morning rush
    else if (hour < 18) base = 0.40;   // out at work
    else if (hour < 22) base = 0.95;   // evening peak
    else                base = 0.40;
  }

  return 30 * base * seasonFactor;
}

/**
 * Industrial demand (base 50 kW)
 * - Weekday: business hours only
 * - Weekend: skeleton crew (20%)
 */
export function industrialDemandKW(
  hour: number,
  season: Season,
  isWeekend: boolean,
): number {
  const seasonFactor = season === 'summer' ? 1.10 : 1.00;

  if (isWeekend) return 50 * 0.20 * seasonFactor;

  let factor: number;
  if (hour < 6)       factor = 0.10;
  else if (hour < 7)  factor = 0.30;
  else if (hour < 8)  factor = 0.70;
  else if (hour < 12) factor = 1.00;
  else if (hour < 13) factor = 0.80;   // lunch break
  else if (hour < 18) factor = 1.00;
  else if (hour < 20) factor = 0.50;
  else                factor = 0.10;

  return 50 * factor * seasonFactor;
}

/** Spot electricity price €/kWh — typical European profile */
export function spotPriceEurKWh(hour: number, season: Season): number {
  const base = season === 'summer' ? 0.07 : 0.10;
  // Peak pricing 7-10h and 17-21h
  const isPeak = (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 21);
  return isPeak ? base * 1.8 : base;
}

// ─── Diesel CO₂ factor ────────────────────────────────────────────────────────

export const DIESEL_CO2_KG_PER_KWH = 0.65;
export const DIESEL_COST_EUR_PER_KWH = 0.18;
