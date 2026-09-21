/**
 * Microgrid simulation engine
 * Maintains state, advances time, runs priority-dispatch optimization
 */

import {
  solarIrradiance, windSpeedProfile, windPowerKW, solarPowerKW,
  ambientTemp, nextCloudCover, spotPriceEurKWh,
  hospitalDemandKW, residentialDemandKW, industrialDemandKW,
  DIESEL_CO2_KG_PER_KWH, DIESEL_COST_EUR_PER_KWH,
  type Season,
} from './profiles';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComponentStatus = 'online' | 'fault' | 'offline';
export type LoadStatus = 'normal' | 'shed';

export interface WeatherState {
  solarIrradianceWm2: number;
  windSpeedMs: number;
  temperatureC: number;
  cloudCover: number;          // 0-1
  season: Season;
}

export interface PowerFlow {
  id: string;
  fromX: number; fromY: number;
  toX: number;   toY: number;
  powerKW: number;             // always positive
  direction: 'forward' | 'reverse' | 'idle';
  type: 'solar' | 'wind' | 'battery' | 'diesel' | 'grid' | 'load';
}

export interface MicrogridState {
  // ── Simulated time ──────────────────────────────────────────────────────────
  simulatedDate: string;       // ISO string
  tickIndex: number;           // increments every 15 simulated minutes
  speedMultiplier: number;     // 1x | 6x | 24x | 96x

  // ── Weather ─────────────────────────────────────────────────────────────────
  weather: WeatherState;

  // ── Components ──────────────────────────────────────────────────────────────
  solar: {
    powerKW: number;
    maxKW: 80;
    status: ComponentStatus;
    faultReason?: string;
  };
  wind: {
    powerKW: number;
    maxKW: 40;
    status: ComponentStatus;
    faultReason?: string;
  };
  battery: {
    powerKW: number;           // > 0 = discharging, < 0 = charging
    socPct: number;            // 0-100
    capacityKWh: 200;
    maxKW: 80;
    status: ComponentStatus;
    faultReason?: string;
  };
  diesel: {
    powerKW: number;
    maxKW: 60;
    running: boolean;
    status: ComponentStatus;
    faultReason?: string;
    startupCountdown: number;  // ticks remaining until online (0 = ready)
  };
  grid: {
    importKW: number;          // positive = buying from main grid
    exportKW: number;          // positive = selling to main grid
    maxImportKW: 80;
    maxExportKW: 40;
    status: ComponentStatus;
    spotPriceEurKWh: number;
    faultReason?: string;
  };

  // ── Loads ───────────────────────────────────────────────────────────────────
  loads: {
    hospital:    { demandKW: number; status: LoadStatus };
    residential: { demandKW: number; status: LoadStatus };
    industrial:  { demandKW: number; status: LoadStatus };
  };

  // ── Balance ─────────────────────────────────────────────────────────────────
  totalProductionKW: number;
  totalConsumptionKW: number;
  balanceKW: number;           // + surplus / - deficit
  frequencyHz: number;

  // ── Cumulative metrics (reset on demand) ────────────────────────────────────
  cumulativeCostEur: number;
  cumulativeCo2Kg: number;
  cumulativeDieselHours: number;
  cumulativeRenewablePct: number;
  ticksCount: number;

  // ── Optimizer ───────────────────────────────────────────────────────────────
  optimizerLog: string;        // last decision explanation
  activeFaults: string[];      // descriptions of active faults

  // ── Power flows (for animation) ─────────────────────────────────────────────
  flows: PowerFlow[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATTERY_MAX_KWH     = 200;
const BATTERY_MIN_SOC_PCT = 15;   // emergency reserve
const BATTERY_TARGET_SOC  = 50;   // prefer to stay above this
const TICK_DURATION_MIN   = 15;   // 15 simulated minutes per tick

// ─── Summer starts June 1, Winter December 1 ─────────────────────────────────
const SUMMER_START = new Date('2025-06-01T00:00:00');
const WINTER_START = new Date('2025-12-01T00:00:00');

// ─── Seeded RNG (simple LCG) ─────────────────────────────────────────────────
let rngSeed = 42;
function rng(): number {
  rngSeed = (rngSeed * 1664525 + 1013904223) & 0x7fffffff;
  return rngSeed / 0x7fffffff;
}

// ─── State singleton ─────────────────────────────────────────────────────────

function makeInitialState(): MicrogridState {
  return {
    simulatedDate: SUMMER_START.toISOString(),
    tickIndex: 0,
    speedMultiplier: 1,

    weather: {
      solarIrradianceWm2: 0,
      windSpeedMs: 6,
      temperatureC: 22,
      cloudCover: 0.2,
      season: 'summer',
    },

    solar:   { powerKW: 0,  maxKW: 80, status: 'online' },
    wind:    { powerKW: 0,  maxKW: 40, status: 'online' },
    battery: { powerKW: 0,  socPct: 70, capacityKWh: 200, maxKW: 80, status: 'online', startupCountdown: 0 } as MicrogridState['battery'],
    diesel:  { powerKW: 0,  maxKW: 60, running: false, status: 'online', startupCountdown: 0 } as MicrogridState['diesel'],
    grid:    { importKW: 0, exportKW: 0, maxImportKW: 80, maxExportKW: 40, status: 'online', spotPriceEurKWh: 0.08 } as MicrogridState['grid'],

    loads: {
      hospital:    { demandKW: 20, status: 'normal' },
      residential: { demandKW: 25, status: 'normal' },
      industrial:  { demandKW: 50, status: 'normal' },
    },

    totalProductionKW: 0,
    totalConsumptionKW: 0,
    balanceKW: 0,
    frequencyHz: 50.0,

    cumulativeCostEur: 0,
    cumulativeCo2Kg: 0,
    cumulativeDieselHours: 0,
    cumulativeRenewablePct: 0,
    ticksCount: 0,

    optimizerLog: 'Système initialisé.',
    activeFaults: [],

    flows: [],
  };
}

let state: MicrogridState = makeInitialState();

// ─── Public API ───────────────────────────────────────────────────────────────

export function getState(): MicrogridState { return state; }

export function resetSimulation(): void {
  rngSeed = 42;
  state = makeInitialState();
  advanceWeather();
  computeLoads();
  runOptimizer();
  computeFlows();
}

/** Inject a fault into a component */
export function injectFault(target: string, severity: 'partial' | 'total'): string {
  const faultPct = severity === 'total' ? 1.0 : 0.5 + rng() * 0.3;
  let message = '';

  switch (target) {
    case 'solar':
      state.solar.status = 'fault';
      state.solar.faultReason = severity === 'total'
        ? 'Onduleurs hors ligne — déconnexion totale'
        : `Dégradation ${Math.round(faultPct * 100)}% — court-circuit partiel`;
      state.activeFaults.push(`☀️ Panne solaire (${severity})`);
      message = `Panne solaire ${severity} injectée`;
      break;

    case 'wind':
      state.wind.status = 'fault';
      state.wind.faultReason = 'Survitesse — mise en drapeau automatique';
      state.activeFaults.push(`💨 Panne éolienne (${severity})`);
      message = 'Panne éolienne injectée';
      break;

    case 'battery':
      state.battery.status = 'fault';
      state.battery.faultReason = 'BMS — cellules déséquilibrées, charge/décharge bloquée';
      state.activeFaults.push(`🔋 Défaillance batterie`);
      message = 'Défaillance batterie injectée';
      break;

    case 'grid':
      state.grid.status = 'fault';
      state.grid.faultReason = 'Câble sous-marin — rupture détectée';
      state.activeFaults.push(`🔌 Perte réseau national`);
      message = 'Perte réseau injectée — passage en mode îloté';
      break;

    case 'industrial_surge':
      state.activeFaults.push(`🏭 Pic industriel soudain +30 kW`);
      // Temporary demand surge — handled in next optimizer tick
      state.loads.industrial.demandKW = Math.min(80, state.loads.industrial.demandKW + 30);
      message = 'Pic industriel +30 kW injecté';
      break;

    case 'diesel':
      state.diesel.status = 'fault';
      state.diesel.running = false;
      state.diesel.powerKW = 0;
      state.diesel.faultReason = 'Panne moteur — arrêt d\'urgence';
      state.activeFaults.push(`⛽ Panne groupe électrogène`);
      message = 'Panne diesel injectée';
      break;
  }

  runOptimizer();
  computeFlows();
  return message;
}

/** Clear all faults and restore normal operation */
export function clearFaults(): void {
  state.solar.status   = 'online'; delete state.solar.faultReason;
  state.wind.status    = 'online'; delete state.wind.faultReason;
  state.battery.status = 'online'; delete state.battery.faultReason;
  state.grid.status    = 'online'; delete state.grid.faultReason;
  state.diesel.status  = 'online'; delete state.diesel.faultReason;
  state.activeFaults   = [];
  // Restore loads
  state.loads.hospital.status    = 'normal';
  state.loads.residential.status = 'normal';
  state.loads.industrial.status  = 'normal';
  runOptimizer();
  computeFlows();
}

/** Advance the simulation by one tick (15 simulated minutes) */
export function tick(): MicrogridState {
  const dt = new Date(state.simulatedDate);
  dt.setMinutes(dt.getMinutes() + TICK_DURATION_MIN);
  state.simulatedDate = dt.toISOString();
  state.tickIndex++;
  state.ticksCount++;

  // Determine season
  const month = dt.getMonth(); // 0=Jan
  state.weather.season = (month >= 5 && month <= 9) ? 'summer' : 'winter';

  advanceWeather();
  computeLoads();
  if (state.diesel.startupCountdown > 0) state.diesel.startupCountdown--;
  runOptimizer();
  updateCumulativeMetrics();
  computeFlows();

  return state;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function advanceWeather(): void {
  const dt   = new Date(state.simulatedDate);
  const hour = dt.getHours() + dt.getMinutes() / 60;
  const s    = state.weather.season;

  state.weather.cloudCover         = nextCloudCover(state.weather.cloudCover, rng);
  state.weather.windSpeedMs        = windSpeedProfile(s, state.weather.windSpeedMs, rng);
  state.weather.solarIrradianceWm2 = solarIrradiance(hour, s, state.weather.cloudCover);
  state.weather.temperatureC       = ambientTemp(hour, s);

  const hour24 = dt.getHours();
  state.grid.spotPriceEurKWh = spotPriceEurKWh(hour24, s);
}

function computeLoads(): void {
  const dt        = new Date(state.simulatedDate);
  const hour      = dt.getHours() + dt.getMinutes() / 60;
  const dow       = dt.getDay();                              // 0=Sun, 6=Sat
  const isWeekend = (dow === 0 || dow === 6);
  const s         = state.weather.season;

  if (state.loads.hospital.status === 'normal')
    state.loads.hospital.demandKW    = hospitalDemandKW(hour, s);
  if (state.loads.residential.status === 'normal')
    state.loads.residential.demandKW = residentialDemandKW(hour, s, isWeekend);
  // Industrial: only override if not in surge / not shed
  if (state.loads.industrial.status === 'normal')
    state.loads.industrial.demandKW  = industrialDemandKW(hour, s, isWeekend);
}

/**
 * Priority-dispatch optimizer:
 * 1. Renewable first (solar + wind)
 * 2. Discharge battery if deficit (SoC > MIN)
 * 3. Import grid if cheap + battery low
 * 4. Start diesel if last resort
 * 5. Charge battery from surplus renewables
 * 6. Export to grid if battery full
 * 7. Shed loads if nothing works
 */
function runOptimizer(): void {
  const w = state.weather;
  const logs: string[] = [];

  // ── Generation ─────────────────────────────────────────────────────────────
  state.solar.powerKW = state.solar.status === 'online'
    ? solarPowerKW(w.solarIrradianceWm2)
    : state.solar.status === 'fault'
      ? solarPowerKW(w.solarIrradianceWm2) * 0.35   // partial remaining
      : 0;

  state.wind.powerKW = state.wind.status === 'online'
    ? windPowerKW(w.windSpeedMs)
    : 0;

  const renewableKW = state.solar.powerKW + state.wind.powerKW;

  // ── Active demand ──────────────────────────────────────────────────────────
  const demand = state.loads.hospital.demandKW
    + (state.loads.residential.status !== 'shed' ? state.loads.residential.demandKW : 0)
    + (state.loads.industrial.status  !== 'shed' ? state.loads.industrial.demandKW  : 0);

  let gap = demand - renewableKW;    // positive = we need more, negative = surplus

  // ── Reset dispatch variables ───────────────────────────────────────────────
  state.battery.powerKW = 0;
  state.diesel.powerKW  = state.diesel.running ? state.diesel.maxKW * 0.75 : 0;
  state.grid.importKW   = 0;
  state.grid.exportKW   = 0;

  // ── Diesel already running — account for its output ────────────────────────
  if (state.diesel.running && state.diesel.status === 'online' && state.diesel.startupCountdown === 0) {
    gap -= state.diesel.powerKW;
    if (gap < -10) {
      // Diesel over-producing — reduce to minimum
      state.diesel.powerKW = Math.max(15, state.diesel.powerKW + gap);
      gap = 0;
    }
  }

  if (gap > 0) {
    // ── We have a deficit ───────────────────────────────────────────────────

    // 1. Discharge battery
    if (state.battery.status === 'online' && state.battery.socPct > BATTERY_MIN_SOC_PCT) {
      const available = Math.min(state.battery.maxKW, gap,
        (state.battery.socPct - BATTERY_MIN_SOC_PCT) / 100 * BATTERY_MAX_KWH / (TICK_DURATION_MIN / 60));
      state.battery.powerKW = available;             // positive = discharging
      gap -= available;
      if (available > 1) logs.push(`🔋 Batterie décharge ${available.toFixed(0)} kW`);
    }

    // 2. Import from grid
    if (gap > 0 && state.grid.status === 'online') {
      const importKW = Math.min(state.grid.maxImportKW, gap);
      state.grid.importKW = importKW;
      gap -= importKW;
      logs.push(`🔌 Import réseau ${importKW.toFixed(0)} kW @ ${state.grid.spotPriceEurKWh.toFixed(3)} €/kWh`);
    }

    // 3. Start diesel if still a deficit and diesel available
    if (gap > 2 && state.diesel.status === 'online' && !state.diesel.running) {
      state.diesel.running = true;
      state.diesel.startupCountdown = 2;             // 2 ticks = 30 min startup
      logs.push(`⛽ Diesel démarré — en ligne dans 30min`);
    }

    // 4. Diesel contributing
    if (gap > 0 && state.diesel.running && state.diesel.status === 'online' && state.diesel.startupCountdown === 0) {
      const dieselContrib = Math.min(state.diesel.maxKW, gap);
      state.diesel.powerKW = dieselContrib;
      gap -= dieselContrib;
      if (dieselContrib > 0) logs.push(`⛽ Diesel fournit ${dieselContrib.toFixed(0)} kW`);
    }

    // 5. Emergency load shedding
    if (gap > 2) {
      if (state.loads.industrial.status === 'normal') {
        state.loads.industrial.status = 'shed';
        gap -= state.loads.industrial.demandKW;
        logs.push(`⚠️ Délestage industrie ${state.loads.industrial.demandKW.toFixed(0)} kW`);
      }
    }
    if (gap > 2) {
      if (state.loads.residential.status === 'normal') {
        state.loads.residential.status = 'shed';
        gap -= state.loads.residential.demandKW;
        logs.push(`🔴 Délestage résidentiel ${state.loads.residential.demandKW.toFixed(0)} kW`);
      }
    }

  } else {
    // ── We have a surplus ───────────────────────────────────────────────────
    let surplus = -gap;

    // Restore loads if shed and we have surplus
    if (state.loads.industrial.status === 'shed' && surplus > state.loads.industrial.demandKW + 5) {
      state.loads.industrial.status = 'normal';
      surplus -= state.loads.industrial.demandKW;
      logs.push(`✅ Industrie réalimentée`);
    }
    if (state.loads.residential.status === 'shed' && surplus > state.loads.residential.demandKW + 5) {
      state.loads.residential.status = 'normal';
      surplus -= state.loads.residential.demandKW;
      logs.push(`✅ Résidentiel réalimenté`);
    }

    // Charge battery
    if (state.battery.status === 'online' && state.battery.socPct < 98) {
      const maxCharge = Math.min(state.battery.maxKW, surplus,
        (98 - state.battery.socPct) / 100 * BATTERY_MAX_KWH / (TICK_DURATION_MIN / 60));
      state.battery.powerKW = -maxCharge;            // negative = charging
      surplus -= maxCharge;
      if (maxCharge > 1) logs.push(`🔋 Batterie charge ${maxCharge.toFixed(0)} kW`);
    }

    // Stop diesel if surplus large enough
    if (state.diesel.running && state.battery.socPct > 40 && surplus > 10) {
      state.diesel.running  = false;
      state.diesel.powerKW  = 0;
      logs.push(`⛽ Diesel arrêté — surplus suffisant`);
    }

    // Export to grid if battery ok
    if (surplus > 2 && state.grid.status === 'online' && state.battery.socPct > BATTERY_TARGET_SOC) {
      const exportKW = Math.min(state.grid.maxExportKW, surplus);
      state.grid.exportKW = exportKW;
      surplus -= exportKW;
      if (exportKW > 0) logs.push(`🔌 Export réseau ${exportKW.toFixed(0)} kW`);
    }
  }

  // ── Update battery SoC ──────────────────────────────────────────────────────
  if (state.battery.status === 'online') {
    const deltaKWh = -state.battery.powerKW * (TICK_DURATION_MIN / 60);  // + = charging
    state.battery.socPct = Math.max(0, Math.min(100,
      state.battery.socPct + (deltaKWh / BATTERY_MAX_KWH) * 100));
  }

  // ── Balance totals ──────────────────────────────────────────────────────────
  const activeDemand = state.loads.hospital.demandKW
    + (state.loads.residential.status !== 'shed' ? state.loads.residential.demandKW : 0)
    + (state.loads.industrial.status  !== 'shed' ? state.loads.industrial.demandKW  : 0);

  state.totalProductionKW   = state.solar.powerKW + state.wind.powerKW
    + (state.diesel.powerKW ?? 0) + state.grid.importKW
    + Math.max(0, state.battery.powerKW);              // discharging counts as production
  state.totalConsumptionKW  = activeDemand + state.grid.exportKW
    + Math.max(0, -state.battery.powerKW);             // charging counts as consumption
  state.balanceKW           = state.totalProductionKW - state.totalConsumptionKW;
  state.frequencyHz         = 50 + (state.balanceKW > 0 ? 0.05 : state.balanceKW < 0 ? -0.08 : 0);

  state.optimizerLog = logs.length > 0 ? logs.join(' | ') : '✅ Opération normale';
}

function updateCumulativeMetrics(): void {
  const h = TICK_DURATION_MIN / 60;

  // Cost: grid import cost − grid export revenue
  state.cumulativeCostEur +=
    state.grid.importKW  * h * state.grid.spotPriceEurKWh
    + state.diesel.powerKW * h * DIESEL_COST_EUR_PER_KWH
    - state.grid.exportKW  * h * state.grid.spotPriceEurKWh * 0.5;  // buy-back at 50%

  // CO2: diesel only (renewables = 0)
  state.cumulativeCo2Kg += state.diesel.powerKW * h * DIESEL_CO2_KG_PER_KWH;

  // Diesel hours
  if (state.diesel.running) state.cumulativeDieselHours += h;

  // Renewable share of this tick
  const renewTick = state.solar.powerKW + state.wind.powerKW;
  const totalTick = state.totalProductionKW || 1;
  state.cumulativeRenewablePct =
    (state.cumulativeRenewablePct * (state.ticksCount - 1) + (renewTick / totalTick) * 100)
    / state.ticksCount;
}

/** Build power flow data for SVG animation */
function computeFlows(): void {
  const f: PowerFlow[] = [];

  const push = (
    id: string, fromX: number, fromY: number, toX: number, toY: number,
    powerKW: number, type: PowerFlow['type'], reverse = false,
  ) => {
    if (powerKW > 0.5) {
      f.push({ id, fromX, fromY, toX, toY, powerKW,
        direction: reverse ? 'reverse' : 'forward', type });
    }
  };

  // Solar → Bus
  push('solar-bus', 195, 170, 430, 340, state.solar.powerKW, 'solar');
  // Wind → Bus
  push('wind-bus', 660, 155, 430, 340, state.wind.powerKW, 'wind');
  // Battery ↔ Bus
  if (state.battery.powerKW > 0)
    push('bat-bus', 390, 305, 430, 340, state.battery.powerKW, 'battery');
  else if (state.battery.powerKW < 0)
    push('bus-bat', 430, 340, 390, 305, -state.battery.powerKW, 'battery', true);
  // Diesel → Bus
  push('diesel-bus', 530, 290, 430, 340, state.diesel.powerKW, 'diesel');
  // Grid import/export
  if (state.grid.importKW > 0)
    push('grid-bus', 760, 340, 430, 340, state.grid.importKW, 'grid');
  else if (state.grid.exportKW > 0)
    push('bus-grid', 430, 340, 760, 340, state.grid.exportKW, 'grid', true);
  // Bus → Loads
  if (state.loads.hospital.status !== 'shed')
    push('bus-hosp', 430, 340, 210, 450, state.loads.hospital.demandKW, 'load');
  if (state.loads.residential.status !== 'shed')
    push('bus-res', 430, 340, 420, 490, state.loads.residential.demandKW, 'load');
  if (state.loads.industrial.status !== 'shed')
    push('bus-ind', 430, 340, 620, 445, state.loads.industrial.demandKW, 'load');

  state.flows = f;
}

// ─── Initialize on module load ────────────────────────────────────────────────
advanceWeather();
computeLoads();
runOptimizer();
computeFlows();
