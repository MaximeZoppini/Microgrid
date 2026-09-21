'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MicrogridState } from '@/lib/simulation';
import IslandSVG from '@/components/IslandSVG';
import Dashboard from '@/components/Dashboard';

const TICK_INTERVAL_MS = 1000; // wall-clock ms per tick

export default function Home() {
  const [state, setState]       = useState<MicrogridState | null>(null);
  const [isRunning, setRunning] = useState(false);
  const [speed, setSpeed]       = useState(1);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initial state fetch ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/state')
      .then(r => r.json())
      .then(setState)
      .catch(console.error);
  }, []);

  // ── Tick engine ──────────────────────────────────────────────────────────
  const doTick = useCallback(async (times: number) => {
    // Multiple ticks for speed multiplier
    let newState: MicrogridState | null = null;
    for (let i = 0; i < times; i++) {
      const r = await fetch('/api/state', { method: 'POST' });
      newState = await r.json();
    }
    if (newState) setState(newState);
  }, []);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!isRunning) return;

    const ticksPerInterval = speed <= 6 ? speed : Math.ceil(speed / 4);
    tickRef.current = setInterval(() => doTick(ticksPerInterval), TICK_INTERVAL_MS);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [isRunning, speed, doTick]);

  // ── Fault injection ──────────────────────────────────────────────────────
  const handleFault = useCallback(async (target: string, severity: 'partial' | 'total' = 'total') => {
    const r = await fetch('/api/fault', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'inject', target, severity }),
    });
    const { state: s } = await r.json();
    setState(s);
  }, []);

  const handleClearFaults = useCallback(async () => {
    const r = await fetch('/api/fault', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });
    const { state: s } = await r.json();
    setState(s);
  }, []);

  const handleSetSpeed = useCallback((s: number) => {
    setSpeed(s);
    // Propagate speed multiplier to state display
    setState(prev => prev ? { ...prev, speedMultiplier: s } : prev);
  }, []);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-screen text-white font-mono">
        <div className="text-center">
          <div className="text-4xl mb-4">⚡</div>
          <div className="text-lg text-cyan-400">Initialisation du microgrid…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#050a12]">

      {/* ── Island visualization (main area) ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <h1 className="text-sm font-bold font-mono text-white tracking-widest">
                MICROGRID × JEV
              </h1>
              <p className="text-[9px] text-white/30 font-mono">Simulation · Île autonome</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className={`flex items-center gap-1.5 ${state.balanceKW > 0 ? 'text-green-400' : 'text-red-400'}`}>
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'animate-pulse' : ''} ${state.balanceKW > 0 ? 'bg-green-400' : 'bg-red-400'}`} />
              {isRunning ? `×${speed} — ${state.weather.season === 'summer' ? '🌞' : '❄️'}` : 'EN PAUSE'}
            </span>
            <span className="text-white/30">
              Tick #{state.tickIndex} · {new Date(state.simulatedDate).toLocaleDateString('fr-FR')}
            </span>
          </div>
        </div>

        {/* Island SVG */}
        <div className="flex-1 overflow-hidden p-2">
          <IslandSVG state={state} />
        </div>

        {/* Bottom status bar */}
        <div className="px-4 py-2 border-t border-white/5 flex items-center gap-6 text-[10px] font-mono text-white/40">
          <span>
            ☀️ <span className="text-yellow-400">{state.solar.powerKW.toFixed(0)} kW</span>
          </span>
          <span>
            💨 <span className="text-sky-400">{state.wind.powerKW.toFixed(0)} kW</span>
          </span>
          <span>
            🔋 <span className="text-violet-400">{state.battery.socPct.toFixed(0)}% SoC</span>
          </span>
          <span>
            ⛽ <span className={state.diesel.running ? 'text-orange-400' : 'text-white/30'}>
              {state.diesel.running ? `${state.diesel.powerKW.toFixed(0)} kW ON` : 'OFF'}
            </span>
          </span>
          <span>
            🔌 <span className={state.grid.status === 'online' ? 'text-emerald-400' : 'text-red-400'}>
              {state.grid.status === 'online' ? `${(state.grid.importKW - state.grid.exportKW).toFixed(0)} kW` : 'HORS LIGNE'}
            </span>
          </span>
          <span className="ml-auto">
            {state.optimizerLog.slice(0, 80)}{state.optimizerLog.length > 80 ? '…' : ''}
          </span>
        </div>
      </div>

      {/* ── Dashboard (right panel) ───────────────────────────────────────── */}
      <div className="w-80 border-l border-white/10 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-3">
          <Dashboard
            state={state}
            onFault={handleFault}
            onClearFaults={handleClearFaults}
            onSetSpeed={handleSetSpeed}
            isRunning={isRunning}
            onToggleRun={() => setRunning(r => !r)}
          />
        </div>
      </div>

    </div>
  );
}
