import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminClient, requireOwner, checkOrigin } from '@/lib/supabase/server';
import { betaInviteRedirect } from '@/lib/supabase/beta';
import { testerSetupLink } from '@/lib/supabase/tester-setup';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
async function access(actor: string, email?: string, active?: boolean) {
  const { data, error } = await adminClient().rpc('beta_manage_access', {
    p_actor_id: actor,
    p_email: email ?? null,
    p_active: active ?? null,
  });
  if (error || !Array.isArray(data))
    throw new Error(
      'Beta access could not be saved or loaded. Check the beta migration and owner bootstrap.',
    );
  return data as { email: string; active: boolean; linked: boolean }[];
}
export async function GET() {
  try {
    const user = await requireOwner();
    return NextResponse.json({ testers: await access(user.id) }, { headers });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const owner = await requireOwner();
    if ((request.headers.get('x-thrift-user') || owner.id) !== owner.id)
      throw new Error('Unauthorized');
    const text = await request.text();
    if (text.length > 2000) throw new Error('Use one tester email at a time.');
    const body = z
      .object({
        action: z.enum(['authorize', 'revoke', 'invite', 'setup']),
        email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
      })
      .parse(JSON.parse(text));
    if (body.email === owner.email?.toLowerCase())
      throw new Error('The owner’s access is protected.');
    if (body.action === 'setup') {
      const link = await testerSetupLink(owner, body.email, request.headers.get('origin')!);
      return NextResponse.json(
        {
          testers: await access(owner.id),
          setup: { email: body.email, link },
          message:
            'Private one-use setup link created. Share it only with this tester. No password was changed.',
        },
        { headers: { ...headers, 'Referrer-Policy': 'no-referrer' } },
      );
    }
    if (body.action === 'invite') {
      const testers = await access(owner.id);
      if (!testers.some((t) => t.email === body.email && t.active))
        throw new Error('Authorize this tester before sending an invitation.');
      const { error } = await adminClient().auth.admin.inviteUserByEmail(body.email, {
        redirectTo: betaInviteRedirect(),
      });
      if (error)
        throw new Error(
          'Invitation was not confirmed. Existing accounts can sign in; check Supabase Auth invitation settings before retrying. Access authorization is unchanged.',
        );
      return NextResponse.json(
        {
          testers,
          message:
            'Invitation sent. The tester can choose their own password using the email link.',
        },
        { headers },
      );
    }
    const testers = await access(owner.id, body.email, body.action === 'authorize');
    return NextResponse.json(
      {
        testers,
        message:
          body.action === 'revoke'
            ? 'Access revoked. Business records are retained.'
            : 'Email authorized. Invite a new account or let an existing account sign in.',
      },
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  const denied = e instanceof Error && e.message === 'Unauthorized';
  return NextResponse.json(
    {
      error: denied
        ? 'Owner access required.'
        : e instanceof z.ZodError
          ? 'Enter a valid tester email.'
          : e instanceof Error
            ? e.message
            : 'Beta access request failed.',
    },
    { status: denied ? 403 : 400, headers },
  );
}
