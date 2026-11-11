import 'server-only';
import { adminClient } from './server';
import { DatabaseReadinessError } from './config';
import { emptyWorkspace, workspaceSchema } from '../model';
export async function loadWorkspace(userId: string) {
  const client = adminClient();
  const { data: readiness, error: readinessError } = await client.rpc('verify_thrift_log');
  const checks = [
    'tablesPresent',
    'rlsEnabled',
    'clientWritesBlocked',
    'privatePhotosBucket',
    'serverRpcRestricted',
    'privatePhotoReadPolicy',
    'financialLedger',
    'shipmentStorage',
    'itemFulfillment',
    'inviteOnlyBeta',
  ];
  if (
    readinessError ||
    !readiness ||
    readiness.schemaVersion < 6 ||
    checks.some((key) => readiness[key] !== true)
  )
    throw new DatabaseReadinessError();
  const { data, error } = await client.rpc('load_workspace', { p_user_id: userId });
  if (error) throw new Error('Database unavailable. Check the migration and server configuration.');
  return data ? workspaceSchema.parse(data) : emptyWorkspace();
}
