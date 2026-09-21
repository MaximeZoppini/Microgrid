'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MicrogridState } from '@/lib/simulation';
import IslandSVG from '@/components/IslandSVG';
import Dashboard from '@/components/Dashboard';

const TICK_INTERVAL_MS = 1000;

export default function Home() {
  const [state, setState]         = useState<MicrogridState | null>(null);
  const [isRunning, setRunning]   = useState(false);
  const [speed, setSpeed]         = useState(1);
  const [drawerOpen, setDrawer]   = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initial state fetch ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/state').then(r => r.json()).then(setState).catch(console.error);
  }, []);

  // ── Tick engine ──────────────────────────────────────────────────────────
  const doTick = useCallback(async (times: number) => {
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
    setDrawer(false); // close drawer after action on mobile
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

  const handleScadaFault = useCallback(async () => {
    const r = await fetch('/api/scada', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fault' }),
    });
    const { state: s } = await r.json();
    setState(s);
  }, []);

  const handleScadaRestore = useCallback(async () => {
    const r = await fetch('/api/scada', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    });
    const { state: s } = await r.json();
    setState(s);
  }, []);

  const handleSetSpeed = useCallback((s: number) => {
    setSpeed(s);
    setState(prev => prev ? { ...prev, speedMultiplier: s } : prev);
  }, []);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-screen text-white font-mono bg-[#050a12]">
        <div className="text-center">
          <div className="text-4xl mb-4">⚡</div>
          <div className="text-lg text-cyan-400">Initialisation du microgrid…</div>
        </div>
      </div>
    );
  }

  const hasFaults = state.activeFaults.length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#050a12]">

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-white/5">
          <div className="flex items-center gap-2 md:gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <h1 className="text-xs md:text-sm font-bold font-mono text-white tracking-widest">
                MICROGRID × JEV
              </h1>
              <p className="text-[8px] md:text-[9px] text-white/30 font-mono hidden sm:block">
                Simulation · Île autonome
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {/* Status chip */}
            <span className={`flex items-center gap-1.5 text-xs font-mono ${state.balanceKW > 0 ? 'text-green-400' : 'text-red-400'}`}>
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'animate-pulse' : ''} ${state.balanceKW > 0 ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="hidden sm:inline">
                {isRunning ? `×${speed} — ${state.weather.season === 'summer' ? '🌞' : '❄️'}` : 'EN PAUSE'}
              </span>
            </span>

            {/* Quick play/pause on mobile */}
            <button
              onClick={() => setRunning(r => !r)}
              className={`md:hidden px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                isRunning
                  ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                  : 'bg-green-500/20 border border-green-500/40 text-green-400'
              }`}
            >
              {isRunning ? '⏸' : '▶'}
            </button>

            {/* Hamburger (mobile only) */}
            <button
              onClick={() => setDrawer(o => !o)}
              className="md:hidden relative flex flex-col justify-center items-center w-9 h-9 rounded-lg border border-white/10 bg-white/5 gap-1.5"
              aria-label="Ouvrir le panneau"
            >
              {/* Fault badge */}
              {hasFaults && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              )}
              <span className={`block w-4 h-0.5 rounded-full transition-all ${drawerOpen ? 'rotate-45 translate-y-2' : ''} bg-white/70`} />
              <span className={`block w-4 h-0.5 rounded-full transition-all ${drawerOpen ? 'opacity-0' : ''} bg-white/70`} />
              <span className={`block w-4 h-0.5 rounded-full transition-all ${drawerOpen ? '-rotate-45 -translate-y-2' : ''} bg-white/70`} />
            </button>
          </div>
        </div>

        {/* Island SVG */}
        <div className="flex-1 overflow-hidden p-1 md:p-2">
          <IslandSVG state={state} />
        </div>

        {/* Bottom status bar */}
        <div className="px-3 py-1.5 border-t border-white/5 flex items-center gap-2 md:gap-6 text-[9px] md:text-[10px] font-mono text-white/40 overflow-x-auto">
          <span className="whitespace-nowrap">☀️ <span className="text-yellow-400">{state.solar.powerKW.toFixed(0)}kW</span></span>
          <span className="whitespace-nowrap">💨 <span className="text-sky-400">{state.wind.powerKW.toFixed(0)}kW</span></span>
          <span className="whitespace-nowrap">🔋 <span className="text-violet-400">{state.battery.socPct.toFixed(0)}%</span></span>
          <span className="whitespace-nowrap">⛽ <span className={state.diesel.running ? 'text-orange-400' : 'text-white/25'}>{state.diesel.running ? 'ON' : 'OFF'}</span></span>
          <span className="whitespace-nowrap">🔌 <span className={state.grid.status === 'online' ? 'text-emerald-400' : 'text-red-400'}>{state.grid.status === 'online' ? `${(state.grid.importKW - state.grid.exportKW).toFixed(0)}kW` : 'FAULT'}</span></span>
          <span className="ml-auto hidden md:inline whitespace-nowrap truncate max-w-xs">
            {state.optimizerLog.slice(0, 80)}{state.optimizerLog.length > 80 ? '…' : ''}
          </span>
        </div>
      </div>

      {/* ── Desktop sidebar ──────────────────────────────────────────────────── */}
      <div className="hidden md:flex w-80 border-l border-white/10 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-3">
          <Dashboard
            state={state}
            onFault={handleFault}
            onClearFaults={handleClearFaults}
            onSetSpeed={handleSetSpeed}
            isRunning={isRunning}
            onToggleRun={() => setRunning(r => !r)}
            onScadaFault={handleScadaFault}
            onScadaRestore={handleScadaRestore}
          />
        </div>
      </div>

      {/* ── Mobile drawer backdrop ───────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setDrawer(false)}
        />
      )}

      {/* ── Mobile drawer (slides from right) ───────────────────────────────── */}
      <div className={`md:hidden fixed top-0 right-0 h-full w-[88vw] max-w-sm z-50
        border-l border-white/10 bg-[#070d18] flex flex-col
        transition-transform duration-300 ease-in-out
        ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-bold font-mono text-white/70 tracking-widest">PANNEAU DE CONTRÔLE</span>
          <button
            onClick={() => setDrawer(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Drawer content */}
        <div className="flex-1 overflow-y-auto p-3">
          <Dashboard
            state={state}
            onFault={handleFault}
            onClearFaults={handleClearFaults}
            onSetSpeed={handleSetSpeed}
            isRunning={isRunning}
            onToggleRun={() => setRunning(r => !r)}
            onScadaFault={handleScadaFault}
            onScadaRestore={handleScadaRestore}
          />
        </div>
      </div>

    </div>
  );
}
