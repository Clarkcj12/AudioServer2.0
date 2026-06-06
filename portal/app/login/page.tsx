'use client';

import { useActionState, useState } from 'react';
import {
  loginWithCredentials,
  loginWithSecret,
  type LoginState,
} from '@/app/actions/auth';

type Tab = 'credentials' | 'secret';
const initial: LoginState = { error: null };

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('credentials');
  const [credState,   credAction,   credPending]   = useActionState(loginWithCredentials, initial);
  const [secretState, secretAction, secretPending] = useActionState(loginWithSecret,      initial);

  return (
    <main className="flex min-h-full items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">

        {/* Title */}
        <div className="mb-8 text-center">
          <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase mb-1">
            AudioServer 2.0
          </p>
          <h1 className="text-2xl font-semibold text-zinc-100">Pro Portal</h1>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            <TabButton active={tab === 'credentials'} onClick={() => setTab('credentials')}>
              Sign In
            </TabButton>
            <TabButton active={tab === 'secret'} onClick={() => setTab('secret')} muted>
              Emergency Access
            </TabButton>
          </div>

          <div className="p-6">
            {/* ── Credentials form ── */}
            {tab === 'credentials' && (
              <form action={credAction} className="flex flex-col gap-4">
                <Field id="username" label="Username" type="text" autoComplete="username" />
                <Field id="password" label="Password" type="password" autoComplete="current-password" />

                {credState.error && <ErrorMsg>{credState.error}</ErrorMsg>}

                <button
                  type="submit"
                  disabled={credPending}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {credPending ? 'Signing in…' : 'Sign In'}
                </button>

                <p className="text-xs text-zinc-600 text-center leading-relaxed">
                  No account?{' '}
                  <span className="text-zinc-500">
                    Run <code className="font-mono">/audio admin</code> in-game to get a login link,
                    or ask your server admin.
                  </span>
                </p>
              </form>
            )}

            {/* ── Emergency / ADMIN_SECRET form ── */}
            {tab === 'secret' && (
              <form action={secretAction} className="flex flex-col gap-4">
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
                  <p className="text-xs text-amber-500 leading-relaxed">
                    Break-glass access via <code className="font-mono text-amber-400">ADMIN_SECRET</code>.
                    Use only when the relay database is unavailable or no admin accounts exist yet.
                  </p>
                </div>

                <Field id="secret" label="Admin Secret" type="password" autoComplete="off" />

                {secretState.error && <ErrorMsg>{secretState.error}</ErrorMsg>}

                <button
                  type="submit"
                  disabled={secretPending}
                  className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {secretPending ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({
  active,
  muted,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 px-4 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-b-2 border-sky-500 text-zinc-100 bg-zinc-900'
          : muted
          ? 'text-zinc-600 hover:text-zinc-400 bg-zinc-900/60'
          : 'text-zinc-500 hover:text-zinc-300 bg-zinc-900/60',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required
        placeholder={type === 'password' ? '••••••••' : undefined}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors"
      />
    </div>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-red-400">
      {children}
    </p>
  );
}
