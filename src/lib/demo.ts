import { emptyWorkspace, itemSchema, orderSchema, type Workspace } from './model';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const when = (days: number, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
export function demoWorkspace(): Workspace {
  const w = emptyWorkspace();
  w.locations = [
    {
      id: uid(901),
      name: 'Goodwill Bins',
      address: 'Portland, OR',
      latitude: null,
      longitude: null,
    },
    {
      id: uid(902),
      name: 'House of Vintage',
      address: 'Hawthorne Boulevard',
      latitude: null,
      longitude: null,
    },
  ];
  w.trips = [
    {
      id: uid(801),
      name: 'Sunday bins run',
      date: when(-18),
      locationId: uid(901),
      totalSpent: 9400,
      notes: 'Great denim finds. Bulk cost allocated across items.',
    },
  ];
  const products = [
    ['Vintage Levi’s 501 jeans', 'Levi’s', 'Denim', '32 × 30', 850, 4800, 'denim'],
    ['Carhartt Detroit jacket', 'Carhartt', 'Outerwear', 'L', 1800, 12500, 'jacket'],
    ['Nike embroidered crewneck', 'Nike', 'Sweatshirts', 'M', 650, 4200, 'sweater'],
    ['Ralph Lauren striped shirt', 'Ralph Lauren', 'Shirts', 'L', 500, 3600, 'shirt'],
    ['Patagonia fleece pullover', 'Patagonia', 'Outerwear', 'M', 1200, 6800, 'fleece'],
    ['Vintage graphic tee', 'Vintage', 'T-shirts', 'XL', 350, 3200, 'tee'],
    ['Dickies carpenter pants', 'Dickies', 'Pants', '34', 600, 4500, 'pants'],
    ['Adidas track jacket', 'Adidas', 'Outerwear', 'L', 800, 5400, 'track'],
  ] as const;
  for (let i = 0; i < 24; i++) {
    const p = products[i % products.length];
    w.items.push(
      itemSchema.parse({
        id: uid(i + 1),
        sku: `TL-${String(i + 1).padStart(4, '0')}`,
        title: p[0],
        brand: p[1],
        category: p[2],
        size: p[3],
        cost: p[4],
        asking: p[5],
        purchasedAt: when(-18 - i * 2),
        source: i % 2 ? 'House of Vintage' : 'Goodwill Bins',
        tripId: i < 8 ? uid(801) : null,
        status: i < 14 ? 'Sold' : i < 20 ? 'Listed' : 'Ready to List',
        createdAt: when(-18 - i * 2),
        storage: `Bin ${(i % 3) + 1}`,
        photos: [],
      }),
    );
  }
  const channels = ['Depop', 'eBay', 'Whatnot', 'Vinted'] as const;
  w.shows = [
    {
      id: uid(701),
      name: 'Sunday vintage club',
      date: when(4, 18),
      type: 'Whatnot',
      status: 'Planned',
      notes: 'Denim, cozy layers, and a few special finds.',
      externalId: '',
      durationMinutes: 0,
      lineup: [
        { itemId: uid(15), startingBid: 1500, presented: false },
        { itemId: uid(16), startingBid: 1000, presented: false },
      ],
      checklist: [
        { title: 'Photograph the lineup', done: true },
        { title: 'Prepare shipping station', done: false },
        { title: 'Share show link', done: false },
      ],
    },
    {
      id: uid(702),
      name: 'Fall layers & good finds',
      date: when(-5, 18),
      type: 'Whatnot',
      status: 'Ended',
      notes: '',
      externalId: '',
      lineup: [],
      checklist: [],
      durationMinutes: 120,
    },
  ];
  w.items[14].status = 'Reserved';
  w.items[15].status = 'Reserved';
  for (let i = 0; i < 14; i++) {
    const item = w.items[i];
    const market = channels[i % 4];
    w.orders.push(
      orderSchema.parse({
        id: uid(101 + i),
        marketplace: market,
        externalId: `DEMO-${101 + i}`,
        date: when(-Math.floor(i * 1.8)),
        showId: market === 'Whatnot' ? uid(702) : null,
        lines: [{ itemId: item.id, price: item.asking - (i % 3) * 200, costBasis: item.cost }],
        discount: 0,
        shippingCollected: 0,
        fees: Math.round(item.asking * 0.08),
        processing: 70,
        shipping: 0,
        packaging: 45,
        other: 0,
        refund: 0,
        feeCredit: 0,
        adjustment: 0,
        tips: 0,
        type: 'Sale',
        status: 'Completed',
        fulfillment: i < 2 ? 'Unfulfilled' : 'Shipped',
        payout: i < 3 ? 'Pending' : 'Paid',
        provenance: 'Fictional demo data',
        importKey: '',
      }),
    );
  }
  for (let i = 14; i < 20; i++)
    for (let j = 0; j < 2; j++)
      w.listings.push({
        id: uid(301 + i * 2 + j),
        itemId: uid(i + 1),
        marketplace: channels[(i + j) % 4],
        price: w.items[i].asking + j * 300,
        originalPrice: w.items[i].asking + j * 300,
        externalId: '',
        url: '',
        listedAt: when(-i),
        status: 'Active',
        format: 'Fixed price',
        lastSync: null,
      });
  w.expenses = [
    {
      id: uid(601),
      title: 'Shipping supplies',
      category: 'Supplies',
      amount: 1899,
      date: when(-7),
      showId: null,
      tripId: null,
    },
    {
      id: uid(602),
      title: 'Trip mileage',
      category: 'Travel',
      amount: 1240,
      date: when(-18),
      showId: null,
      tripId: uid(801),
    },
  ];
  for (let i = 0; i < 12; i++)
    w.sessions.push({
      id: uid(401 + i),
      category: categories[i % 3],
      subcategory: '',
      notes: 'Demo work session',
      showId: i % 3 === 2 ? uid(702) : null,
      tripId: null,
      locationId: null,
      state: 'Ended',
      segments: [{ start: when(-i * 2, 10), end: when(-i * 2, 11 + (i % 2)) }],
    });
  return w;
}
const categories = ['Buying', 'Listing', 'Selling'] as const;
