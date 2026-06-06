import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AudioServer Pro Portal',
  description: 'Admin dashboard for AudioServer 2.0 — spatial audio for Minecraft.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
