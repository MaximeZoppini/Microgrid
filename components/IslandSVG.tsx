'use client';

import { useEffect, useRef } from 'react';
import type { MicrogridState, PowerFlow } from '@/lib/simulation';
import type { ScadaState } from '@/lib/scada';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: MicrogridState & { scada?: ScadaState };
}

// ─── Couleurs par type de flux ────────────────────────────────────────────────
const FLOW_COLOR: Record<PowerFlow['type'], string> = {
  solar:   '#facc15',
  wind:    '#38bdf8',
  battery: '#a78bfa',
  diesel:  '#f97316',
  grid:    '#6ee7b7',
  load:    '#94a3b8',
  scada:   '#818cf8',
};

// ─── Pulse animation along an SVG path ───────────────────────────────────────
function FlowPulse({ flow, pathId }: { flow: PowerFlow; pathId: string }) {
  const color = FLOW_COLOR[flow.type];
  const speed = Math.max(0.8, 3 - flow.powerKW / 30);  // faster = more power

  return (
    <>
      {/* Base line */}
      <use href={`#${pathId}`} stroke={color} strokeWidth={2.5} strokeOpacity={0.25} fill="none" />
      {/* Animated dash */}
      <use href={`#${pathId}`} stroke={color} strokeWidth={3} fill="none"
        strokeDasharray="12 20"
        strokeOpacity={0.9}
      >
        <animate attributeName="stroke-dashoffset" from="32" to="0"
          dur={`${speed}s`} repeatCount="indefinite" />
      </use>
      {/* Power label at midpoint */}
      <MidLabel flow={flow} color={color} />
    </>
  );
}

function MidLabel({ flow, color }: { flow: PowerFlow; color: string }) {
  const mx = (flow.fromX + flow.toX) / 2;
  const my = (flow.fromY + flow.toY) / 2;
  return (
    <g transform={`translate(${mx},${my})`}>
      <rect x={-22} y={-10} width={44} height={18} rx={4}
        fill="#0a0a1a" fillOpacity={0.85} />
      <text textAnchor="middle" dy={5} fontSize={10}
        fontFamily="monospace" fill={color} fontWeight="bold">
        {flow.powerKW.toFixed(0)}kW
      </text>
    </g>
  );
}

// ─── Component status dot ─────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const color = status === 'online' ? '#4ade80' : status === 'fault' ? '#f87171' : '#94a3b8';
  return (
    <circle r={5} fill={color}>
      {status === 'fault' && (
        <animate attributeName="opacity" values="1;0.2;1" dur="0.8s" repeatCount="indefinite" />
      )}
    </circle>
  );
}

// ─── Individual asset components ──────────────────────────────────────────────

function SolarFarm({ x, y, powerKW, status }: { x: number; y: number; powerKW: number; status: string }) {
  const active = status === 'online' && powerKW > 1;
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Panel grid 3×2 */}
      {[0, 1, 2].map(col => [0, 1].map(row => (
        <rect key={`${col}-${row}`}
          x={col * 22 - 22} y={row * 14 - 7}
          width={18} height={11} rx={2}
          fill={active ? '#fde047' : '#374151'}
          stroke="#1f2937" strokeWidth={1}
          opacity={active ? 0.9 + 0.1 * Math.sin(Date.now() / 1000 + col) : 0.4}
        />
      )))}
      {/* Label */}
      <text y={26} textAnchor="middle" fontSize={10} fill="#fbbf24" fontFamily="monospace">
        ☀️ {powerKW.toFixed(0)}kW
      </text>
      <g transform="translate(28,-16)"><StatusDot status={status} /></g>
    </g>
  );
}

function WindTurbine({ x, y, powerKW, status }: { x: number; y: number; powerKW: number; status: string }) {
  const rpm   = status === 'online' ? Math.max(0.5, powerKW / 8) : 0;
  const speed = rpm > 0 ? `${(6 / rpm).toFixed(1)}s` : '0s';
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Tower */}
      <line x1={0} y1={0} x2={0} y2={55} stroke="#9ca3af" strokeWidth={4} strokeLinecap="round" />
      {/* Hub */}
      <circle cx={0} cy={0} r={5} fill="#d1d5db" />
      {/* Blades */}
      <g>
        {rpm > 0 && (
          <animateTransform attributeName="transform" type="rotate"
            from="0" to="360" dur={speed} repeatCount="indefinite" />
        )}
        {[0, 120, 240].map(angle => (
          <path key={angle}
            d={`M 0,0 L ${Math.cos((angle - 90) * Math.PI / 180) * 32},${Math.sin((angle - 90) * Math.PI / 180) * 32}`}
            stroke={status === 'online' ? '#38bdf8' : '#374151'}
            strokeWidth={5} strokeLinecap="round"
          />
        ))}
      </g>
      <text y={68} textAnchor="middle" fontSize={10} fill="#38bdf8" fontFamily="monospace">
        💨 {powerKW.toFixed(0)}kW
      </text>
      <g transform="translate(12,-4)"><StatusDot status={status} /></g>
    </g>
  );
}

function BatteryUnit({ x, y, socPct, powerKW, status }: { x: number; y: number; socPct: number; powerKW: number; status: string }) {
  const fillH = Math.max(0, (socPct / 100) * 44);
  const fillColor = socPct > 50 ? '#4ade80' : socPct > 20 ? '#facc15' : '#f87171';
  const charging = powerKW < 0;
  const discharging = powerKW > 0;

  return (
    <g transform={`translate(${x},${y})`}>
      {/* Body */}
      <rect x={-24} y={-28} width={48} height={56} rx={4}
        fill="#1e293b" stroke="#475569" strokeWidth={2} />
      {/* Charge fill */}
      <rect x={-20} y={-24 + (44 - fillH)} width={40} height={fillH} rx={2}
        fill={fillColor} opacity={0.8} />
      {/* Terminal nub */}
      <rect x={-8} y={-34} width={16} height={8} rx={2} fill="#475569" />
      {/* SoC label */}
      <text y={5} textAnchor="middle" fontSize={11} fill="white" fontWeight="bold"
        fontFamily="monospace">{socPct.toFixed(0)}%</text>
      {/* Direction indicator */}
      <text y={18} textAnchor="middle" fontSize={9} fill={fillColor} fontFamily="monospace">
        {charging ? '⬆ charge' : discharging ? '⬇ disch.' : '—'}
      </text>
      <text y={42} textAnchor="middle" fontSize={10} fill="#a78bfa" fontFamily="monospace">
        🔋 {Math.abs(powerKW).toFixed(0)}kW
      </text>
      <g transform="translate(22,-24)"><StatusDot status={status} /></g>
    </g>
  );
}

function DieselGen({ x, y, powerKW, running, status }: { x: number; y: number; powerKW: number; running: boolean; status: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Body */}
      <rect x={-22} y={-18} width={44} height={36} rx={4}
        fill={running ? '#431407' : '#1c1917'} stroke={running ? '#f97316' : '#57534e'} strokeWidth={2} />
      {/* Exhaust pipe */}
      <rect x={14} y={-28} width={6} height={14} rx={2} fill="#57534e" />
      {/* Smoke when running */}
      {running && (
        <>
          {[0, 1, 2].map(i => (
            <circle key={i} cx={17 + (i % 2) * 3} cy={-30 - i * 8} r={3 + i}
              fill="#6b7280" opacity={0.6 - i * 0.15}>
              <animate attributeName="cy" from={-28} to={-50 - i * 5}
                dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" from={0.5} to={0}
                dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </>
      )}
      {/* Label */}
      <text y={4} textAnchor="middle" fontSize={9} fill="white" fontFamily="monospace">
        {running ? '⚙️ ON' : '⚙️ OFF'}
      </text>
      <text y={28} textAnchor="middle" fontSize={10} fill="#f97316" fontFamily="monospace">
        ⛽ {powerKW.toFixed(0)}kW
      </text>
      <g transform="translate(20,-14)"><StatusDot status={status} /></g>
    </g>
  );
}

function GridConnection({ x, y, importKW, exportKW, status }: { x: number; y: number; importKW: number; exportKW: number; status: string }) {
  const net = importKW - exportKW;
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Pylon */}
      <line x1={0} y1={-40} x2={-16} y2={-10} stroke="#94a3b8" strokeWidth={3} />
      <line x1={0} y1={-40} x2={16} y2={-10} stroke="#94a3b8" strokeWidth={3} />
      <line x1={0} y1={-10} x2={0} y2={20} stroke="#94a3b8" strokeWidth={4} />
      <line x1={-20} y1={-22} x2={20} y2={-22} stroke="#94a3b8" strokeWidth={2} />
      <line x1={-20} y1={-22} x2={-20} y2={-10} stroke="#6ee7b7" strokeWidth={2} strokeDasharray="3 2" />
      <line x1={20} y1={-22} x2={20} y2={-10} stroke="#6ee7b7" strokeWidth={2} strokeDasharray="3 2" />
      {/* Undersea cable indicator */}
      <path d="M 0,20 Q 40,30 60,20" stroke="#6ee7b7" strokeWidth={2} strokeDasharray="4 3"
        fill="none" opacity={0.6} />
      <text x={65} y={24} fontSize={9} fill="#6ee7b7" fontFamily="monospace">réseau</text>
      {/* Label */}
      <text y={34} textAnchor="middle" fontSize={10} fill="#6ee7b7" fontFamily="monospace">
        {net > 0 ? `↓ ${net.toFixed(0)}kW` : net < 0 ? `↑ ${(-net).toFixed(0)}kW` : '— 0kW'}
      </text>
      <g transform="translate(0,-44)"><StatusDot status={status} /></g>
    </g>
  );
}

function LoadZone({ x, y, label, icon, demandKW, status }: {
  x: number; y: number; label: string; icon: string;
  demandKW: number; status: string;
}) {
  const shed = status === 'shed';
  return (
    <g transform={`translate(${x},${y})`} opacity={shed ? 0.4 : 1}>
      {/* Building */}
      <rect x={-22} y={-24} width={44} height={32} rx={3}
        fill={shed ? '#1c1917' : '#1e293b'}
        stroke={shed ? '#7f1d1d' : '#334155'} strokeWidth={1.5} />
      {/* Windows */}
      {!shed && [[-10, -16], [2, -16], [-10, -6], [2, -6]].map(([wx, wy], i) => (
        <rect key={i} x={wx} y={wy} width={8} height={7} rx={1}
          fill="#fef08a" opacity={0.6 + 0.4 * (i % 2)} />
      ))}
      {shed && (
        <text y={0} textAnchor="middle" fontSize={14} fill="#ef4444">✗</text>
      )}
      <text y={18} textAnchor="middle" fontSize={10} fill={shed ? '#6b7280' : '#94a3b8'}
        fontFamily="monospace">{icon} {label}</text>
      <text y={30} textAnchor="middle" fontSize={9} fill={shed ? '#ef4444' : '#64748b'}
        fontFamily="monospace">{shed ? 'DÉLESTÉ' : `${demandKW.toFixed(0)}kW`}</text>
    </g>
  );
}

// ─── Weather overlay ──────────────────────────────────────────────────────────

function WeatherOverlay({ weather }: { weather: MicrogridState['weather'] }) {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 20;
  return (
    <g>
      {/* Sun / Moon */}
      {isDay ? (
        <circle cx={820} cy={50} r={24}
          fill={weather.cloudCover < 0.5 ? '#fef08a' : '#fef9c3'} opacity={1 - weather.cloudCover * 0.5}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
            <line key={a}
              x1={Math.cos(a * Math.PI / 180) * 28}
              y1={Math.sin(a * Math.PI / 180) * 28}
              x2={Math.cos(a * Math.PI / 180) * 36}
              y2={Math.sin(a * Math.PI / 180) * 36}
              stroke="#fde047" strokeWidth={2.5} />
          ))}
        </circle>
      ) : (
        <text x={816} y={58} fontSize={30}>🌙</text>
      )}
      {/* Wind indicator */}
      <text x={840} y={100} fontSize={11} fill="#38bdf8" fontFamily="monospace">
        💨 {weather.windSpeedMs.toFixed(1)} m/s
      </text>
      <text x={840} y={116} fontSize={11} fill="#fbbf24" fontFamily="monospace">
        🌡 {weather.temperatureC.toFixed(1)}°C
      </text>
      {/* Cloud cover bar */}
      <rect x={840} y={124} width={60} height={6} rx={3} fill="#1e293b" />
      <rect x={840} y={124} width={Math.round(weather.cloudCover * 60)} height={6} rx={3} fill="#9ca3af" />
      <text x={840} y={143} fontSize={9} fill="#9ca3af" fontFamily="monospace">
        ☁ {Math.round(weather.cloudCover * 100)}%
      </text>
    </g>
  );
}

// ─── Bus bar ──────────────────────────────────────────────────────────────────

function BusBar({ x, y, balanceKW }: { x: number; y: number; balanceKW: number }) {
  const color = balanceKW > 5 ? '#4ade80' : balanceKW < -5 ? '#f87171' : '#facc15';
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-50} y={-12} width={100} height={24} rx={4}
        fill="#0f172a" stroke={color} strokeWidth={2} />
      <text textAnchor="middle" dy={5} fontSize={11}
        fill={color} fontFamily="monospace" fontWeight="bold">
        {balanceKW > 0 ? '+' : ''}{balanceKW.toFixed(1)} kW
      </text>
      <text y={22} textAnchor="middle" fontSize={9} fill="#64748b" fontFamily="monospace">
        BUS PRINCIPAL
      </text>
    </g>
  );
}

// ─── Box overlay (one per asset) ─────────────────────────────────────────────

function BoxOverlay({ x, y, assetId, box }: {
  x: number; y: number; assetId: string;
  box: import('@/lib/scada').BoxState | undefined;
}) {
  if (!box) return null;
  const statusColor = box.status === 'online' ? '#4ade80' : box.status === 'degraded' ? '#facc15' : '#ef4444';
  const label = assetId.slice(0, 3).toUpperCase();
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={0} width={32} height={16} rx={3}
        fill="#0f172a" stroke={statusColor} strokeWidth={1} fillOpacity={0.9} />
      <text x={4} y={11} fontSize={8} fill={statusColor} fontFamily="monospace" fontWeight="bold">
        📡{label}
      </text>
      {box.status !== 'online' && (
        <circle cx={28} cy={4} r={3} fill={statusColor}>
          <animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

// ─── Enterprise HQ bubble ─────────────────────────────────────────────────────

function EnterpriseHQ({ x, y, scada }: {
  x: number; y: number;
  scada: import('@/lib/scada').ScadaState | undefined;
}) {
  const connected  = scada?.hqConnected ?? true;
  const mode       = scada?.mode ?? 'remote';
  const lastLog    = scada?.messageLog?.[0];
  const borderColor = connected ? '#4f46e5' : '#dc2626';
  const modeColor   = mode === 'autonomous' ? '#f97316' : '#818cf8';

  return (
    <g transform={`translate(${x},${y})`}>
      {/* HQ box */}
      <rect width={155} height={80} rx={6}
        fill="#0d0d2b" stroke={borderColor} strokeWidth={1.5} fillOpacity={0.95} />
      {/* Header */}
      <rect width={155} height={18} rx={6} fill={connected ? '#1e1b4b' : '#450a0a'} />
      <rect width={155} height={10} y={10} fill={connected ? '#1e1b4b' : '#450a0a'} />

      {/* Title */}
      <text x={8} y={12} fontSize={9} fill={borderColor} fontFamily="monospace" fontWeight="bold">
        🏢 ENTERPRISE HQ
      </text>

      {/* Connection status */}
      <g transform="translate(8,22)">
        <circle cx={4} cy={4} r={3} fill={connected ? '#4ade80' : '#ef4444'}>
          {connected && <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
        </circle>
        <text x={12} y={8} fontSize={8} fill={connected ? '#4ade80' : '#ef4444'} fontFamily="monospace">
          {connected ? 'LIEN SCADA ACTIF' : 'LIEN PERDU'}
        </text>
      </g>

      {/* Mode */}
      <text x={8} y={44} fontSize={8} fill={modeColor} fontFamily="monospace" fontWeight="bold">
        MODE: {mode.toUpperCase()}
      </text>

      {/* Last order */}
      {lastLog && (
        <text x={8} y={56} fontSize={7} fill="#6366f1" fontFamily="monospace">
          {lastLog.label.slice(0, 26)}{lastLog.label.length > 26 ? '…' : ''}
        </text>
      )}

      {/* Forecast hint */}
      {scada?.forecast && (
        <text x={8} y={70} fontSize={7} fill="#4f46e5" fontFamily="monospace">
          🎯 Cible batterie: {scada.forecast.batteryTargetSoC}% SoC
        </text>
      )}

      {/* Geographic distance indicator */}
      <text x={157} y={40} fontSize={8} fill="#312e81" fontFamily="monospace">╌╌╌</text>
      <text x={157} y={50} fontSize={7} fill="#312e81" fontFamily="monospace" fontStyle="italic">
        ~800 km
      </text>
    </g>
  );
}

// ─── Main island SVG ─────────────────────────────────────────────────────────

export default function IslandSVG({ state }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);


  // Minimal re-render trigger via RAF for smooth animations
  useEffect(() => {
    let raf: number;
    const loop = () => { raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const { solar, wind, battery, diesel, grid, loads, flows, weather, balanceKW } = state;
  const scada = state.scada;
  const isAutonomous = scada?.mode === 'autonomous';
  const hqConnected  = scada?.hqConnected ?? true;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 920 580"
      className="w-full h-full"
      style={{ background: '#0c1a2e' }}
    >
      {/* ── Ocean background ─────────────────────────────────────────────── */}
      <defs>
        <radialGradient id="ocean" cx="50%" cy="50%">
          <stop offset="0%"   stopColor="#0e4f7a" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#0c1a2e" stopOpacity={1} />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width={920} height={580} fill="url(#ocean)" />

      {/* Ocean waves (subtle) */}
      {[0.2, 0.5, 0.8].map((y, i) => (
        <path key={i}
          d={`M 0,${y * 580} Q 230,${y * 580 - 12} 460,${y * 580} Q 690,${y * 580 + 12} 920,${y * 580}`}
          stroke="#0e4f7a" strokeWidth={1.5} fill="none" opacity={0.4}
        />
      ))}

      {/* ── Island shape ─────────────────────────────────────────────────── */}
      <path
        d="M 90,240 C 85,140 180,60 330,45 C 430,35 530,50 630,80
           C 720,105 800,160 820,240 C 840,310 810,400 760,450
           C 710,500 640,530 560,545 C 480,558 390,565 310,548
           C 220,530 130,480 100,400 C 78,350 92,290 90,240 Z"
        fill="#1a3320"
        stroke="#2d5a3d"
        strokeWidth={2}
      />
      <path
        d="M 130,280 C 140,200 220,140 330,130 C 420,122 520,140 610,175
           C 680,200 730,250 740,310 C 750,370 720,420 670,450
           C 620,478 560,490 490,498 C 410,505 330,500 270,480
           C 200,455 140,400 130,340 C 122,310 128,295 130,280 Z"
        fill="#1e3d28"
        opacity={0.6}
      />

      {/* ── Paths (define once, reuse) ────────────────────────────────────── */}
      <defs>
        <path id="path-solar-bus"   d="M 195,170 Q 310,260 430,340" />
        <path id="path-wind-bus"    d="M 660,155 Q 560,250 430,340" />
        <path id="path-bat-bus"     d="M 390,305 L 430,340" />
        <path id="path-bus-bat"     d="M 430,340 L 390,305" />
        <path id="path-diesel-bus"  d="M 530,290 L 430,340" />
        <path id="path-grid-bus"    d="M 760,340 L 430,340" />
        <path id="path-bus-grid"    d="M 430,340 L 760,340" />
        <path id="path-bus-hosp"    d="M 430,340 Q 320,390 210,450" />
        <path id="path-bus-res"     d="M 430,340 L 420,490" />
        <path id="path-bus-ind"     d="M 430,340 Q 525,390 620,445" />
        {/* SCADA data link: Enterprise HQ (top-left corner) → island bus */}
        <path id="path-scada-link"
          d="M 80,75 C 80,200 200,280 430,340" />
      </defs>

      {/* ── Power line guides (dim) ─────────────────────────────────────────── */}
      {['solar-bus','wind-bus','bat-bus','diesel-bus','grid-bus',
        'bus-hosp','bus-res','bus-ind'].map(id => (
        <use key={id} href={`#path-${id}`}
          stroke="#1e3a4a" strokeWidth={2} fill="none" />
      ))}

      {/* SCADA link guide (dashed) */}
      <use href="#path-scada-link"
        stroke={hqConnected ? '#312e81' : '#450a0a'} strokeWidth={1.5}
        strokeDasharray="6 4" fill="none" opacity={0.5} />

      {/* ── Active power flows ────────────────────────────────────────────── */}
      {flows.filter(f => f.type !== 'scada').map(flow => (
        <FlowPulse key={flow.id} flow={flow} pathId={`path-${flow.id}`} />
      ))}

      {/* ── SCADA data link animation (separate from power) ──────────────── */}
      {hqConnected && (
        <>
          <use href="#path-scada-link" stroke="#818cf8" strokeWidth={1.5}
            strokeOpacity={0.2} fill="none" />
          <use href="#path-scada-link" stroke="#818cf8" strokeWidth={2}
            fill="none" strokeDasharray="5 18" strokeOpacity={0.8}>
            <animate attributeName="stroke-dashoffset" from="0" to="-23"
              dur="1.2s" repeatCount="indefinite" />
          </use>
        </>
      )}

      {/* ── Components ───────────────────────────────────────────────────── */}
      <SolarFarm   x={190} y={120}  powerKW={solar.powerKW}   status={solar.status} />
      <WindTurbine x={660} y={100}  powerKW={wind.powerKW}    status={wind.status} />
      <BatteryUnit x={380} y={280}  socPct={battery.socPct}   powerKW={battery.powerKW} status={battery.status} />
      <DieselGen   x={530} y={265}  powerKW={diesel.powerKW}  running={diesel.running} status={diesel.status} />
      <GridConnection x={760} y={310} importKW={grid.importKW} exportKW={grid.exportKW} status={grid.status} />
      <BusBar      x={430} y={340}  balanceKW={balanceKW} />

      <LoadZone x={210} y={455} label="Hôpital"    icon="🏥" demandKW={loads.hospital.demandKW}    status={loads.hospital.status} />
      <LoadZone x={420} y={490} label="Résidentiel" icon="🏘" demandKW={loads.residential.demandKW} status={loads.residential.status} />
      <LoadZone x={620} y={450} label="Industrie"  icon="🏭" demandKW={loads.industrial.demandKW}  status={loads.industrial.status} />

      {/* ── Box overlays on each asset ──────────────────────────────────── */}
      {scada && (
        <>
          <BoxOverlay x={225} y={92}  assetId="solar"       box={scada.boxes['solar']} />
          <BoxOverlay x={686} y={72}  assetId="wind"        box={scada.boxes['wind']} />
          <BoxOverlay x={406} y={252} assetId="battery"     box={scada.boxes['battery']} />
          <BoxOverlay x={556} y={238} assetId="diesel"      box={scada.boxes['diesel']} />
          <BoxOverlay x={790} y={284} assetId="grid"        box={scada.boxes['grid']} />
          <BoxOverlay x={240} y={427} assetId="hospital"    box={scada.boxes['hospital']} />
          <BoxOverlay x={450} y={463} assetId="residential" box={scada.boxes['residential']} />
          <BoxOverlay x={650} y={422} assetId="industrial"  box={scada.boxes['industrial']} />
        </>
      )}

      {/* ── Enterprise HQ bubble ─────────────────────────────────────────── */}
      <EnterpriseHQ x={14} y={12} scada={scada} />

      {/* ── Weather overlay ───────────────────────────────────────────────── */}
      <WeatherOverlay weather={weather} />

      {/* ── Autonomous mode banner ────────────────────────────────────────── */}
      {isAutonomous && (
        <g transform="translate(240,8)">
          <rect width={440} height={26} rx={4}
            fill="#451a03" stroke="#ea580c" strokeWidth={1.5} fillOpacity={0.95}>
            <animate attributeName="stroke-opacity" values="1;0.4;1" dur="1s" repeatCount="indefinite" />
          </rect>
          <text x={220} y={17} textAnchor="middle" fontSize={11} fill="#fb923c"
            fontFamily="monospace" fontWeight="bold">
            ⚠ MODE AUTONOME — LIEN SCADA PERDU — BOXES EN MAINTIEN
          </text>
        </g>
      )}

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <g transform="translate(12,530)">
        {[
          { color: '#facc15', label: 'Solaire' },
          { color: '#38bdf8', label: 'Éolien' },
          { color: '#a78bfa', label: 'Batterie' },
          { color: '#f97316', label: 'Diesel' },
          { color: '#6ee7b7', label: 'Réseau' },
          { color: '#818cf8', label: 'SCADA' },
        ].map(({ color, label }, i) => (
          <g key={label} transform={`translate(${i * 130},0)`}>
            <line x1={0} y1={4} x2={20} y2={4} stroke={color} strokeWidth={3} />
            <text x={26} y={9} fontSize={10} fill="#94a3b8" fontFamily="monospace">{label}</text>
          </g>
        ))}
      </g>

      {/* ── Fault alerts ─────────────────────────────────────────────────── */}
      {state.activeFaults.length > 0 && (
        <g transform="translate(290,42)">
          <rect width={260} height={state.activeFaults.length * 18 + 12} rx={4}
            fill="#450a0a" stroke="#dc2626" strokeWidth={1.5} fillOpacity={0.9} />
          <text x={8} y={16} fontSize={11} fill="#ef4444" fontFamily="monospace" fontWeight="bold">
            ⚠ ALARMES ACTIVES
          </text>
          {state.activeFaults.map((f, i) => (
            <text key={i} x={8} y={30 + i * 16} fontSize={10} fill="#fca5a5" fontFamily="monospace">{f}</text>
          ))}
        </g>
      )}
    </svg>
  );
}

