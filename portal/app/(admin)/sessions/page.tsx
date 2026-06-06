import { relayFetch } from '@/lib/relay';
import type { PlayerSession } from '@/lib/api';

/**
 * Sessions page — renders the live list of players connected to the Velocity proxy.
 *
 * Server component with `cache: 'no-store'` so every navigation shows fresh data.
 * Data source: the `audio:sessions` Redis hash written by `PlayerEventListener`.
 */
export default async function SessionsPage() {
  const sessions = await fetchSessions();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Sessions</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Players currently connected to the Velocity proxy
          </p>
        </div>
        {sessions !== null && (
          <span className="text-sm text-zinc-400">
            {sessions.length} online
          </span>
        )}
      </div>

      {sessions === null ? (
        <ErrorCard message="Could not reach relay. Is the backend running?" />
      ) : sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60">
                <Th>Player</Th>
                <Th>UUID</Th>
                <Th>Server</Th>
                <Th>Online since</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.player_uuid} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/40">
                  <Td>
                    <span className="font-medium text-zinc-200">{s.username}</span>
                  </Td>
                  <Td>
                    <code className="text-xs text-zinc-500 font-mono">{s.player_uuid}</code>
                  </Td>
                  <Td>
                    {s.server ? (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                        {s.server}
                      </span>
                    ) : (
                      <span className="text-zinc-600 text-xs">–</span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-zinc-400">{formatAge(s.joined_at)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Refresh the page to update. Live auto-refresh is a Phase 3 feature (requires admin WS feed).
      </p>
    </div>
  );
}

async function fetchSessions(): Promise<PlayerSession[] | null> {
  try {
    const res = await relayFetch('api/sessions', { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json() as Promise<PlayerSession[]>;
  } catch {
    return null;
  }
}

function formatAge(joinedAt: number): string {
  const secs = Math.floor(Date.now() / 1000) - joinedAt;
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5">{children}</td>;
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 p-10 text-center">
      <p className="text-zinc-400">No players currently connected.</p>
      <p className="text-xs text-zinc-600 mt-1">
        Players appear here after joining the Velocity proxy.
      </p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
      {message}
    </div>
  );
}
