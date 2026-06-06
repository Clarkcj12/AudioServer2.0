'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';

const LINKS: { href: string; label: string; phase?: 3 }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/sessions',  label: 'Sessions' },
  { href: '/regions',   label: 'Audio Regions' },
  { href: '/settings',  label: 'Player Settings' },
  { href: '/events',    label: 'Activity' },
  { href: '/hardware',  label: 'Hardware',  phase: 3 },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Brand */}
      <div className="border-b border-zinc-800 p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-600">
          AudioServer
        </p>
        <p className="mt-0.5 text-sm font-semibold text-zinc-200">Pro Portal</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-0.5 p-3">
        {LINKS.map(({ href, label, phase }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              <span>{label}</span>
              {phase && (
                <span className="font-mono text-xs text-zinc-700">P{phase}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-zinc-800 p-3">
        <form action={logout}>
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
          >
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  );
}
