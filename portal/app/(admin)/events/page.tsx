'use client';

import { useEffect, useRef, useState } from 'react';
import type { RedisEvent } from '@/lib/ws-types';

// Raw event off the wire — may be a RedisEvent or the sentinel
type WireEvent = (RedisEvent & { _ts: number }) | { type: '__history_end__'; _ts: number };

type ConnState = 'connecting' | 'live' | 'reconnecting' | 'error';

const EVENT_COLORS: Record<string, string> = {
  audio_play:        'bg-emerald-900/60 text-emerald-400',
  audio_stop:        'bg-zinc-800 text-zinc-400',
  region_enter:      'bg-sky-900/60 text-sky-400',
  player_connect:    'bg-violet-900/60 text-violet-400',
  player_disconnect: 'bg-red-900/60 text-red-400',
  server_switch:     'bg-amber-900/60 text-amber-400',
};

export default function EventsPage() {
  const [events, setEvents] = useState<WireEvent[]>([]);
  const [historyEnd, setHistoryEnd] = useState(false);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      setConnState('connecting');
      setHistoryEnd(false);

      let ticket: string;
      let wsUrl: string;

      try {
        const res = await fetch('/api/admin-ticket', { cache: 'no-store' });
        if (!res.ok) {
          setConnState('error');
          return;
        }
        const body = (await res.json()) as { ticket: string; wsUrl: string };
        ticket = body.ticket;
        wsUrl = body.wsUrl;
      } catch {
        setConnState('error');
        return;
      }

      if (cancelled) return;

      const ws = new WebSocket(`${wsUrl}?ticket=${ticket}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setConnState('live');
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
        try {
          const raw = JSON.parse(e.data as string) as { type?: string } & Partial<RedisEvent>;

          if (raw.type === '__history_end__') {
            setHistoryEnd(true);
            return;
          }

          const entry = { ...raw, _ts: Date.now() } as WireEvent;
          setEvents((prev) => [entry, ...prev].slice(0, 500));
        } catch {
          // malformed frame — ignore
        }
      };

      ws.onerror = () => {
        if (!cancelled) setConnState('reconnecting');
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnState('reconnecting');
        // Reconnect: fetch a fresh ticket (consumed tickets are single-use)
        retryRef.current = setTimeout(() => {
          if (!cancelled) connect();
        }, 3000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Activity</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Live feed of all <code className="text-zinc-400 text-xs bg-zinc-800 px-1 rounded">audio:events</code>{' '}
            channel messages.
          </p>
        </div>
        <ConnectionBadge state={connState} />
      </div>

      {/* Event feed */}
      {connState === 'error' ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
          Could not authenticate with relay. Is the backend running and the admin session valid?
        </div>
      ) : events.length === 0 && connState === 'live' ? (
        <div className="rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400 text-sm">Waiting for events…</p>
          <p className="text-xs text-zinc-600 mt-1">
            In-game actions (region crossings, audio play/stop, player logins) appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {events.map((e, i) => {
            if ('type' in e && e.type === '__history_end__') return null;

            const redisEvent = e as RedisEvent & { _ts: number };
            const ts = new Date(redisEvent._ts).toLocaleTimeString();
            const isHistory = !historyEnd || i >= events.findIndex((x) => !('type' in x && (x as { type?: string }).type === '__history_end__'));

            return (
              <div
                key={`${redisEvent._ts}-${i}`}
                className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5"
              >
                <span className="text-xs text-zinc-600 font-mono w-20 shrink-0 pt-0.5">{ts}</span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${EVENT_COLORS[redisEvent.event] ?? 'bg-zinc-800 text-zinc-400'}`}
                >
                  {redisEvent.event}
                </span>
                <EventDetail event={redisEvent} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectionBadge({ state }: { state: ConnState }) {
  const styles: Record<ConnState, string> = {
    connecting:   'text-amber-400 bg-amber-950/30 border-amber-900/50',
    live:         'text-emerald-400 bg-emerald-950/30 border-emerald-900/50',
    reconnecting: 'text-amber-400 bg-amber-950/30 border-amber-900/50',
    error:        'text-red-400 bg-red-950/30 border-red-900/50',
  };
  const labels: Record<ConnState, string> = {
    connecting:   'Connecting…',
    live:         'Live',
    reconnecting: 'Reconnecting…',
    error:        'Error',
  };
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${styles[state]}`}>
      {state === 'live' && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
      )}
      {labels[state]}
    </span>
  );
}

function EventDetail({ event }: { event: RedisEvent }) {
  const pid = event.player_id.slice(0, 8);

  switch (event.event) {
    case 'audio_play':
      return (
        <span className="text-xs text-zinc-400 min-w-0 truncate">
          <span className="text-zinc-500 font-mono">{pid}…</span>
          {' · '}
          <span className="text-zinc-300">{event.src}</span>
          {' · '}
          {Math.round(event.volume * 100)}%
          {event.loop && ' · loop'}
        </span>
      );
    case 'audio_stop':
      return <span className="text-xs text-zinc-500 font-mono">{pid}…</span>;
    case 'region_enter':
      return (
        <span className="text-xs text-zinc-400">
          <span className="text-zinc-500 font-mono">{pid}…</span>
          {' · '}
          <span className="text-zinc-300">{event.region_id}</span>
          {' '}
          <span className="text-zinc-600">{event.action}</span>
        </span>
      );
    case 'player_connect':
      return (
        <span className="text-xs text-zinc-400">
          <span className="text-zinc-200 font-medium">{event.username}</span>
          {' '}
          <span className="text-zinc-600 font-mono text-[10px]">{pid}…</span>
        </span>
      );
    case 'player_disconnect':
      return <span className="text-xs text-zinc-500 font-mono">{pid}…</span>;
    case 'server_switch':
      return (
        <span className="text-xs text-zinc-400">
          <span className="text-zinc-500 font-mono">{pid}…</span>
          {' → '}
          <span className="text-zinc-300">{event.server}</span>
        </span>
      );
  }
}
