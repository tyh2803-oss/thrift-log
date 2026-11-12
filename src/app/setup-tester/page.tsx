import type { Metadata } from 'next';
import { TesterSetup } from '@/components/tester-setup';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return <TesterSetup />;
}
