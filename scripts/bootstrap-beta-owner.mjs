import { createClient } from '@supabase/supabase-js';
import { readConfiguration } from '../src/lib/supabase/config.ts';
// Read-only by default. No Auth users, business rows, credentials or passwords are created/changed.
try {
  const config = readConfiguration(process.env);
  const apply = process.argv.includes('--apply');
  const target = process.argv
    .find((arg) => arg.startsWith('--project-url='))
    ?.slice('--project-url='.length);
  if (apply && target !== config.url)
    throw new Error(
      'Supply --project-url=<exact configured Supabase URL> after approving the migration and owner bootstrap.',
    );
  const client = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ready, error: readinessError } = await client.rpc('verify_thrift_log');
  if (readinessError || ready?.schemaVersion < 6 || !ready?.inviteOnlyBeta)
    throw new Error('Apply and verify the invite-only beta migration first.');
  let owner = null;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error('Could not inspect existing Auth accounts.');
    owner = data.users.find((user) => user.email?.toLowerCase() === config.ownerEmail) || null;
    if (owner || data.users.length < 100) break;
  }
  if (!owner?.email_confirmed_at)
    throw new Error(
      'The existing OWNER_EMAIL account must exist and have a verified email. No account was created.',
    );
  if (!apply) {
    console.log('Verified existing owner found. Read-only check complete; nothing changed.');
    console.log(
      'After explicit approval, rerun with --apply --project-url=<exact configured Supabase URL>.',
    );
  } else {
    const { error } = await client.rpc('beta_bootstrap_owner', { p_user_id: owner.id });
    if (error)
      throw new Error(
        'Owner bootstrap was not confirmed. Inspect existing owner configuration; no business records were targeted.',
      );
    const { data: role, error: checkError } = await client.rpc('beta_check_access', {
      p_user_id: owner.id,
    });
    if (checkError || role !== 'owner')
      throw new Error('Owner bootstrap verification failed. Do not deploy.');
    console.log(
      'Existing owner authorized and verified. Business records and Auth credentials were unchanged.',
    );
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Beta owner setup failed.');
  process.exitCode = 1;
}
