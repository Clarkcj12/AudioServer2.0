'use client';

/**
 * Settings page — search by player UUID, view and update audio preferences.
 *
 * Must be a client component because:
 *  - It requires interactive form state (UUID input, preference fields).
 *  - PUT calls go through the same-origin proxy (`/api/relay/settings/:uuid`)
 *    so the httpOnly admin JWT never touches browser JS.
 */

import { useState, useTransition } from 'react';
import { api, type UserSettings } from '@/lib/api';

export default function SettingsPage() {
  const [uuidInput, setUuidInput] = useState('');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [isPending, startTransition] = useTransition();

  function handleLoad(e: React.FormEvent) {
    e.preventDefault();
    if (!uuidInput.trim()) return;
    setError(null);
    setSettings(null);
    setSaveStatus('idle');

    startTransition(async () => {
      try {
        const s = await api.getSettings(uuidInput.trim());
        setSettings(s);
      } catch {
        setError('Player not found or relay unreachable.');
      }
    });
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings) return;
    setSaveStatus('idle');

    const fd = new FormData(e.currentTarget);
    const volume = parseFloat(fd.get('volume') as string);
    const enabled = fd.get('audio_enabled') === 'on';

    startTransition(async () => {
      try {
        const updated = await api.putSettings(settings.player_uuid, {
          volume_override: volume,
          audio_enabled: enabled,
        });
        setSettings(updated);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    });
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Player Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          View and override per-player audio preferences stored in PostgreSQL.
        </p>
      </div>

      {/* UUID lookup */}
      <form onSubmit={handleLoad} className="flex gap-2">
        <input
          value={uuidInput}
          onChange={(e) => setUuidInput(e.target.value)}
          placeholder="Player UUID (e.g. 550e8400-e29b-41d4-…)"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={isPending || !uuidInput.trim()}
          className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Loading…' : 'Load'}
        </button>
      </form>

      {error && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Settings form */}
      {settings && (
        <form onSubmit={handleSave} className="rounded-lg border border-zinc-800 p-5 space-y-4">
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">Player UUID</p>
            <p className="font-mono text-xs text-zinc-300">{settings.player_uuid}</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="volume" className="text-sm font-medium text-zinc-300">
              Volume override
            </label>
            <input
              id="volume"
              name="volume"
              type="number"
              min="0"
              max="1"
              step="0.05"
              defaultValue={settings.volume_override}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
            <p className="text-xs text-zinc-600">
              Multiplied on top of the region&apos;s audio-volume flag. Range: 0.0 (mute) – 1.0 (full).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="audio_enabled"
              name="audio_enabled"
              type="checkbox"
              defaultChecked={settings.audio_enabled}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-sky-500"
            />
            <label htmlFor="audio_enabled" className="text-sm text-zinc-300">
              Audio enabled
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            {saveStatus === 'saved' && (
              <span className="text-sm text-emerald-400">Saved.</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-400">Save failed — check relay/database.</span>
            )}
          </div>

          <p className="text-xs text-zinc-600 border-t border-zinc-800 pt-3">
            Last updated: {new Date(settings.updated_at).toLocaleString()}
          </p>
        </form>
      )}

      {!settings && !error && (
        <div className="rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-sm text-zinc-500">
            Enter a player UUID above to view or edit their settings.
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            Requires PostgreSQL — returns 503 if DATABASE_URL is not configured.
          </p>
        </div>
      )}
    </div>
  );
}
