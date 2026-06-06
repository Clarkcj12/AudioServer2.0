<script lang="ts">
    /**
     * AudioServer Lite Client — listen page.
     *
     * Flow:
     *  1. Read `?token=<ott>` from the URL.
     *  2. Open a WebSocket to `/ws?token=<ott>`.
     *  3. Receive `auth_success` → store JWT, show "Enable Audio" button.
     *  4. User clicks Enable Audio (required browser gesture to unlock AudioContext).
     *  5. Subsequent `audio_play` / `audio_stop` messages drive a single Howl instance.
     *
     * Audio state is modelled as desired vs. actual:
     *  - `desired` tracks what the server last requested.
     *  - `reconcile()` brings the single active Howl in line with `desired`.
     *  - This avoids stale-closure bugs from handling autoplay failure reactively.
     */
    import { onMount, onDestroy } from 'svelte';
    import { Howl, Howler } from 'howler';
    import type { RelayMessage } from '$lib/ws-types';

    // ── Reactive UI state ──────────────────────────────────────────────────
    let status      = $state('Initialising…');
    let authenticated = $state(false);
    let enabled     = $state(false);   // true after the user clicks Enable Audio
    let playerUuid  = $state<string | null>(null);
    /** What the server last requested. `null` = silence. */
    let desired     = $state<{ src: string; volume: number; loop: boolean } | null>(null);

    // ── Non-reactive internals ─────────────────────────────────────────────
    let ws: WebSocket | null = null;
    let activeHowl: Howl | null = null;
    /** `src` of the Howl that is currently loaded, to skip redundant reloads. */
    let activeSrc: string | null = null;

    // ── Audio control ──────────────────────────────────────────────────────

    /**
     * Bring the active Howl in line with `desired`.
     *
     * No-ops until the user has clicked Enable Audio so the AudioContext is
     * guaranteed to be unlocked before we attempt playback.
     */
    function reconcile(): void {
        if (!enabled) return;

        if (desired === null) {
            activeHowl?.stop();
            activeHowl?.unload();
            activeHowl = null;
            activeSrc = null;
            return;
        }

        // Same src already loaded — just update live parameters to avoid a
        // disruptive stop/reload (e.g. volume change from a different region flag).
        if (activeSrc === desired.src && activeHowl) {
            activeHowl.volume(desired.volume);
            activeHowl.loop(desired.loop);
            return;
        }

        // Replace the active clip.
        activeHowl?.stop();
        activeHowl?.unload();

        // Capture desired into a local so the callbacks see a consistent snapshot.
        const d = { ...desired };

        activeHowl = new Howl({
            src: [d.src],
            volume: d.volume,
            loop: d.loop,
            // html5: false → Web Audio API (default).
            // Required for the Phase 3 panner node; buffers the whole file in memory.
            html5: false,
            onloaderror: (_id: number, err: unknown) => {
                status = `Audio load error — check the URL configured on the region. (${err})`;
            },
        });
        activeSrc = d.src;
        activeHowl.play();
    }

    /**
     * Called when the player clicks "Enable Audio".
     *
     * This click is a browser user-gesture, which allows us to resume the
     * AudioContext directly rather than waiting for Howler's internal unlock
     * listeners to fire.
     */
    function enableAudio(): void {
        enabled = true;
        status = 'Audio enabled.';

        // Resume the Web Audio context proactively on this gesture.
        const ctx = Howler.ctx as AudioContext | null;
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().then(reconcile, reconcile);
        } else {
            reconcile();
        }
    }

    // ── WebSocket setup ────────────────────────────────────────────────────

    onMount(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (!token) {
            status = 'Error: no token in URL. Use /audio in-game to get a link.';
            return;
        }

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;

        status = 'Connecting…';
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            status = 'Authenticating…';
        };

        ws.onmessage = (evt: MessageEvent) => {
            let msg: RelayMessage;
            try {
                msg = JSON.parse(evt.data as string) as RelayMessage;
            } catch {
                return; // malformed — ignore
            }

            switch (msg.type) {
                case 'auth_success':
                    localStorage.setItem('audio_jwt', msg.jwt);
                    playerUuid  = msg.player_uuid;
                    authenticated = true;
                    status = enabled
                        ? 'Connected — audio is active.'
                        : 'Connected — click Enable Audio to hear in-game sounds.';
                    break;

                case 'audio_play':
                    desired = { src: msg.src, volume: msg.volume, loop: msg.loop };
                    if (!enabled) {
                        status = 'Audio queued — click Enable Audio to start.';
                    }
                    reconcile();
                    break;

                case 'audio_stop':
                    desired = null;
                    reconcile();
                    if (enabled) status = 'Connected — no active audio.';
                    break;
            }
        };

        ws.onerror = () => {
            status = 'Connection error. Use /audio in-game to get a new link.';
        };

        ws.onclose = () => {
            if (!authenticated) {
                status = 'Disconnected before authentication completed.';
            } else {
                status = 'Connection closed.';
                desired = null;
                reconcile();
            }
        };
    });

    onDestroy(() => {
        ws?.close();
        activeHowl?.stop();
        activeHowl?.unload();
    });
</script>

<main>
    <h1>AudioServer</h1>

    <p class="status" class:ok={authenticated && enabled} class:warn={authenticated && !enabled}>
        {status}
    </p>

    {#if authenticated && playerUuid}
        <p class="uuid">Session active for <code>{playerUuid}</code></p>
    {/if}

    <!-- Primary CTA: must appear before audio can play (browser gesture requirement) -->
    {#if authenticated && !enabled}
        <button class="enable-btn" onclick={enableAudio}>
            ▶ Enable Audio
        </button>
        <p class="hint">Browsers require a tap before playing audio.</p>
    {/if}

    <!-- Playback indicator -->
    {#if enabled && desired}
        <div class="playing" aria-label="Audio playing">
            <span class="dot" aria-hidden="true"></span>
            Playing
        </div>
    {/if}
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        font-family: sans-serif;
        background: #0a0a0a;
        color: #e0e0e0;
        gap: 1rem;
        padding: 1.5rem;
    }

    h1 {
        font-size: 2rem;
        letter-spacing: 0.1em;
        color: #7dd3fc;
        margin: 0;
    }

    .status {
        font-size: 1.1rem;
        color: #94a3b8;
        text-align: center;
        max-width: 28rem;
    }
    .status.ok   { color: #4ade80; }
    .status.warn { color: #fbbf24; }

    .uuid {
        font-size: 0.9rem;
        color: #64748b;
    }

    code {
        font-family: monospace;
        background: #1e293b;
        padding: 0.1em 0.4em;
        border-radius: 4px;
    }

    .enable-btn {
        margin-top: 0.5rem;
        padding: 0.75rem 2rem;
        border: none;
        border-radius: 8px;
        background: #0ea5e9;
        color: #fff;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
    }
    .enable-btn:hover  { background: #38bdf8; }
    .enable-btn:active { background: #0284c7; }

    .hint {
        font-size: 0.8rem;
        color: #475569;
        margin: 0;
    }

    .playing {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: #4ade80;
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4ade80;
        animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1;   transform: scale(1); }
        50%       { opacity: 0.4; transform: scale(0.75); }
    }
</style>
