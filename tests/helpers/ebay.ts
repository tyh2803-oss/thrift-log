import {
  orderSourceSchema,
  transactionSourceSchema,
  type OrderSource,
  type TransactionSource,
} from '../../src/lib/integrations/ebay/schema';
export const ebayActor = '11111111-1111-4111-8111-111111111111',
  ebaySeller = 'ebay-immutable-seller';
export const ebayAmount = (value: string) => ({ value, currency: 'USD' });
export function ebayOrder(overrides: Partial<OrderSource> = {}): OrderSource {
  return orderSourceSchema.parse({
    orderId: '12-34567-89012',
    sellerId: 'seller-display',
    creationDate: '2026-11-10T12:00:00.000Z',
    lastModifiedDate: '2026-11-11T12:00:00.000Z',
    orderPaymentStatus: 'PAID',
    orderFulfillmentStatus: 'NOT_STARTED',
    cancelStatus: { cancelState: 'NONE_REQUESTED' },
    lineItems: [
      {
        lineItemId: 'line-1',
        legacyItemId: 'listing-1',
        title: 'Carhartt work jacket',
        sku: 'JACKET-1',
        quantity: 1,
        lineItemCost: ebayAmount('45.00'),
        taxes: [{ amount: ebayAmount('3.00') }],
        ebayCollectAndRemitTaxes: [{ amount: ebayAmount('3.00') }],
      },
    ],
    pricingSummary: {
      priceSubtotal: ebayAmount('45.00'),
      priceDiscount: ebayAmount('-2.00'),
      deliveryCost: ebayAmount('5.00'),
      tax: ebayAmount('3.00'),
      total: ebayAmount('51.00'),
    },
    paymentSummary: {
      payments: [{ paymentStatus: 'PAID', paymentDate: '2026-11-10T12:00:00.000Z' }],
      refunds: [],
    },
    ...overrides,
  });
}
export function ebayTransaction(overrides: Partial<TransactionSource> = {}): TransactionSource {
  return transactionSourceSchema.parse({
    transactionId: 'tx-sale-1',
    transactionType: 'SALE',
    transactionDate: '2026-11-10T12:01:00.000Z',
    bookingEntry: 'CREDIT',
    amount: ebayAmount('42.75'),
    orderId: '12-34567-89012',
    totalFeeAmount: ebayAmount('5.25'),
    payoutId: 'payout-1',
    transactionStatus: 'PAYOUT',
    ...overrides,
  });
}
