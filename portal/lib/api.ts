/**
 * Typed API client for the AudioServer 2.0 Rust backend.
 *
 * All methods route through the same-origin proxy at `/api/relay/*` so they
 * work from both client and server components without exposing the httpOnly
 * admin JWT to browser JavaScript.
 *
 * For server components that need low-latency direct access, use
 * {@link relay.relayFetch} instead.
 */

// ---------------------------------------------------------------------------
// Response types — aligned with Rust API and docs/events.md
// ---------------------------------------------------------------------------

/** A live player session tracked by the Velocity proxy. */
export interface PlayerSession {
  player_uuid: string;
  username: string;
  /** Backend server name, or empty string if not yet assigned. */
  server: string;
  /** Unix timestamp (seconds) of initial proxy login. */
  joined_at: number;
}

/** Per-player audio preferences stored in PostgreSQL. */
export interface UserSettings {
  player_uuid: string;
  /** Volume multiplier [0.0, 1.0] applied on top of the region's audio-volume flag. */
  volume_override: number;
  audio_enabled: boolean;
  updated_at: string;
}

/** Partial update body for PUT /api/settings/:uuid — all fields optional. */
export interface SettingsUpdate {
  volume_override?: number;
  audio_enabled?: boolean;
}

/** An audio file stored in S3/MinIO, indexed in the audio_media table. */
export interface AudioMediaItem {
  id: string;
  object_key: string;
  filename: string;
  content_type: string;
  /** Bytes — client-reported on upload, nullable. */
  size_bytes: number | null;
  /** Seconds — client-reported on upload, nullable. */
  duration_seconds: number | null;
  /** Admin UUID who uploaded the file. */
  uploaded_by: string;
  created_at: string;
  /** Presigned GET URL (1-hour TTL). Generated at query time. */
  url: string;
}

/** Summary counts returned by GET /api/stats. */
export interface DashboardStats {
  active_sessions: number;
  /** null — per-node heartbeat not yet implemented (Phase 3). */
  relay_nodes: number | null;
  /** null — WG regions not mirrored to the relay (locked decision #3). */
  regions: number | null;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  /**
   * GET /health — relay liveness check. No auth required.
   * Safe to call from server components directly.
   */
  async health(): Promise<'ok' | 'unreachable'> {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
    try {
      const res = await fetch(`${base}/health`, { next: { revalidate: 10 } });
      return res.ok ? 'ok' : 'unreachable';
    } catch {
      return 'unreachable';
    }
  },

  /** GET /api/stats — aggregate dashboard counts. */
  async getStats(): Promise<DashboardStats> {
    const res = await fetch('/api/relay/stats', { next: { revalidate: 5 } });
    if (!res.ok) throw new Error(`stats: ${res.status}`);
    return res.json() as Promise<DashboardStats>;
  },

  /** GET /api/sessions — players currently connected to the proxy. */
  async getSessions(): Promise<PlayerSession[]> {
    const res = await fetch('/api/relay/sessions', { cache: 'no-store' });
    if (!res.ok) throw new Error(`sessions: ${res.status}`);
    return res.json() as Promise<PlayerSession[]>;
  },

  /** GET /api/settings/:uuid — player audio preferences (defaults if no record). */
  async getSettings(playerUuid: string): Promise<UserSettings> {
    const res = await fetch(`/api/relay/settings/${encodeURIComponent(playerUuid)}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`settings: ${res.status}`);
    return res.json() as Promise<UserSettings>;
  },

  /** PUT /api/settings/:uuid — upsert player preferences. */
  async putSettings(playerUuid: string, body: SettingsUpdate): Promise<UserSettings> {
    const res = await fetch(`/api/relay/settings/${encodeURIComponent(playerUuid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`settings PUT: ${res.status}`);
    return res.json() as Promise<UserSettings>;
  },

  // ── Media library ─────────────────────────────────────────────────────────

  /** GET /api/admin/media — list all uploaded audio files. */
  async listMedia(): Promise<AudioMediaItem[]> {
    const res = await fetch('/api/relay/admin/media', { cache: 'no-store' });
    if (!res.ok) throw new Error(`media list: ${res.status}`);
    return res.json() as Promise<AudioMediaItem[]>;
  },

  /**
   * POST /api/admin/media/upload-url — request a presigned PUT URL.
   * Returns the URL to PUT the file bytes to (direct to S3, not proxied)
   * and the object_key to pass to confirmUpload.
   */
  async requestUploadUrl(filename: string, contentType: string): Promise<{ upload_url: string; object_key: string }> {
    const res = await fetch('/api/relay/admin/media/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content_type: contentType }),
    });
    if (!res.ok) throw new Error(`upload-url: ${res.status}`);
    return res.json() as Promise<{ upload_url: string; object_key: string }>;
  },

  /** POST /api/admin/media/confirm — record a completed upload in the DB. */
  async confirmUpload(
    objectKey: string,
    sizeBytes: number | null,
    durationSeconds: number | null,
  ): Promise<AudioMediaItem> {
    const res = await fetch('/api/relay/admin/media/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_key: objectKey, size_bytes: sizeBytes, duration_seconds: durationSeconds }),
    });
    if (!res.ok) throw new Error(`confirm: ${res.status}`);
    return res.json() as Promise<AudioMediaItem>;
  },

  /** DELETE /api/admin/media/:id — remove from DB and S3. */
  async deleteMedia(id: string): Promise<void> {
    const res = await fetch(`/api/relay/admin/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`media delete: ${res.status}`);
  },
};
