import { createHash } from 'node:crypto';
import { deletionChallenge, verifyDeletion } from '@/lib/integrations/ebay/notifications';
import { config } from '@/lib/integrations/ebay/config';
import { ebayRpc } from '@/lib/integrations/ebay/store';
import { json, body, failure } from '@/lib/integrations/ebay/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    return json({
      challengeResponse: deletionChallenge(
        new URL(request.url).searchParams.get('challenge_code') || '',
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const data = await verifyDeletion(
      await body(request),
      request.headers.get('x-ebay-signature') || '',
    );
    await ebayRpc('account_deletion', null, {
      environment: config().environment,
      seller_id: data.notification.data.userId,
      event_hash: createHash('sha256').update(data.notification.notificationId).digest('hex'),
    });
    return json({ accepted: true });
  } catch (e) {
    return failure(e);
  }
}
