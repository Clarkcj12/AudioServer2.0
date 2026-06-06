import Nav from '@/components/nav';

/**
 * Shell layout for all authenticated admin routes.
 * The proxy ensures only authenticated users reach this layout.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <Nav />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
