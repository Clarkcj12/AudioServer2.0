/**
 * Regions page — explains the WorldGuard audio flag workflow.
 *
 * WHY THIS IS INFORMATIONAL ONLY
 * Locked architecture decision #3: WorldGuard owns region geometry.
 * Regions are not stored in the relay's database — they live as WG flags on
 * existing WG regions.  To show live region data here, the Java plugin would
 * need to publish region metadata to Redis on startup (a future feature).
 */
export default function RegionsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Audio Regions</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Regions are defined by WorldGuard flags — no separate configuration needed.
        </p>
      </div>

      {/* Status banner */}
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
        <p className="text-sm font-medium text-amber-400">Read-pending-producer</p>
        <p className="text-xs text-amber-600 mt-1">
          Live region data requires the Java plugin to publish WG region metadata to Redis on
          startup. This is a planned Phase 3 feature. Until then, configure regions directly
          in-game with WorldGuard commands.
        </p>
      </div>

      {/* How it works */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest">
          How it works
        </h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          AudioServer registers three custom WorldGuard flags. When a player enters a WG
          region that has <code className="text-zinc-300 bg-zinc-800 px-1 rounded">audio-src</code>{' '}
          set, the plugin&apos;s{' '}
          <code className="text-zinc-300 bg-zinc-800 px-1 rounded">AudioSessionHandler</code> fires
          an <code className="text-zinc-300 bg-zinc-800 px-1 rounded">AudioPlayEvent</code> to Redis,
          which the relay forwards to the player&apos;s WebSocket.
        </p>
      </section>

      {/* Flag reference */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest">
          Flag reference
        </h2>
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60">
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Flag</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Type</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Description</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">Default</th>
              </tr>
            </thead>
            <tbody>
              {FLAGS.map((f) => (
                <tr key={f.flag} className="border-b border-zinc-800/50 last:border-0">
                  <td className="px-4 py-2.5">
                    <code className="text-sky-400 font-mono text-xs">{f.flag}</code>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{f.type}</td>
                  <td className="px-4 py-2.5 text-zinc-400 text-xs">{f.description}</td>
                  <td className="px-4 py-2.5 text-zinc-600 text-xs font-mono">{f.default}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Example commands */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest">
          Example — configure the spawn region
        </h2>
        <pre className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-xs text-zinc-300 font-mono overflow-x-auto leading-relaxed">
{`/rg flag spawn audio-src https://cdn.example.com/ambient/spawn.ogg
/rg flag spawn audio-volume 75
/rg flag spawn audio-loop allow`}
        </pre>
        <p className="text-xs text-zinc-600">
          The flags take effect immediately — no restart needed. Players already in the
          region will receive the update on their next movement event.
        </p>
      </section>

      {/* Phase 3 note */}
      <section className="rounded-lg border border-zinc-800 p-4 space-y-1">
        <p className="text-sm font-medium text-zinc-300">Phase 3 — live region list</p>
        <p className="text-xs text-zinc-600">
          The plugin will publish region metadata to{' '}
          <code className="text-zinc-500">audio:regions</code> (a Redis hash) on startup.
          This page will then display all configured WG regions and their current flag
          values without requiring in-game access.
        </p>
      </section>
    </div>
  );
}

const FLAGS = [
  {
    flag: 'audio-src',
    type: 'String',
    description: 'URL of the audio asset to play. Setting this activates audio for the region.',
    default: 'none',
  },
  {
    flag: 'audio-volume',
    type: 'Integer (0–100)',
    description: 'Playback volume as a percentage. Applied on top of the player\'s volume_override preference.',
    default: '100',
  },
  {
    flag: 'audio-loop',
    type: 'State',
    description: 'allow = loop continuously. deny / absent = play once.',
    default: 'deny',
  },
];
