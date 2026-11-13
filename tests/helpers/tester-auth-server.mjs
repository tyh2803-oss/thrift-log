// Loopback-only Auth service double for browser tests. Never forwards requests to Supabase.
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
const port = Number(process.env.TESTER_AUTH_PORT || 3172);
const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  friend: '22222222-2222-4222-8222-222222222222',
  friend2: '33333333-3333-4333-8333-333333333333',
};
let users, workspaces, sessions, links, metrics;
const workspace = (name) => ({
  revision: 1,
  imports: [],
  financialEvents: [],
  payouts: [],
  shipments: [],
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      sku: 'RETAINED-1',
      title: name,
      cost: 1200,
      asking: 4500,
      purchasedAt: '2026-11-01T12:00:00Z',
      createdAt: '2026-11-01T12:00:00Z',
      status: 'Listed',
      photos: [],
    },
  ],
  listings: [],
  orders: [],
  expenses: [],
  locations: [],
  trips: [],
  shows: [],
  sessions: [],
  settings: {},
});
function reset() {
  users = new Map([
    [
      ids.owner,
      {
        id: ids.owner,
        email: 'owner@example.test',
        password: 'Owner123',
        email_confirmed_at: '2026-11-01T12:00:00Z',
        active: true,
      },
    ],
    [
      ids.friend,
      {
        id: ids.friend,
        email: 'friend@example.test',
        password: '',
        email_confirmed_at: null,
        invited_at: '2026-11-02T12:00:00Z',
        active: true,
      },
    ],
    [
      ids.friend2,
      {
        id: ids.friend2,
        email: 'friend2@example.test',
        password: '',
        email_confirmed_at: null,
        invited_at: '2026-11-02T12:00:00Z',
        active: true,
      },
    ],
  ]);
  workspaces = new Map([
    [ids.owner, workspace('Owner private jacket')],
    [ids.friend, workspace('Friend retained jacket')],
    [ids.friend2, workspace('Second friend retained shirt')],
  ]);
  sessions = new Map();
  links = new Map();
  metrics = { generatedFor: [], passwordUpdates: [], businessWrites: 0, unexpectedWrites: 0 };
}
reset();
function safeUser(user) {
  return {
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
    invited_at: user.invited_at,
  };
}
function token(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const access = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, exp, session_id: randomUUID() })}.synthetic-signature`;
  sessions.set(access, user);
  return {
    access_token: access,
    refresh_token: randomUUID(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: safeUser(user),
  };
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const send = (data, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  };
  let body = {};
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > (process.env.HISTORY_BROWSER_WRITES === '1' ? 8_000_000 : 100_000))
        throw new Error('Test request too large');
    }
    if (raw) body = JSON.parse(raw);
    if (url.pathname === '/__health') return send({ ready: true });
    if (url.pathname === '/__reset' && request.method === 'POST') {
      reset();
      return send({ ok: true });
    }
    if (url.pathname === '/__metrics')
      return send({
        ...metrics,
        users: [...users.values()].map(safeUser),
        workspaces: Object.fromEntries(workspaces),
      });
    const bearer = (request.headers.authorization || '').replace(/^Bearer /, '');
    const current = sessions.get(bearer);
    if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
      const user = [...users.values()].find(
        (u) => u.email === body.email && u.password === body.password && u.email_confirmed_at,
      );
      return user
        ? send(token(user))
        : send({ msg: 'Invalid login credentials', code: 'invalid_credentials' }, 400);
    }
    if (url.pathname === '/auth/v1/user' && request.method === 'GET')
      return current ? send(safeUser(current)) : send({ msg: 'Unauthorized' }, 401);
    if (url.pathname === '/auth/v1/user' && request.method === 'PUT') {
      if (!current || !current.email_confirmed_at) return send({ msg: 'Unauthorized' }, 401);
      if (typeof body.password !== 'string' || body.password.length < 8)
        return send({ msg: 'Weak password', code: 'weak_password' }, 422);
      current.password = body.password;
      metrics.passwordUpdates.push(current.id);
      return send(safeUser(current));
    }
    if (url.pathname === '/auth/v1/logout') {
      sessions.delete(bearer);
      response.writeHead(204);
      return response.end();
    }
    if (url.pathname === '/auth/v1/admin/users' && request.method === 'GET') {
      if (bearer !== 'test-server-key') return send({ msg: 'Unauthorized' }, 403);
      return send({
        users: [...users.values()].map(safeUser),
        aud: 'authenticated',
        total: users.size,
      });
    }
    if (url.pathname === '/auth/v1/admin/generate_link' && request.method === 'POST') {
      if (bearer !== 'test-server-key' || body.type !== 'recovery')
        return send({ msg: 'Unauthorized' }, 403);
      const user = [...users.values()].find((u) => u.email === body.email);
      if (!user) return send({ msg: 'User not found' }, 404);
      for (const [value, existing] of links) if (existing.id === user.id) links.delete(value);
      const hash = randomBytes(32).toString('hex');
      links.set(hash, user);
      metrics.generatedFor.push(user.id);
      return send({
        ...safeUser(user),
        action_link: 'http://127.0.0.1/unused-provider-link',
        email_otp: '999999',
        hashed_token: hash,
        verification_type: 'recovery',
        redirect_to: 'http://127.0.0.1',
      });
    }
    if (url.pathname === '/auth/v1/verify' && request.method === 'POST') {
      const user = body.type === 'recovery' ? links.get(body.token_hash) : null;
      if (!user) return send({ msg: 'Invalid or used token', code: 'otp_expired' }, 403);
      links.delete(body.token_hash);
      if (!user.email_confirmed_at) {
        user.email_confirmed_at = '2026-11-11T12:00:00Z';
        user.password = '';
      }
      return send(token(user));
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (bearer !== 'test-server-key') return send({ message: 'Denied' }, 403);
      const name = url.pathname.split('/').at(-1);
      const actor = users.get(body.p_user_id || body.p_actor_id);
      // Existing browser suites model the optional integration as not migrated.
      // Only its status lookup is read-only; unexpected mutations remain guarded below.
      if (name === 'whatnot_admin' && body.p_action === 'status')
        return send(
          { code: 'PGRST202', message: 'Optional Whatnot migration is not installed' },
          404,
        );
      if (name === 'beta_check_access')
        return send(
          actor?.active && actor.email_confirmed_at
            ? actor.id === ids.owner
              ? 'owner'
              : 'tester'
            : null,
        );
      if (name === 'beta_manage_access') {
        if (!actor || actor.id !== ids.owner || !actor.active)
          return send({ message: 'Denied' }, 403);
        if (body.p_email) {
          const tester = [...users.values()].find(
            (u) => u.email === body.p_email && u.id !== ids.owner,
          );
          if (!tester) return send({ message: 'Unknown synthetic tester' }, 400);
          tester.active = body.p_active;
        }
        return send(
          [...users.values()]
            .filter((u) => u.id !== ids.owner)
            .map((u) => ({ email: u.email, active: u.active, linked: true })),
        );
      }
      if (name === 'verify_thrift_log')
        return send({
          schemaVersion: 7,
          inviteOnlyBeta: true,
          betaOwnerConfigured: true,
          betaRegistration: true,
          tablesPresent: true,
          rlsEnabled: true,
          clientWritesBlocked: true,
          privatePhotosBucket: true,
          serverRpcRestricted: true,
          privatePhotoReadPolicy: true,
          financialLedger: true,
          shipmentStorage: true,
          itemFulfillment: true,
        });
      if (name === 'load_workspace')
        return actor?.active && actor.email_confirmed_at
          ? send(workspaces.get(actor.id))
          : send({ message: 'Denied' }, 403);
      if (name === 'commit_workspace') {
        metrics.businessWrites++;
        // Explicit, loopback-only history test mode. The account-setup suite still rejects all writes.
        if (
          process.env.HISTORY_BROWSER_WRITES === '1' &&
          actor?.active &&
          actor.email_confirmed_at
        ) {
          const current = workspaces.get(actor.id);
          if (body.p_expected_revision !== current.revision)
            return send({ message: 'revision_conflict' }, 409);
          const next = { ...body.p_payload, revision: current.revision + 1 };
          workspaces.set(actor.id, next);
          return send(next.revision);
        }
        return send({ message: 'Browser setup must not write business records' }, 400);
      }
    }
    if (request.method !== 'GET') metrics.unexpectedWrites++;
    return send({ message: 'Unexpected test service request' }, 404);
  } catch {
    return send({ message: 'Synthetic service request failed' }, 500);
  }
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
