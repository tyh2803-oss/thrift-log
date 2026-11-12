import type { Metadata, Viewport } from 'next';
import './globals.css';
import './visual-system.css';
export const metadata: Metadata = {
  title: 'Thrift Log — Good finds. Clear numbers.',
  description:
    'A thoughtful workspace for your reselling business. Inventory, sales, time, and profit in one place.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Thrift Log' },
  icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#304a35' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
