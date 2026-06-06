import { redirect } from 'next/navigation';

/**
 * Root `/` — the proxy handles the real redirect logic.
 * This is a safety fallback in case proxy does not fire.
 */
export default function Home() {
  redirect('/dashboard');
}
