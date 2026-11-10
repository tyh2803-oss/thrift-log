import type { NextConfig } from 'next';
const config: NextConfig = {
  // Exact LAN host used for iPhone testing; applies only to Next.js dev resources.
  allowedDevOrigins: ['127.0.0.1', '192.168.18.125'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self)' },
        ],
      },
    ];
  },
};
export default config;
