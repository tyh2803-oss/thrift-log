import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminClient, authClient, checkOrigin } from '@/lib/supabase/server';
import { betaInviteRedirect, betaRole } from '@/lib/supabase/beta';
import { readConfiguration } from '@/lib/supabase/config';
import { registrationMode } from '@/lib/supabase/registration-config';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const denied =
  'Account creation could not be completed. Check your details or ask the owner to authorize your email. Already invited? Ask the owner to use Set up tester account for a private setup link. Existing users can sign in.';
const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(128)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72);
function reply(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers });
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new Error('Invalid body');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const mode = registrationMode();
    if (mode === 'disabled')
      return reply('Account creation is not enabled yet. Existing accounts can sign in.', 503);
    const config = readConfiguration(process.env);
    const body = z
      .object({
        email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
        password: z.string().max(500),
      })
      .parse(await boundedBody(request));
    // Only Vercel's overwritten client header is trusted. Other hosts share a fail-closed bucket.
    const candidate =
      process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.trim() : '';
    const clientAddress = candidate && isIP(candidate) ? candidate : 'shared-untrusted-client';
    const digest = (value: string) =>
      createHmac('sha256', config.serviceKey)
        .update(`thrift-registration:v1:${value}`)
        .digest('hex');
    const admin = adminClient();
    const { data: attempt, error: attemptError } = await admin.rpc('beta_begin_registration', {
      p_email: body.email,
      p_email_key: digest(`email:${body.email}`),
      p_client_key: digest(`client:${clientAddress}`),
      p_global_key: digest('global'),
    });
    if (attemptError || !attempt)
      return reply(
        'Account creation is temporarily unavailable. Ask the owner to check registration setup.',
        503,
      );
    if (attempt.status === 'limited')
      return NextResponse.json(
        { error: 'Too many attempts. Wait 15 minutes before trying again.' },
        { status: 429, headers: { ...headers, 'Retry-After': '900' } },
      );
    if (attempt.status === 'busy')
      return reply(
        'An account setup is already in progress. Wait two minutes, then try signing in.',
        409,
      );
    if (!['allowed', 'existing'].includes(attempt.status) || body.email === config.ownerEmail)
      return reply(denied);
    const cancel = async () => {
      if (attempt.token)
        await admin.rpc('beta_cancel_registration', {
          p_email: body.email,
          p_token: attempt.token,
        });
    };
    if (!passwordSchema.safeParse(body.password).success) {
      await cancel();
      return reply(
        `Use a password of at least ${MIN_PASSWORD_LENGTH} characters and no more than 72 UTF-8 bytes.`,
      );
    }
    // Resolve canonical redirect before creating an unconfirmed account.
    const emailRedirectTo = mode === 'email' ? betaInviteRedirect() : undefined;
    const client = await authClient({ writableCookies: true, request });
    if (attempt.status === 'allowed') {
      if (!z.uuid().safeParse(attempt.token).success)
        return reply('Account creation is temporarily unavailable.', 503);
      const { data, error } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: mode === 'preauthorized',
        app_metadata: {
          thrift_log_registration:
            mode === 'preauthorized'
              ? 'owner_preauthorized_without_email_proof'
              : 'email_confirmation_required',
        },
      });
      if (error || !data.user) {
        // No deletion or password reset, including duplicate/racing accounts and uncertain saves.
        if (error?.status && error.status >= 400 && error.status < 500) await cancel();
        return reply(
          error?.code === 'weak_password'
            ? 'Choose a stronger password that meets the account password policy.'
            : denied,
        );
      }
      const { data: linked, error: linkError } = await admin.rpc('beta_finish_registration', {
        p_email: body.email,
        p_token: attempt.token,
        p_user_id: data.user.id,
      });
      if (linkError || linked !== true)
        return reply(
          'Your account may have been created, but access could not be confirmed. Try signing in or ask the owner to check your authorization.',
          409,
        );
      if (mode === 'email') {
        const { error: mailError } = await client.auth.resend({
          type: 'signup',
          email: body.email,
          options: { emailRedirectTo },
        });
        return mailError
          ? reply(
              'Your account was created, but the confirmation email could not be sent. Ask the owner for setup help. Your password and records have not been replaced.',
              503,
            )
          : NextResponse.json(
              {
                ok: true,
                confirmationRequired: true,
                message: 'Check your email to confirm your account before signing in.',
              },
              { headers },
            );
      }
    }
    // Existing accounts must prove their current password. Never update or confirm them here.
    const { data, error } = await client.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error || !data.user) return reply(denied);
    try {
      await betaRole(data.user);
    } catch {
      await client.auth.signOut({ scope: 'local' });
      return reply(denied);
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    // Never return provider diagnostics, keys, passwords, claim tokens or other account details.
    return reply(denied);
  }
}
