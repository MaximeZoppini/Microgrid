'use client';

import type { MicrogridState } from '@/lib/simulation';

interface Props {
  state: MicrogridState;
  onFault: (target: string, severity?: 'partial' | 'total') => void;
  onClearFaults: () => void;
  onSetSpeed: (speed: number) => void;
  isRunning: boolean;
  onToggleRun: () => void;
}

const FAULT_BUTTONS = [
  { id: 'solar',           label: '☀️ Panne solaire (−65%)',    severity: 'partial' as const, color: 'amber' },
  { id: 'solar',           label: '☀️ Coupure solaire totale',   severity: 'total'   as const, color: 'amber' },
  { id: 'wind',            label: '💨 Panne éolienne',           severity: 'total'   as const, color: 'sky' },
  { id: 'battery',         label: '🔋 Défaillance batterie',     severity: 'total'   as const, color: 'violet' },
  { id: 'grid',            label: '🔌 Perte réseau national',    severity: 'total'   as const, color: 'emerald' },
  { id: 'industrial_surge',label: '🏭 Pic industriel +30 kW',   severity: 'total'   as const, color: 'orange' },
  { id: 'diesel',          label: '⛽ Panne diesel',             severity: 'total'   as const, color: 'red' },
];

const SPEED_OPTIONS = [
  { label: '1×',  value: 1 },
  { label: '6×',  value: 6 },
  { label: '24×', value: 24 },
  { label: '96×', value: 96 },
];

function Gauge({ label, value, max, unit, color, low = false }:
  { label: string; value: number; max: number; unit: string; color: string; low?: boolean }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const warn = low ? pct < 20 : pct > 85;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono text-white/50">
        <span>{label}</span>
        <span className={warn ? 'text-red-400 font-bold' : 'text-white/70'}>
          {value.toFixed(1)}{unit}
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${warn ? 'bg-red-500' : color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, color }:
  { icon: string; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`rounded-lg border ${color} p-3`}>
      <div className="text-lg">{icon}</div>
      <div className="text-[9px] text-white/40 font-mono tracking-widest mt-1">{label}</div>
      <div className="text-lg font-bold text-white font-mono">{value}</div>
      {sub && <div className="text-[9px] text-white/40 font-mono">{sub}</div>}
    </div>
  );
}

export default function Dashboard({ state, onFault, onClearFaults, onSetSpeed, isRunning, onToggleRun }: Props) {
  const dt    = new Date(state.simulatedDate);
  const dow   = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][dt.getDay()];
  const dateStr = `${dow} ${dt.toLocaleDateString('fr-FR')} ${dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

  const freqColor = Math.abs(state.frequencyHz - 50) > 0.1 ? 'text-red-400' : 'text-green-400';

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto text-white">

      {/* ── Time + Speed ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/3 p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[9px] text-white/30 font-mono tracking-widest">TEMPS SIMULÉ</p>
            <p className="text-sm font-bold font-mono">{dateStr}</p>
            <p className="text-[10px] text-white/40 font-mono capitalize">{state.weather.season === 'summer' ? '🌞 Saison chaude' : '❄️ Saison froide'}</p>
          </div>
          <button
            onClick={onToggleRun}
            className={`px-4 py-2 rounded-lg font-bold font-mono text-sm transition-all ${
              isRunning
                ? 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
                : 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
            }`}
          >
            {isRunning ? '⏸ PAUSE' : '▶ LANCER'}
          </button>
        </div>
        <div className="flex gap-1">
          {SPEED_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => onSetSpeed(opt.value)}
              className={`flex-1 py-1 rounded text-xs font-mono font-bold transition-all ${
                state.speedMultiplier === opt.value
                  ? 'bg-cyan-500/30 border border-cyan-500/50 text-cyan-400'
                  : 'bg-white/5 border border-white/10 text-white/40 hover:text-white/70'
              }`}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {/* ── Balance & Frequency ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/3 p-3 text-center">
          <p className="text-[9px] text-white/30 font-mono tracking-widest">BALANCE</p>
          <p className={`text-xl font-bold font-mono ${state.balanceKW > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {state.balanceKW > 0 ? '+' : ''}{state.balanceKW.toFixed(1)} kW
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/3 p-3 text-center">
          <p className="text-[9px] text-white/30 font-mono tracking-widest">FRÉQUENCE</p>
          <p className={`text-xl font-bold font-mono ${freqColor}`}>
            {state.frequencyHz.toFixed(2)} Hz
          </p>
        </div>
      </div>

      {/* ── Component gauges ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/3 p-3 space-y-2">
        <p className="text-[9px] text-white/30 font-mono tracking-widest mb-1">PRODUCTION</p>
        <Gauge label="☀️ Solaire" value={state.solar.powerKW} max={80} unit=" kW" color="bg-yellow-400" />
        <Gauge label="💨 Éolien" value={state.wind.powerKW} max={40} unit=" kW" color="bg-sky-400" />
        <Gauge label="⛽ Diesel" value={state.diesel.powerKW} max={60} unit=" kW" color="bg-orange-400" />
        <Gauge label="🔌 Import réseau" value={state.grid.importKW} max={80} unit=" kW" color="bg-emerald-400" />
        <Gauge label="🔌 Export réseau" value={state.grid.exportKW} max={40} unit=" kW" color="bg-teal-400" />
        <p className="text-[9px] text-white/30 font-mono tracking-widest mt-2 mb-1">STOCKAGE</p>
        <Gauge label="🔋 Batterie SoC" value={state.battery.socPct} max={100} unit="%" color="bg-violet-400" low />
        <p className="text-[9px] text-white/30 font-mono tracking-widest mt-2 mb-1">CONSOMMATION</p>
        <Gauge label="🏥 Hôpital" value={state.loads.hospital.demandKW} max={30} unit=" kW" color="bg-red-400" />
        <Gauge label="🏘 Résidentiel" value={state.loads.residential.demandKW} max={50} unit=" kW" color="bg-blue-400" />
        <Gauge label="🏭 Industrie" value={state.loads.industrial.demandKW} max={80} unit=" kW" color="bg-purple-400" />
      </div>

      {/* ── Cumulative metrics ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard icon="💶" label="COÛT CUMULÉ" value={`${state.cumulativeCostEur.toFixed(2)}€`}
          color="border-yellow-500/20 bg-yellow-500/5" />
        <MetricCard icon="🌿" label="CO₂ ÉVITÉ%" value={`${state.cumulativeRenewablePct.toFixed(0)}%`}
          sub="part renouvelable" color="border-green-500/20 bg-green-500/5" />
        <MetricCard icon="⛽" label="HEURES DIESEL" value={`${state.cumulativeDieselHours.toFixed(1)}h`}
          color="border-orange-500/20 bg-orange-500/5" />
        <MetricCard icon="💨" label="CO₂ ÉMIS" value={`${state.cumulativeCo2Kg.toFixed(1)}kg`}
          color="border-red-500/20 bg-red-500/5" />
      </div>

      {/* ── Weather panel ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/3 p-3">
        <p className="text-[9px] text-white/30 font-mono tracking-widest mb-2">MÉTÉO</p>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div>
            <span className="text-white/40">☀️ Irradiance </span>
            <span className="text-yellow-400 font-bold">{state.weather.solarIrradianceWm2.toFixed(0)} W/m²</span>
          </div>
          <div>
            <span className="text-white/40">💨 Vent </span>
            <span className="text-sky-400 font-bold">{state.weather.windSpeedMs.toFixed(1)} m/s</span>
          </div>
          <div>
            <span className="text-white/40">🌡 Temp </span>
            <span className="text-orange-400 font-bold">{state.weather.temperatureC.toFixed(1)}°C</span>
          </div>
          <div>
            <span className="text-white/40">☁ Nuages </span>
            <span className="text-slate-400 font-bold">{Math.round(state.weather.cloudCover * 100)}%</span>
          </div>
          <div>
            <span className="text-white/40">🔌 Spot </span>
            <span className="text-emerald-400 font-bold">{(state.grid.spotPriceEurKWh * 100).toFixed(1)} c€/kWh</span>
          </div>
        </div>
      </div>

      {/* ── Optimizer log ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
        <p className="text-[9px] text-cyan-400/60 font-mono tracking-widest mb-1">OPTIMISEUR</p>
        <p className="text-[10px] text-cyan-300 font-mono leading-relaxed">{state.optimizerLog}</p>
      </div>

      {/* ── Fault injection ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
        <p className="text-[9px] text-red-400/60 font-mono tracking-widest mb-2">INJECTION DE PANNES</p>
        <div className="space-y-1.5">
          {FAULT_BUTTONS.map((btn, i) => (
            <button key={i}
              onClick={() => onFault(btn.id, btn.severity)}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-mono
                bg-white/5 border border-white/10 text-white/70
                hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300
                transition-all"
            >
              {btn.label}
              <span className="ml-2 text-white/30 text-[9px]">({btn.severity})</span>
            </button>
          ))}
          <button
            onClick={onClearFaults}
            className="w-full px-3 py-2 rounded-lg text-xs font-mono font-bold
              bg-green-500/10 border border-green-500/30 text-green-400
              hover:bg-green-500/20 transition-all mt-2"
          >
            ✓ Effacer toutes les pannes
          </button>
        </div>
      </div>

    </div>
  );
}
