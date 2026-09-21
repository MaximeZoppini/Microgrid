/**
 * SCADA / MQTT simulation layer
 * Simulates an enterprise control center sending orders to field boxes via a broker.
 *
 * MQTT topics (simulated):
 *   microgrid/hq/heartbeat           — HQ alive signal
 *   microgrid/{asset}/cmd             — HQ → Box command
 *   microgrid/{asset}/telemetry       — Box → HQ sensor data
 *   microgrid/alert                   — critical system alerts
 */

export type BoxStatus = 'online' | 'degraded' | 'no-signal';
export type OrderType = 'setpoint' | 'enable' | 'disable' | 'shed' | 'restore' | 'idle';

export interface ScadaMessage {
  id: string;
  ts: number;              // wall timestamp (simulated tick count)
  topic: string;
  from: 'hq' | 'box' | 'broker';
  to: string;              // asset id or 'hq'
  type: OrderType;
  value?: number;          // kW setpoint
  label: string;           // human-readable description
}

export interface BoxState {
  assetId: string;
  status: BoxStatus;
  lastOrderTs: number;     // tick index of last received order
  lastOrderLabel: string;
  currentSetpointKW: number | null;
  enabled: boolean;
}

export interface ScadaState {
  mode: 'remote' | 'autonomous';
  communicationFault: boolean;
  hqConnected: boolean;
  lastHeartbeatTick: number;
  autonomousSinceTick: number | null;
  boxes: Record<string, BoxState>;
  messageLog: ScadaMessage[];    // last N messages
  forecast: ForecastData;
}

export interface ForecastData {
  horizonH: number;
  forecastSurplusKWh: number;
  forecastDeficitKWh: number;
  batteryTargetSoC: number;
  coldPeriodExpected: boolean;
  eveningPeakExpected: boolean;
  forecastRenewableKW: number;
  forecastDemandKW: number;
  rationale: string;
}

// ─── Asset IDs ────────────────────────────────────────────────────────────────
export const ASSET_IDS = ['solar', 'wind', 'battery', 'diesel', 'grid', 'hospital', 'residential', 'industrial'] as const;
export type AssetId = typeof ASSET_IDS[number];

const MAX_LOG = 30;
const AUTONOMOUS_THRESHOLD_TICKS = 3;   // no orders for 3 ticks → autonomous
let tickCounter = 0;

// ─── Initial state ────────────────────────────────────────────────────────────

function makeBox(id: string): BoxState {
  return {
    assetId: id,
    status: 'online',
    lastOrderTs: 0,
    lastOrderLabel: 'Aucun ordre reçu',
    currentSetpointKW: null,
    enabled: true,
  };
}

function makeForecast(): ForecastData {
  return {
    horizonH: 2,
    forecastSurplusKWh: 0,
    forecastDeficitKWh: 0,
    batteryTargetSoC: 50,
    coldPeriodExpected: false,
    eveningPeakExpected: false,
    forecastRenewableKW: 0,
    forecastDemandKW: 0,
    rationale: 'Initialisation',
  };
}

let scadaState: ScadaState = {
  mode: 'remote',
  communicationFault: false,
  hqConnected: true,
  lastHeartbeatTick: 0,
  autonomousSinceTick: null,
  boxes: Object.fromEntries(ASSET_IDS.map(id => [id, makeBox(id)])),
  messageLog: [],
  forecast: makeForecast(),
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function getScadaState(): ScadaState { return scadaState; }

export function resetScada(): void {
  tickCounter = 0;
  scadaState = {
    mode: 'remote',
    communicationFault: false,
    hqConnected: true,
    lastHeartbeatTick: 0,
    autonomousSinceTick: null,
    boxes: Object.fromEntries(ASSET_IDS.map(id => [id, makeBox(id)])),
    messageLog: [],
    forecast: makeForecast(),
  };
}

/** Inject a communication fault — HQ stops sending orders */
export function injectScadaFault(): void {
  scadaState.communicationFault = true;
  scadaState.hqConnected = false;
  log('broker', 'hq', 'idle', undefined, '🔴 SCADA: lien HQ coupé — câble sous-marin rompu');
}

/** Restore communication */
export function restoreScada(): void {
  scadaState.communicationFault = false;
  scadaState.hqConnected = true;
  scadaState.mode = 'remote';
  scadaState.autonomousSinceTick = null;
  scadaState.lastHeartbeatTick = tickCounter;
  // Re-enable all boxes
  for (const box of Object.values(scadaState.boxes)) {
    box.status = 'online';
    box.lastOrderTs = tickCounter;
  }
  log('broker', 'hq', 'idle', undefined, '🟢 SCADA: lien HQ restauré — reprise en mode distant');
}

/**
 * Called each simulation tick. Sends orders from HQ to boxes.
 * Returns the ordered setpoints for the optimizer to apply.
 */
export function scadaTick(
  tick: number,
  orders: Array<{ asset: AssetId; type: OrderType; value?: number; label: string }>,
  forecast: ForecastData,
): void {
  tickCounter = tick;
  scadaState.forecast = forecast;

  if (!scadaState.communicationFault) {
    // ── HQ heartbeat ───────────────────────────────────────────────────────
    scadaState.lastHeartbeatTick = tick;
    scadaState.hqConnected = true;

    // ── Dispatch orders to boxes ───────────────────────────────────────────
    for (const order of orders) {
      const box = scadaState.boxes[order.asset];
      if (!box) continue;

      const msg: ScadaMessage = {
        id: `${tick}-${order.asset}`,
        ts: tick,
        topic: `microgrid/${order.asset}/cmd`,
        from: 'hq',
        to: order.asset,
        type: order.type,
        value: order.value,
        label: order.label,
      };

      box.lastOrderTs = tick;
      box.lastOrderLabel = order.label;
      if (order.type === 'setpoint' && order.value !== undefined) box.currentSetpointKW = order.value;
      if (order.type === 'disable')  { box.enabled = false; box.currentSetpointKW = 0; }
      if (order.type === 'enable')   { box.enabled = true; }
      if (order.type === 'shed')     { box.enabled = false; }
      if (order.type === 'restore')  { box.enabled = true; }
      box.status = 'online';

      log(msg.from, msg.to, msg.type, msg.value, msg.label);
    }

    if (scadaState.mode === 'autonomous') {
      scadaState.mode = 'remote';
      scadaState.autonomousSinceTick = null;
      log('broker', 'hq', 'idle', undefined, '✅ Mode distant restauré');
    }
  } else {
    // ── Communication fault — update box statuses ──────────────────────────
    for (const box of Object.values(scadaState.boxes)) {
      const ticksSinceOrder = tick - box.lastOrderTs;
      if (ticksSinceOrder >= AUTONOMOUS_THRESHOLD_TICKS + 2) {
        box.status = 'no-signal';
      } else if (ticksSinceOrder >= AUTONOMOUS_THRESHOLD_TICKS) {
        box.status = 'degraded';
      }
    }

    const ticksSinceFault = tick - scadaState.lastHeartbeatTick;
    if (ticksSinceFault >= AUTONOMOUS_THRESHOLD_TICKS && scadaState.mode !== 'autonomous') {
      scadaState.mode = 'autonomous';
      scadaState.autonomousSinceTick = tick;
      log('broker', 'all', 'idle', undefined,
        '⚠️ MODE AUTONOME activé — boxes sans ordre depuis ' + AUTONOMOUS_THRESHOLD_TICKS + ' ticks');
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function log(from: ScadaMessage['from'], to: string, type: OrderType, value?: number, label = '') {
  const msg: ScadaMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ts: tickCounter,
    topic: `microgrid/${to}/cmd`,
    from, to, type, value, label,
  };
  scadaState.messageLog.unshift(msg);
  if (scadaState.messageLog.length > MAX_LOG) scadaState.messageLog.pop();
}
