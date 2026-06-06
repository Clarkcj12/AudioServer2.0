export default function PlayerLoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">AudioServer 2.0</p>
        <h1 className="text-xl font-semibold text-zinc-100">Advanced Portal</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3 text-left">
          <p className="text-sm font-medium text-zinc-300">How to access your portal</p>
          <ol className="text-sm text-zinc-400 space-y-2 list-decimal list-inside leading-relaxed">
            <li>
              Join your Minecraft server and run{' '}
              <code className="text-zinc-300 bg-zinc-800 px-1 rounded font-mono">/audio portal</code>
            </li>
            <li>Click the link that appears in chat</li>
            <li>You&apos;ll be logged in automatically</li>
          </ol>
        </div>
        <p className="text-xs text-zinc-600">
          Links expire after 5 minutes. Get a fresh one by running the command again.
        </p>
      </div>
    </main>
  );
}
