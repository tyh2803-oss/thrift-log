import { createClient } from '@supabase/supabase-js';
import { configurationStatus, readConfiguration } from '../src/lib/supabase/config.ts';
// Node >=22.18 strips TypeScript types. No credentials or user records are printed.
const status = configurationStatus(process.env);
if (!status.ready) {
  console.error('Supabase configuration is incomplete.');
  for (const name of status.missing) console.error(`Missing variable: ${name}`);
  for (const problem of status.problems) console.error(problem);
  process.exitCode = 1;
} else {
  const config = readConfiguration(process.env);
  const client = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let passed = true;
  const report = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) passed = false;
  };
  try {
    const { data, error } = await client.rpc('verify_thrift_log');
    report('Schema verification RPC is available', !error && !!data);
    if (!error && data) report('Financial ledger schema version', data.schemaVersion >= 3);
    if (!error && data)
      for (const key of [
        'tablesPresent',
        'rlsEnabled',
        'clientWritesBlocked',
        'privatePhotosBucket',
        'serverRpcRestricted',
        'privatePhotoReadPolicy',
        'financialLedger',
        'shipmentStorage',
      ])
        report(key, data[key] === true);
    const { data: bucket, error: bucketError } = await client.storage.getBucket('inventory-photos');
    report(
      'Private inventory photo storage is accessible',
      !bucketError && bucket?.public === false,
    );
    // Admin user lookup is read-only and reports presence only, never identifiers or credentials.
    let owner = null;
    for (let page = 1; page <= 100 && !owner; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
      if (error) break;
      owner = data.users.find((u) => u.email?.toLowerCase() === config.ownerEmail) || null;
      if (data.users.length < 100) break;
    }
    report('Owner authentication account exists', !!owner);
    if (owner) {
      const { data, error } = await client.rpc('load_workspace', { p_user_id: owner.id });
      report(
        'Owner workspace can be read (empty is valid)',
        !error && (data === null || typeof data === 'object'),
      );
    }
  } catch {
    console.error(
      'Verification could not reach Supabase. Check network access and secure environment settings.',
    );
    passed = false;
  }
  if (!passed) process.exitCode = 1;
}
