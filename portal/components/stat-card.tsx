interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  /** `ok` = green, `error` = red, `warn` = amber, `stub` = muted (Phase 2 not yet wired) */
  status?: 'ok' | 'error' | 'warn' | 'stub';
}

const statusClass: Record<NonNullable<StatCardProps['status']>, string> = {
  ok:    'text-emerald-400',
  error: 'text-red-400',
  warn:  'text-amber-400',
  stub:  'text-zinc-500',
};

export default function StatCard({
  title,
  value,
  description,
  status = 'stub',
}: StatCardProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        {title}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${statusClass[status]}`}>
        {value}
      </p>
      {description && (
        <p className="mt-1 text-xs text-zinc-600 truncate" title={description}>
          {description}
        </p>
      )}
    </div>
  );
}
