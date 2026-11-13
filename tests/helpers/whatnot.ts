import type {
  OrderSource,
  SourceShow,
  ShowAnalytics,
} from '../../src/lib/integrations/whatnot/schema';
import type { LedgerTransaction } from '../../src/lib/integrations/whatnot/reports';
export const actor = '11111111-1111-4111-8111-111111111111',
  sellerId = '1234567';
export const showId = '99999999-9999-4999-8999-999999999999';
export const moneyValue = (amount: string) => ({ amount, currency: 'USD' });
export function whatnotSource(id = '123456', sku: string | null = 'JACKET-1'): OrderSource {
  return {
    order: {
      id,
      status: 'pending_fulfillment',
      show_id: null,
      transaction_type: 'auction',
      created_at: '2026-11-10T12:00:00.000Z',
      updated_at: '2026-11-10T12:10:00.000Z',
      cancelled_at: null,
      amounts: {
        subtotal: moneyValue('45.00'),
        shipping: moneyValue('5.00'),
        tax: moneyValue('3.00'),
        total: moneyValue('51.00'),
        applied_discount: { type: 'fixed_price', amount: moneyValue('2.00') },
      },
    },
    items: [
      {
        id: `9${id}`,
        order_id: id,
        product_id: '4321',
        variant_id: null,
        product_external_id: null,
        variant_external_id: null,
        purchased_item: { title: 'Blue Carhartt Workwear Jacket', description: null, sku },
        quantity: 1,
        unit_price: moneyValue('45.00'),
        price_includes_tax: false,
        shipment_id: null,
      },
    ],
    shipments: [],
  };
}
export function whatnotEarnings(orderId = '123456'): LedgerTransaction {
  return {
    id: `ledger-${orderId}`,
    orderId,
    showId: null,
    sellerId,
    type: 'ORDER_EARNINGS',
    date: '2026-11-11T12:00:00.000Z',
    currency: 'USD',
    amount: 3675,
    earnings: {
      merchandise: 4500,
      discount: 200,
      netMerchandise: 4300,
      fees: 400,
      processing: 125,
      shipping: 100,
      quantity: 1,
      sku: 'JACKET-1',
      unitCost: 1200,
    },
  };
}
export const whatnotShow: SourceShow = {
  id: showId,
  title: 'Test vintage show',
  status: 'ended',
  scheduled_start_at: '2026-11-09T12:00:00.000Z',
  ended_at: '2026-11-09T13:00:00.000Z',
  created_at: '2026-11-01T12:00:00.000Z',
  updated_at: '2026-11-09T13:00:00.000Z',
};
export const whatnotAnalytics: ShowAnalytics = {
  show_id: showId,
  title: 'Test vintage show',
  start_time: '2026-11-09T12:01:00.000Z',
  calculation_status: 'GENERATED',
  sales: moneyValue('45.00'),
  estimated_earnings: moneyValue('36.75'),
  orders_count: 1,
  stream_minutes: 59,
  distinct_viewers_count: 20,
  max_concurrent_viewers: 10,
};
export const reportCsv =
  'transaction_completed_at_utc,seller_id,transaction_type,order_id,transaction_currency,transaction_amount,ledger_transaction_id,original_item_price,coupon_cost,post_coupon_price,commission_fee,commission_tax,processing_fee,processing_fee_tax,seller_shipping_charge,quantity_sold,sku,cost_of_goods,buyer_name\n2026-11-11 12:00:00,1234567,ORDER_EARNINGS,123456,USD,36.75,ledger-123456,45.00,-2.00,43.00,-4.00,0,-1.25,0,-1.00,1,JACKET-1,12.00,PRIVATE_BUYER';
