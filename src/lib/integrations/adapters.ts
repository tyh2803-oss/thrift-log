export type Capability =
  | 'manualListings'
  | 'csvInventory'
  | 'csvSales'
  | 'csvListings'
  | 'readOrders'
  | 'readShows'
  | 'readReports'
  | 'readShipments'
  | 'webhooks'
  | 'writeInventory';
export interface MarketplaceAdapter {
  name: string;
  status: 'Manual / CSV' | 'Awaiting verification' | 'Read-only API';
  capabilities: Capability[];
  documentation: string;
  note: string;
}
export const adapters: MarketplaceAdapter[] = [
  {
    name: 'Whatnot',
    status: 'Read-only API',
    capabilities: [
      'manualListings',
      'csvInventory',
      'csvSales',
      'csvListings',
      'readOrders',
      'readShows',
      'readReports',
      'readShipments',
      'webhooks',
    ],
    documentation: 'https://developers.whatnot.com/',
    note: 'Official Seller API v2 read-only integration. Each private user connects a personal token after the additive migration. Orders, shipping, shows and existing financial reports synchronize with durable checkpoints. Payout transfers are not exposed by the API; unsupported financial breakdowns need reconciliation.',
  },
  {
    name: 'eBay',
    status: 'Awaiting verification',
    capabilities: ['manualListings', 'csvInventory', 'csvSales', 'csvListings'],
    documentation: 'https://developer.ebay.com/',
    note: 'Manual entries and CSV imports work. OAuth API synchronization awaits official documentation access, an application, and seller authorization.',
  },
  {
    name: 'Depop',
    status: 'Manual / CSV',
    capabilities: ['manualListings', 'csvInventory', 'csvSales', 'csvListings'],
    documentation: 'https://www.depop.com/',
    note: 'No authorized API connection has been verified. Use manual entry or CSV; no scraping or automatic delisting.',
  },
  {
    name: 'Vinted',
    status: 'Manual / CSV',
    capabilities: ['manualListings', 'csvInventory', 'csvSales', 'csvListings'],
    documentation: 'https://www.vinted.com/',
    note: 'No authorized API connection has been verified. Use manual entry or CSV; no scraping or automatic delisting.',
  },
];
