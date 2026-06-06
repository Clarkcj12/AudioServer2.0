'use client';

import { useEffect, useState, useTransition } from 'react';

interface PlayerProfile {
  uuid: string;
  username: string;
  volume_override: number;
  audio_enabled: boolean;
  default_client: 'lite' | 'portal';
}

export default function PreferencesPage() {
  const [profile, setProfile]     = useState<PlayerProfile | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [saveMsg, setSaveMsg]     = useState<'idle' | 'saved' | 'error'>('idle');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetch('/api/player-relay/player/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: PlayerProfile) => setProfile(d))
      .catch(() => setError('Could not load your profile. Is the server online?'));
  }, []);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    setSaveMsg('idle');

    const fd             = new FormData(e.currentTarget);
    const volume         = parseFloat(fd.get('volume') as string);
    const audio_enabled  = fd.get('audio_enabled') === 'on';
    const default_client = fd.get('default_client') as 'lite' | 'portal';

    startTransition(async () => {
      try {
        const res = await fetch('/api/player-relay/player/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume_override: volume, audio_enabled, default_client }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const updated = (await res.json()) as PlayerProfile;
        setProfile((p) => p ? { ...p, ...updated } : p);
        setSaveMsg('saved');
      } catch {
        setSaveMsg('error');
      }
    });
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (!profile) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">My Preferences</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Signed in as{' '}
          <span className="text-zinc-300 font-medium">{profile.username || profile.uuid}</span>
        </p>
      </div>

      <form onSubmit={handleSave} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-6">

        {/* Volume */}
        <div className="space-y-2">
          <label htmlFor="volume" className="text-sm font-medium text-zinc-300">
            Volume
          </label>
          <input
            id="volume"
            name="volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            defaultValue={profile.volume_override}
            className="w-full accent-sky-500"
          />
          <p className="text-xs text-zinc-600">
            Multiplied on top of each region&apos;s volume setting. 0 = mute, 1 = full.
          </p>
        </div>

        {/* Audio enabled */}
        <div className="flex items-center gap-3">
          <input
            id="audio_enabled"
            name="audio_enabled"
            type="checkbox"
            defaultChecked={profile.audio_enabled}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-sky-500"
          />
          <label htmlFor="audio_enabled" className="text-sm text-zinc-300">
            Audio enabled
          </label>
        </div>

        {/* Default client */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-300">Default audio client</p>
          <div className="space-y-1.5">
            {(['lite', 'portal'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="default_client"
                  value={opt}
                  defaultChecked={profile.default_client === opt}
                  className="accent-sky-500"
                />
                <span className="text-sm text-zinc-300">
                  {opt === 'lite' ? 'Lite client' : 'Advanced portal'}
                </span>
                <span className="text-xs text-zinc-600">
                  {opt === 'lite'
                    ? '— lightweight, audio only'
                    : '— this portal (preferences + future features)'}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-zinc-600">
            Controls what <code className="font-mono">/audio</code> opens in-game by default.
          </p>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          {saveMsg === 'saved' && <span className="text-sm text-emerald-400">Saved.</span>}
          {saveMsg === 'error' && (
            <span className="text-sm text-red-400">Save failed — try again.</span>
          )}
        </div>
      </form>
    </div>
  );
}
