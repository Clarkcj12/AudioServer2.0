import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPlayerToken, PLAYER_COOKIE } from '@/lib/player-auth';
import { logout } from '@/app/actions/auth';

export default async function PlayerLayout({ children }: { children: ReactNode }) {
  const jar   = await cookies();
  const token = jar.get(PLAYER_COOKIE)?.value;
  const authed = token ? await verifyPlayerToken(token) : false;

  if (!authed) redirect('/auth/player-login');

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Minimal top bar */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-widest text-zinc-500 uppercase">AudioServer</span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs text-zinc-400">Player Portal</span>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Sign out
          </button>
        </form>
      </header>

      {/* Page content */}
      <main className="flex-1 px-6 py-8 max-w-xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
