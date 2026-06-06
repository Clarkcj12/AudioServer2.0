const REASONS: Record<string, string> = {
  'missing-token':    'No login token was found in the URL.',
  'invalid-token':    'Your login link has expired or already been used.',
  'relay-unreachable':'The audio server is currently unreachable. Try again shortly.',
  'no-database':      'The server is not configured for player accounts yet.',
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = (reason && REASONS[reason]) ?? 'An unexpected error occurred during login.';

  return (
    <main className="flex min-h-full items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">AudioServer 2.0</p>
        <h1 className="text-xl font-semibold text-zinc-100">Login Failed</h1>
        <p className="text-sm text-zinc-400">{message}</p>
        <p className="text-xs text-zinc-600 leading-relaxed">
          Run <code className="text-zinc-500 font-mono">/audio portal</code> in-game to get a
          fresh link, or ask your server admin for help.
        </p>
      </div>
    </main>
  );
}
