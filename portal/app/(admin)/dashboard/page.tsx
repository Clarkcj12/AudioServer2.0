import StatCard from '@/components/stat-card';
import { relayFetch } from '@/lib/relay';
import type { DashboardStats } from '@/lib/api';

/**
 * Dashboard — server component that reads live data on every request.
 * Uses `relayFetch` (direct bearer-authenticated call) to avoid an extra
 * same-origin proxy hop for first-render data.
 */
export default async function DashboardPage() {
  const [health, stats] = await Promise.all([
    fetchHealth(),
    fetchStats(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">AudioServer 2.0 system overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Relay Health"
          value={health === 'ok' ? 'Online' : 'Unreachable'}
          description={`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000'}`}
          status={health === 'ok' ? 'ok' : 'error'}
        />
        <StatCard
          title="Active Sessions"
          value={stats ? String(stats.active_sessions) : '—'}
          description={stats ? 'Players connected to proxy' : 'Could not reach relay'}
          status={stats ? 'ok' : 'error'}
        />
        <StatCard
          title="Relay Nodes"
          value="—"
          description="Per-node heartbeat not yet tracked (Phase 3)"
          status="stub"
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">
          Phase 3 Features
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PHASE3.map((f) => (
            <div key={f.title} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm font-medium text-zinc-300">{f.title}</p>
              <p className="text-xs text-zinc-600 mt-1">{f.description}</p>
              <span className="mt-2 inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-500">
                Phase 3
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function fetchHealth(): Promise<'ok' | 'unreachable'> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/health`, { next: { revalidate: 10 } });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

async function fetchStats(): Promise<DashboardStats | null> {
  try {
    const res = await relayFetch('api/stats', { next: { revalidate: 15 } } as RequestInit);
    if (!res.ok) return null;
    return res.json() as Promise<DashboardStats>;
  } catch {
    return null;
  }
}

const PHASE3 = [
  { title: '3D Spatial Audio', description: 'Player XYZ → pan/volume falloff via Web Audio panner node.' },
  { title: 'Philips Hue DTLS', description: 'CoAP/DTLS streaming for Hue Entertainment groups.' },
  { title: 'TrainCarts Module', description: 'Vehicle enter/exit events mapped to audio regions.' },
  { title: 'Per-node Metrics', description: 'Live relay node health, uptime, and connection counts.' },
  { title: 'Live Event Stream', description: 'Real-time audio:events feed via admin WS or SSE.' },
  { title: 'WebRTC Voice', description: 'Peer-to-peer voice chat over the existing WS layer.' },
];
