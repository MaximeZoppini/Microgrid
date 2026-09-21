/**
 * Microgrid simulation engine v2
 * - Integrates SCADA/MQTT layer (orders flow HQ → box → asset)
 * - Predictive optimizer: 2-hour look-ahead, dynamic battery target
 * - Autonomous failsafe: assets hold last setpoint when HQ link lost
 * - Diesel strictly last resort (never in autonomous mode)
 */

import {
  solarIrradiance, windSpeedProfile, windPowerKW, solarPowerKW,
  ambientTemp, nextCloudCover, spotPriceEurKWh,
  hospitalDemandKW, residentialDemandKW, industrialDemandKW,
  DIESEL_CO2_KG_PER_KWH, DIESEL_COST_EUR_PER_KWH,
  type Season,
} from './profiles';

import {
  scadaTick, getScadaState, resetScada, type ForecastData, type AssetId,
} from './scada';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComponentStatus = 'online' | 'fault' | 'offline';
export type LoadStatus = 'normal' | 'shed';
export { type ForecastData };

export interface PowerFlow {
  id: string;
  fromX: number; fromY: number;
  toX: number;   toY: number;
  powerKW: number;
  direction: 'forward' | 'reverse' | 'idle';
  type: 'solar' | 'wind' | 'battery' | 'diesel' | 'grid' | 'load' | 'scada';
}

export interface MicrogridState {
  simulatedDate: string;
  tickIndex: number;
  speedMultiplier: number;
  weather: {
    solarIrradianceWm2: number;
    windSpeedMs: number;
    temperatureC: number;
    cloudCover: number;
    season: Season;
  };
  solar:   { powerKW: number; maxKW: 80;  status: ComponentStatus; faultReason?: string };
  wind:    { powerKW: number; maxKW: 40;  status: ComponentStatus; faultReason?: string };
  battery: { powerKW: number; socPct: number; capacityKWh: 200; maxKW: 80; status: ComponentStatus; faultReason?: string; targetSoC: number };
  diesel:  { powerKW: number; maxKW: 60;  running: boolean; status: ComponentStatus; faultReason?: string; startupCountdown: number };
  grid:    { importKW: number; exportKW: number; maxImportKW: 80; maxExportKW: 40; status: ComponentStatus; spotPriceEurKWh: number; faultReason?: string };
  loads: {
    hospital:    { demandKW: number; status: LoadStatus };
    residential: { demandKW: number; status: LoadStatus };
    industrial:  { demandKW: number; status: LoadStatus };
  };
  totalProductionKW: number;
  totalConsumptionKW: number;
  balanceKW: number;
  frequencyHz: number;
  cumulativeCostEur: number;
  cumulativeCo2Kg: number;
  cumulativeDieselHours: number;
  cumulativeRenewablePct: number;
  ticksCount: number;
  optimizerLog: string;
  activeFaults: string[];
  flows: PowerFlow[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATTERY_MAX_KWH       = 200;
const BATTERY_MIN_SOC_PCT   = 15;
const TICK_H                = 15 / 60;          // 15 min in hours
const SUMMER_START          = new Date('2025-06-01T00:00:00');

// ─── Seeded RNG ───────────────────────────────────────────────────────────────

let rngSeed = 42;
function rng(): number {
  rngSeed = (rngSeed * 1664525 + 1013904223) & 0x7fffffff;
  return rngSeed / 0x7fffffff;
}

// ─── State ────────────────────────────────────────────────────────────────────

function makeInitialState(): MicrogridState {
  return {
    simulatedDate: SUMMER_START.toISOString(),
    tickIndex: 0, speedMultiplier: 1,
    weather: { solarIrradianceWm2: 0, windSpeedMs: 6, temperatureC: 22, cloudCover: 0.2, season: 'summer' },
    solar:   { powerKW: 0, maxKW: 80,  status: 'online' },
    wind:    { powerKW: 0, maxKW: 40,  status: 'online' },
    battery: { powerKW: 0, socPct: 70, capacityKWh: 200, maxKW: 80, status: 'online', targetSoC: 50 } as MicrogridState['battery'],
    diesel:  { powerKW: 0, maxKW: 60,  running: false, status: 'online', startupCountdown: 0 } as MicrogridState['diesel'],
    grid:    { importKW: 0, exportKW: 0, maxImportKW: 80, maxExportKW: 40, status: 'online', spotPriceEurKWh: 0.08 } as MicrogridState['grid'],
    loads:   { hospital: { demandKW: 20, status: 'normal' }, residential: { demandKW: 25, status: 'normal' }, industrial: { demandKW: 50, status: 'normal' } },
    totalProductionKW: 0, totalConsumptionKW: 0, balanceKW: 0, frequencyHz: 50,
    cumulativeCostEur: 0, cumulativeCo2Kg: 0, cumulativeDieselHours: 0, cumulativeRenewablePct: 0, ticksCount: 0,
    optimizerLog: 'Système initialisé.', activeFaults: [], flows: [],
  };
}

let state: MicrogridState = makeInitialState();

// ─── Public API ───────────────────────────────────────────────────────────────

export function getState(): MicrogridState & { scada: ReturnType<typeof getScadaState> } {
  return { ...state, scada: getScadaState() };
}

export function resetSimulation(): void {
  rngSeed = 42;
  state = makeInitialState();
  resetScada();
  _advanceWeather();
  _computeLoads();
  const forecast = _computeForecast();
  _runOptimizer(forecast);
  _computeFlows();
}

export function injectFault(target: string, severity: 'partial' | 'total'): string {
  let message = '';
  switch (target) {
    case 'solar':
      state.solar.status = 'fault';
      state.solar.faultReason = severity === 'total' ? 'Onduleurs hors ligne' : 'Court-circuit partiel (−65%)';
      state.activeFaults.push(`☀️ Panne solaire (${severity})`);
      message = `Panne solaire ${severity} injectée`;
      break;
    case 'wind':
      state.wind.status = 'fault';
      state.wind.faultReason = 'Survitesse — mise en drapeau';
      state.activeFaults.push(`💨 Panne éolienne`);
      message = 'Panne éolienne injectée';
      break;
    case 'battery':
      state.battery.status = 'fault';
      state.battery.faultReason = 'BMS défaillant — charge/décharge bloquée';
      state.activeFaults.push(`🔋 Défaillance batterie`);
      message = 'Défaillance batterie injectée';
      break;
    case 'grid':
      state.grid.status = 'fault';
      state.grid.faultReason = 'Câble sous-marin — rupture';
      state.activeFaults.push(`🔌 Perte réseau national`);
      message = 'Perte réseau — mode îloté';
      break;
    case 'industrial_surge':
      state.activeFaults.push(`🏭 Pic industriel +30 kW`);
      state.loads.industrial.demandKW = Math.min(80, state.loads.industrial.demandKW + 30);
      message = 'Pic industriel +30 kW';
      break;
    case 'diesel':
      state.diesel.status = 'fault';
      state.diesel.running = false;
      state.diesel.powerKW = 0;
      state.diesel.faultReason = 'Panne moteur — arrêt d\'urgence';
      state.activeFaults.push(`⛽ Panne diesel`);
      message = 'Panne diesel injectée';
      break;
    case 'scada':
      // Handled by scada module directly
      message = 'Coupure SCADA injectée';
      break;
  }
  const forecast = _computeForecast();
  _runOptimizer(forecast);
  _computeFlows();
  return message;
}

export function clearFaults(): void {
  state.solar.status = 'online';   delete state.solar.faultReason;
  state.wind.status  = 'online';   delete state.wind.faultReason;
  state.battery.status = 'online'; delete state.battery.faultReason;
  state.grid.status  = 'online';   delete state.grid.faultReason;
  state.diesel.status = 'online';  delete state.diesel.faultReason;
  state.activeFaults = [];
  state.loads.hospital.status    = 'normal';
  state.loads.residential.status = 'normal';
  state.loads.industrial.status  = 'normal';
  const forecast = _computeForecast();
  _runOptimizer(forecast);
  _computeFlows();
}

export function tick(): ReturnType<typeof getState> {
  const dt = new Date(state.simulatedDate);
  dt.setMinutes(dt.getMinutes() + 15);
  state.simulatedDate = dt.toISOString();
  state.tickIndex++;
  state.ticksCount++;

  const month = dt.getMonth();
  state.weather.season = (month >= 5 && month <= 9) ? 'summer' : 'winter';

  _advanceWeather();
  _computeLoads();
  if (state.diesel.startupCountdown > 0) state.diesel.startupCountdown--;

  const forecast = _computeForecast();
  _runOptimizer(forecast);
  _updateCumulativeMetrics();
  _computeFlows();

  return getState();
}

// ─── Predictive forecast ──────────────────────────────────────────────────────

function _computeForecast(): ForecastData {
  const dt      = new Date(state.simulatedDate);
  const hour    = dt.getHours() + dt.getMinutes() / 60;
  const s       = state.weather.season;
  const dow     = dt.getDay();
  const isWE    = dow === 0 || dow === 6;
  const HORIZON = 8; // ticks (2 hours at 15 min/tick)

  let surplusKWh = 0;
  let deficitKWh = 0;
  let sumRenew   = 0;
  let sumDemand  = 0;

  for (let i = 1; i <= HORIZON; i++) {
    const fHour = (hour + i * 0.25) % 24;
    const fIrr  = solarIrradiance(fHour, s, state.weather.cloudCover);
    const fGen  = solarPowerKW(fIrr) + windPowerKW(state.weather.windSpeedMs * 0.95);
    const fDem  = hospitalDemandKW(fHour, s)
      + residentialDemandKW(fHour, s, isWE)
      + industrialDemandKW(fHour, s, isWE);
    const balance = fGen - fDem;
    if (balance > 0) surplusKWh += balance * 0.25;
    else             deficitKWh += (-balance) * 0.25;
    sumRenew  += fGen;
    sumDemand += fDem;
  }

  const avgRenew  = sumRenew  / HORIZON;
  const avgDemand = sumDemand / HORIZON;

  // Dynamic battery target
  const tempNext2h       = ambientTemp(hour + 2, s);
  const coldPeriod       = tempNext2h < 8;                          // heating demand spike
  const eveningPeak      = hour >= 16 && hour < 19;                 // dinner peak
  const deepNight        = hour >= 0 && hour < 5;                   // low renewable window
  const solarMorning     = hour >= 5 && hour < 8;                   // pre-dawn, charge before day
  const bigDeficitAhead  = deficitKWh > 25;
  const bigSurplusAhead  = surplusKWh > 30;

  let targetSoC = 50;
  if (coldPeriod)       targetSoC = 80;    // pre-charge for heating
  if (eveningPeak)      targetSoC = 72;    // pre-charge before peak
  if (deepNight)        targetSoC = 40;    // let battery rest at night
  if (solarMorning)     targetSoC = 35;    // leave room to absorb morning solar
  if (bigDeficitAhead)  targetSoC = 75;    // anticipated shortfall
  if (bigSurplusAhead)  targetSoC = 40;    // will charge from renewable soon

  const rationaleItems: string[] = [];
  if (coldPeriod)       rationaleItems.push('période froide anticipée (précharge batterie 80%)');
  if (eveningPeak)      rationaleItems.push('pic soirée dans < 2h (précharge 72%)');
  if (bigDeficitAhead)  rationaleItems.push(`déficit prévu ${deficitKWh.toFixed(0)} kWh/2h`);
  if (bigSurplusAhead)  rationaleItems.push(`surplus prévu ${surplusKWh.toFixed(0)} kWh/2h (absorption)`);
  if (!rationaleItems.length) rationaleItems.push('équilibre stable prévu');

  return {
    horizonH: 2,
    forecastSurplusKWh: surplusKWh,
    forecastDeficitKWh: deficitKWh,
    batteryTargetSoC: targetSoC,
    coldPeriodExpected: coldPeriod,
    eveningPeakExpected: eveningPeak,
    forecastRenewableKW: avgRenew,
    forecastDemandKW: avgDemand,
    rationale: rationaleItems.join(' | '),
  };
}

// ─── Predictive optimizer ─────────────────────────────────────────────────────

function _runOptimizer(forecast: ForecastData): void {
  const scada = getScadaState();
  const isAutonomous = scada.mode === 'autonomous';
  const w = state.weather;
  const logs: string[] = [];
  const orders: Array<{ asset: AssetId; type: import('./scada').OrderType; value?: number; label: string }> = [];

  // ── 1. Generation ──────────────────────────────────────────────────────────
  state.solar.powerKW = state.solar.status === 'online'
    ? solarPowerKW(w.solarIrradianceWm2)
    : state.solar.status === 'fault' ? solarPowerKW(w.solarIrradianceWm2) * 0.35 : 0;

  state.wind.powerKW = state.wind.status === 'online'
    ? windPowerKW(w.windSpeedMs) : 0;

  const renewableKW = state.solar.powerKW + state.wind.powerKW;

  // In autonomous mode: no new orders, just maintain physics
  if (isAutonomous) {
    logs.push('⚠️ MODE AUTONOME — maintien des derniers setpoints');
    // Still apply physics but no dispatch changes
    _applyPhysics(renewableKW, logs);
    state.optimizerLog = logs.join(' | ');
    _sendScadaOrders(orders, forecast);
    return;
  }

  // ── 2. Dynamic battery target from forecast ────────────────────────────────
  state.battery.targetSoC = forecast.batteryTargetSoC;

  // ── 3. Demand ──────────────────────────────────────────────────────────────
  const demand = state.loads.hospital.demandKW
    + (state.loads.residential.status !== 'shed' ? state.loads.residential.demandKW : 0)
    + (state.loads.industrial.status  !== 'shed' ? state.loads.industrial.demandKW  : 0);

  let gap = demand - renewableKW;

  // Reset dispatch
  state.battery.powerKW = 0;
  state.diesel.powerKW  = state.diesel.running ? state.diesel.maxKW * 0.75 : 0;
  state.grid.importKW   = 0;
  state.grid.exportKW   = 0;

  if (state.diesel.running && state.diesel.status === 'online' && state.diesel.startupCountdown === 0) {
    gap -= state.diesel.powerKW;
    orders.push({ asset: 'diesel', type: 'setpoint', value: state.diesel.powerKW, label: `Diesel maintenu ${state.diesel.powerKW.toFixed(0)} kW` });
  }

  if (gap > 0) {
    // ── Deficit resolution hierarchy ────────────────────────────────────────

    // 1. Battery discharge (down to MIN or target, whichever is lower)
    const batMinForDispatch = Math.min(BATTERY_MIN_SOC_PCT, state.battery.targetSoC - 10);
    if (state.battery.status === 'online' && state.battery.socPct > batMinForDispatch) {
      const available = Math.min(state.battery.maxKW, gap,
        (state.battery.socPct - batMinForDispatch) / 100 * BATTERY_MAX_KWH / TICK_H);
      state.battery.powerKW = available;
      gap -= available;
      if (available > 1) {
        logs.push(`🔋 Batterie décharge ${available.toFixed(0)} kW (SoC ${state.battery.socPct.toFixed(0)}%)`);
        orders.push({ asset: 'battery', type: 'setpoint', value: available, label: `Décharge ${available.toFixed(0)} kW` });
      }
    }

    // 2. Grid import (if price reasonable)
    if (gap > 0 && state.grid.status === 'online') {
      const price = state.grid.spotPriceEurKWh;
      const maxImport = price > 0.15 ? state.grid.maxImportKW * 0.6 : state.grid.maxImportKW; // throttle if expensive
      const importKW = Math.min(maxImport, gap);
      state.grid.importKW = importKW;
      gap -= importKW;
      logs.push(`🔌 Import réseau ${importKW.toFixed(0)} kW @ ${(price * 100).toFixed(1)}c€/kWh`);
      orders.push({ asset: 'grid', type: 'setpoint', value: importKW, label: `Import ${importKW.toFixed(0)} kW` });
    }

    // 3. Diesel — LAST RESORT, never in autonomous mode
    if (gap > 3 && state.diesel.status === 'online' && !state.diesel.running) {
      state.diesel.running = true;
      state.diesel.startupCountdown = 2;
      logs.push(`⛽ Diesel démarré (dernier recours — déficit résiduel ${gap.toFixed(0)} kW)`);
      orders.push({ asset: 'diesel', type: 'enable', label: 'Démarrage diesel (dernier recours)' });
    }
    if (gap > 0 && state.diesel.running && state.diesel.startupCountdown === 0) {
      const dc = Math.min(state.diesel.maxKW, gap);
      state.diesel.powerKW = dc;
      gap -= dc;
      orders.push({ asset: 'diesel', type: 'setpoint', value: dc, label: `Diesel ${dc.toFixed(0)} kW` });
    }

    // 4. Emergency load shedding
    if (gap > 3) {
      if (state.loads.industrial.status === 'normal') {
        state.loads.industrial.status = 'shed';
        gap -= state.loads.industrial.demandKW;
        logs.push(`⚠️ Délestage industrie ${state.loads.industrial.demandKW.toFixed(0)} kW`);
        orders.push({ asset: 'industrial', type: 'shed', label: `Délestage charge ${state.loads.industrial.demandKW.toFixed(0)} kW` });
      }
    }
    if (gap > 3) {
      if (state.loads.residential.status === 'normal') {
        state.loads.residential.status = 'shed';
        gap -= state.loads.residential.demandKW;
        logs.push(`🔴 Délestage résidentiel`);
        orders.push({ asset: 'residential', type: 'shed', label: 'Délestage résidentiel' });
      }
    }

  } else {
    // ── Surplus resolution ─────────────────────────────────────────────────
    let surplus = -gap;

    // Restore loads
    if (state.loads.industrial.status === 'shed' && surplus > state.loads.industrial.demandKW + 5) {
      state.loads.industrial.status = 'normal';
      surplus -= state.loads.industrial.demandKW;
      logs.push(`✅ Industrie réalimentée`);
      orders.push({ asset: 'industrial', type: 'restore', label: 'Réalimentation charge industrielle' });
    }
    if (state.loads.residential.status === 'shed' && surplus > state.loads.residential.demandKW + 5) {
      state.loads.residential.status = 'normal';
      surplus -= state.loads.residential.demandKW;
      orders.push({ asset: 'residential', type: 'restore', label: 'Réalimentation résidentielle' });
    }

    // Charge battery toward target SoC (predictive)
    if (state.battery.status === 'online' && state.battery.socPct < forecast.batteryTargetSoC + 5) {
      const maxCharge = Math.min(state.battery.maxKW, surplus,
        (forecast.batteryTargetSoC + 5 - state.battery.socPct) / 100 * BATTERY_MAX_KWH / TICK_H);
      if (maxCharge > 1) {
        state.battery.powerKW = -maxCharge;
        surplus -= maxCharge;
        const reason = forecast.coldPeriodExpected ? '(précharge période froide)' :
                       forecast.eveningPeakExpected ? '(précharge pic soirée)' : '';
        logs.push(`🔋 Charge batterie ${maxCharge.toFixed(0)} kW → cible ${forecast.batteryTargetSoC}% ${reason}`);
        orders.push({ asset: 'battery', type: 'setpoint', value: -maxCharge, label: `Charge ${maxCharge.toFixed(0)} kW vers ${forecast.batteryTargetSoC}% SoC` });
      }
    }

    // Stop diesel if comfortable
    if (state.diesel.running && state.battery.socPct > 40 && surplus > 8) {
      state.diesel.running = false;
      state.diesel.powerKW = 0;
      logs.push(`⛽ Diesel arrêté — surplus renouvelable suffisant`);
      orders.push({ asset: 'diesel', type: 'disable', label: 'Arrêt diesel — renouvelable suffisant' });
    }

    // Export to grid if battery at/above target
    if (surplus > 2 && state.grid.status === 'online' && state.battery.socPct >= forecast.batteryTargetSoC) {
      const exportKW = Math.min(state.grid.maxExportKW, surplus);
      state.grid.exportKW = exportKW;
      surplus -= exportKW;
      if (exportKW > 0) {
        logs.push(`🔌 Export réseau ${exportKW.toFixed(0)} kW @ ${(state.grid.spotPriceEurKWh * 0.5 * 100).toFixed(1)}c€/kWh`);
        orders.push({ asset: 'grid', type: 'setpoint', value: -exportKW, label: `Export ${exportKW.toFixed(0)} kW` });
      }
    }
  }

  // ── Update battery SoC ────────────────────────────────────────────────────
  if (state.battery.status === 'online') {
    const deltaKWh = -state.battery.powerKW * TICK_H;
    state.battery.socPct = Math.max(0, Math.min(100,
      state.battery.socPct + (deltaKWh / BATTERY_MAX_KWH) * 100));
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const activeDemand = state.loads.hospital.demandKW
    + (state.loads.residential.status !== 'shed' ? state.loads.residential.demandKW : 0)
    + (state.loads.industrial.status  !== 'shed' ? state.loads.industrial.demandKW  : 0);

  state.totalProductionKW  = state.solar.powerKW + state.wind.powerKW
    + (state.diesel.powerKW ?? 0) + state.grid.importKW + Math.max(0, state.battery.powerKW);
  state.totalConsumptionKW = activeDemand + state.grid.exportKW + Math.max(0, -state.battery.powerKW);
  state.balanceKW          = state.totalProductionKW - state.totalConsumptionKW;
  state.frequencyHz        = 50 + (state.balanceKW > 0 ? 0.05 : state.balanceKW < 0 ? -0.08 : 0);
  state.optimizerLog       = logs.length ? logs.join(' | ') : '✅ Opération normale';

  _sendScadaOrders(orders, forecast);
}

/** Apply physics without dispatch changes (autonomous mode) */
function _applyPhysics(renewableKW: number, logs: string[]) {
  const demand = state.loads.hospital.demandKW + state.loads.residential.demandKW + state.loads.industrial.demandKW;
  const gap    = demand - renewableKW - (state.diesel.running ? state.diesel.powerKW : 0)
    - state.grid.importKW + Math.max(0, state.battery.powerKW);

  // Just update battery SoC from last commanded power
  if (state.battery.status === 'online') {
    const deltaKWh = -state.battery.powerKW * TICK_H;
    state.battery.socPct = Math.max(0, Math.min(100,
      state.battery.socPct + (deltaKWh / BATTERY_MAX_KWH) * 100));
  }

  state.totalProductionKW  = renewableKW + (state.diesel.powerKW ?? 0) + state.grid.importKW + Math.max(0, state.battery.powerKW);
  state.totalConsumptionKW = demand + state.grid.exportKW + Math.max(0, -state.battery.powerKW);
  state.balanceKW          = state.totalProductionKW - state.totalConsumptionKW;
  state.frequencyHz        = 50 + (state.balanceKW > 0 ? 0.05 : state.balanceKW < 0 ? -0.08 : 0);
  state.optimizerLog       = logs.join(' | ');
}

function _sendScadaOrders(
  orders: Array<{ asset: AssetId; type: import('./scada').OrderType; value?: number; label: string }>,
  forecast: ForecastData,
) {
  scadaTick(state.tickIndex, orders, forecast);
}

function _advanceWeather(): void {
  const dt   = new Date(state.simulatedDate);
  const hour = dt.getHours() + dt.getMinutes() / 60;
  const s    = state.weather.season;
  state.weather.cloudCover         = nextCloudCover(state.weather.cloudCover, rng);
  state.weather.windSpeedMs        = windSpeedProfile(s, state.weather.windSpeedMs, rng);
  state.weather.solarIrradianceWm2 = solarIrradiance(hour, s, state.weather.cloudCover);
  state.weather.temperatureC       = ambientTemp(hour, s);
  state.grid.spotPriceEurKWh       = spotPriceEurKWh(dt.getHours(), s);
}

function _computeLoads(): void {
  const dt   = new Date(state.simulatedDate);
  const hour = dt.getHours() + dt.getMinutes() / 60;
  const dow  = dt.getDay();
  const isWE = dow === 0 || dow === 6;
  const s    = state.weather.season;
  if (state.loads.hospital.status    === 'normal') state.loads.hospital.demandKW    = hospitalDemandKW(hour, s);
  if (state.loads.residential.status === 'normal') state.loads.residential.demandKW = residentialDemandKW(hour, s, isWE);
  if (state.loads.industrial.status  === 'normal') state.loads.industrial.demandKW  = industrialDemandKW(hour, s, isWE);
}

function _updateCumulativeMetrics(): void {
  const h = TICK_H;
  state.cumulativeCostEur +=
    state.grid.importKW  * h * state.grid.spotPriceEurKWh
    + state.diesel.powerKW * h * DIESEL_COST_EUR_PER_KWH
    - state.grid.exportKW  * h * state.grid.spotPriceEurKWh * 0.5;
  state.cumulativeCo2Kg  += state.diesel.powerKW * h * DIESEL_CO2_KG_PER_KWH;
  if (state.diesel.running) state.cumulativeDieselHours += h;
  const renewTick = state.solar.powerKW + state.wind.powerKW;
  state.cumulativeRenewablePct =
    (state.cumulativeRenewablePct * (state.ticksCount - 1) + (renewTick / Math.max(1, state.totalProductionKW)) * 100)
    / state.ticksCount;
}

function _computeFlows(): void {
  const f: PowerFlow[] = [];
  const push = (id: string, fx: number, fy: number, tx: number, ty: number, p: number, type: PowerFlow['type'], rev = false) => {
    if (p > 0.5) f.push({ id, fromX: fx, fromY: fy, toX: tx, toY: ty, powerKW: p, direction: rev ? 'reverse' : 'forward', type });
  };
  push('solar-bus',   195, 170, 430, 340, state.solar.powerKW,          'solar');
  push('wind-bus',    660, 155, 430, 340, state.wind.powerKW,            'wind');
  if (state.battery.powerKW > 0)  push('bat-bus', 390, 305, 430, 340, state.battery.powerKW,  'battery');
  else if (state.battery.powerKW < 0) push('bus-bat', 430, 340, 390, 305, -state.battery.powerKW, 'battery', true);
  push('diesel-bus',  530, 290, 430, 340, state.diesel.powerKW,          'diesel');
  if (state.grid.importKW > 0)  push('grid-bus',  760, 340, 430, 340, state.grid.importKW,  'grid');
  else if (state.grid.exportKW > 0) push('bus-grid', 430, 340, 760, 340, state.grid.exportKW, 'grid', true);
  if (state.loads.hospital.status    !== 'shed') push('bus-hosp', 430, 340, 210, 450, state.loads.hospital.demandKW,    'load');
  if (state.loads.residential.status !== 'shed') push('bus-res',  430, 340, 420, 490, state.loads.residential.demandKW, 'load');
  if (state.loads.industrial.status  !== 'shed') push('bus-ind',  430, 340, 620, 445, state.loads.industrial.demandKW,  'load');
  // SCADA data link (HQ to island)
  const scada = getScadaState();
  if (scada.hqConnected) {
    push('scada-link', 840, 60, 430, 340, 1, 'scada');
  }
  state.flows = f;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
_advanceWeather();
_computeLoads();
const _initForecast = _computeForecast();
_runOptimizer(_initForecast);
_computeFlows();
