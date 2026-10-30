import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import handler from '../api/[...path].js';
import adminLoginRoute from '../api/admin/login.js';
import adminAccountsRoute from '../api/admin/accounts.js';
import adminMetricsRoute from '../api/admin/metrics.js';
import updateAccountRoute from '../api/admin/accounts/[accountId].js';
import renewAccountRoute from '../api/admin/accounts/[accountId]/renew.js';
import clientStateRoute from '../api/client/state.js';
import clientAccountRoute from '../api/client/account.js';
import clientPasswordRequestRoute from '../api/client/password-request.js';
import adminPasswordRequestsRoute from '../api/admin/password-requests.js';
import reviewPasswordRequestRoute from '../api/admin/password-requests/[requestId].js';
import { aggregateDailyReport, aggregateMonthlyReport, renderDailyReportHtml, renderMonthlyReportHtml } from '../src/reports.js';

const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ALBAGMI_ADMIN_PASSWORD',
  'ALBAGMI_ADMIN_JWT_SECRET',
  'ALBAGMI_ALLOWED_ORIGINS'
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function setTestEnv() {
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.ALBAGMI_ADMIN_PASSWORD = 'test-only-strong-password';
  process.env.ALBAGMI_ADMIN_JWT_SECRET = 'test-jwt-secret-that-is-not-used-outside-tests';
  process.env.ALBAGMI_ALLOWED_ORIGINS = '*';
}

async function callApi(method, url, body, headers = {}) {
  const req = { method, url, headers, ...(body === undefined ? {} : { body }) };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; }
  };
  await handler(req, res);
  return { ...res, data: res.body ? JSON.parse(res.body) : null };
}

function withMockFetch(mock, fn) {
  const previous = global.fetch;
  global.fetch = mock;
  return Promise.resolve().then(fn).finally(() => { global.fetch = previous; });
}

const account = {
  id: 'account-1',
  auth_user_id: 'auth-user-1',
  username: 'office1',
  office_name: 'مكتب الاختبار',
  owner_name: 'صاحب الاختبار',
  phone: '0500000000',
  subscription_started_at: '2026-10-30T00:00:00.000Z',
  subscription_days: 30,
  subscription_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  is_active: true,
  login_count: 0,
  last_login_at: null,
  app_state: {}
};

test('health reports missing Vercel environment variables without leaking values', async () => {
  const original = snapshotEnv();
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    const response = await callApi('GET', '/api/health');
    assert.equal(response.statusCode, 503);
    assert.equal(response.data.error, 'server_configuration_missing');
    assert.ok(response.data.missing.includes('ALBAGMI_ADMIN_PASSWORD'));
    assert.equal(JSON.stringify(response.data).includes('test-only'), false);
  } finally {
    restoreEnv(original);
  }
});

test('health verifies Supabase Auth and both isolated albagmi tables', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const response = await withMockFetch(async (url, options = {}) => {
      if (String(url).endsWith('/auth/v1/settings')) return new Response('{}', { status: 200 });
      if (String(url).includes('/rest/v1/albagmi_accounts?select=id&limit=1') || String(url).includes('/rest/v1/albagmi_user_data?select=user_id&limit=1')) {
        assert.equal(options.headers?.apikey, 'test-service-role-key');
        assert.equal(options.headers?.Authorization, 'Bearer test-service-role-key');
        return new Response('[]', { status: 200 });
      }
      if (String(url).includes('/rest/v1/albagmi_site_visitors?select=visitor_id&limit=1') || String(url).includes('/rest/v1/albagmi_password_change_requests?select=id&limit=1')) return new Response('[]', { status: 200 });
      throw new Error(`Unexpected test URL: ${url}`);
    }, () => callApi('GET', '/api/health'));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.ok, true);
    assert.equal(response.data.supabase, 'connected');
  } finally {
    restoreEnv(original);
  }
});

test('admin logs in with a server-side password only; office login rejects admin role', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const admin = await callApi('POST', '/api/admin/login', { password: process.env.ALBAGMI_ADMIN_PASSWORD });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.data.role, 'admin');
    assert.ok(admin.data.token);

    const bypass = await callApi('POST', '/api/login', { role: 'admin', username: 'admin', password: process.env.ALBAGMI_ADMIN_PASSWORD });
    assert.equal(bypass.statusCode, 400);
    assert.equal(bypass.data.error, 'invalid_role');
    const missingRole = await callApi('POST', '/api/login', { username: 'office1', password: 'office-test-password' });
    assert.equal(missingRole.statusCode, 400);
    assert.equal(missingRole.data.error, 'invalid_role');
  } finally {
    restoreEnv(original);
  }
});

test('office login authenticates against Supabase Auth and the matching office row', async () => {
  const original = snapshotEnv();
  setTestEnv();
  let loginRpcCalls = 0;
  try {
    const response = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/albagmi_accounts?select=*&username=eq.office1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/auth/v1/token?grant_type=password')) return new Response(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', user: { id: 'auth-user-1' } }), { status: 200 });
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*&auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/rest/v1/rpc/albagmi_increment_login')) {
        loginRpcCalls += 1;
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { p_account_id: 'account-1' });
        return new Response('1', { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('POST', '/api/login', { role: 'client', username: 'office1', password: 'office-test-password' }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.role, 'client');
    assert.equal(response.data.account.officeName, 'مكتب الاختبار');
    assert.equal(response.data.token, 'test-access');
    assert.equal(response.data.userId, 'auth-user-1');
    assert.equal(loginRpcCalls, 1);
  } finally {
    restoreEnv(original);
  }
});

test('disabled offices cannot log in and do not increment login counts', async () => {
  const original = snapshotEnv();
  setTestEnv();
  const disabled = { ...account, is_active: false };
  let incremented = false;
  try {
    const response = await withMockFetch(async (url) => {
      const target = String(url);
      if (target.includes('username=eq.office1')) return new Response(JSON.stringify([disabled]), { status: 200 });
      if (target.includes('/auth/v1/token?grant_type=password')) return new Response(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', user: { id: 'auth-user-1' } }), { status: 200 });
      if (target.includes('auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([disabled]), { status: 200 });
      if (target.includes('/rpc/albagmi_increment_login')) { incremented = true; return new Response('1', { status: 200 }); }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('POST', '/api/login', { role: 'client', username: 'office1', password: 'office-test-password' }));
    assert.equal(response.statusCode, 403);
    assert.equal(response.data.error, 'account_disabled');
    assert.equal(incremented, false);
  } finally {
    restoreEnv(original);
  }
});

test('disabling an office blocks an already-issued Supabase session from reading state', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const response = await withMockFetch(async (url) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([{ ...account, is_active: false }]), { status: 200 });
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('GET', '/api/client/state', undefined, { authorization: 'Bearer existing-client-access-token' }));
    assert.equal(response.statusCode, 403);
    assert.equal(response.data.error, 'account_disabled');
  } finally {
    restoreEnv(original);
  }
});

test('admin can edit office fields, change username/password, and disable an account safely', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const admin = await callApi('POST', '/api/admin/login', { password: process.env.ALBAGMI_ADMIN_PASSWORD });
    let authPatch;
    let databasePatch;
    const updatedRow = { ...account, username: 'office2', office_name: 'مكتب محدث', owner_name: 'مالك محدث', phone: '0511111111', is_active: false, login_count: 3, last_login_at: new Date().toISOString() };
    const response = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('id=eq.account-1') && options.method !== 'PATCH') return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('username=eq.office2')) return new Response('[]', { status: 200 });
      if (target.includes('/auth/v1/admin/users/auth-user-1')) {
        assert.equal(options.method, 'PUT');
        authPatch = JSON.parse(options.body);
        assert.equal(options.headers?.Authorization, 'Bearer test-service-role-key');
        return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      }
      if (target.includes('id=eq.account-1') && options.method === 'PATCH') {
        databasePatch = JSON.parse(options.body);
        return new Response(JSON.stringify([updatedRow]), { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('PUT', '/api/admin/accounts/account-1', {
      username: 'office2', officeName: 'مكتب محدث', ownerName: 'مالك محدث', phone: '0511111111', isActive: false, password: 'new-office-pass-123',
    }, { authorization: `Bearer ${admin.data.token}` }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.username, 'office2');
    assert.equal(response.data.isActive, false);
    assert.equal(response.data.loginCount, 3);
    assert.equal(authPatch.email, 'office2@albagmi.local');
    assert.equal(authPatch.password, 'new-office-pass-123');
    assert.equal('password' in databasePatch, false);
    assert.equal('password' in response.data, false);
  } finally {
    restoreEnv(original);
  }
});

test('admin usage metrics count active, grace, disabled accounts and unique browsers', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const admin = await callApi('POST', '/api/admin/login', { password: process.env.ALBAGMI_ADMIN_PASSWORD });
    const rows = [
      { is_active: true, subscription_ends_at: new Date(Date.now() + 86400000).toISOString(), login_count: 2 },
      { is_active: true, subscription_ends_at: new Date(Date.now() - 86400000).toISOString(), login_count: 5 },
      { is_active: false, subscription_ends_at: new Date(Date.now() + 86400000).toISOString(), login_count: 7 },
    ];
    const response = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/albagmi_accounts?') && target.includes('login_count')) return new Response(JSON.stringify(rows), { status: 200 });
      if (target.includes('/rest/v1/albagmi_site_visitors?select=visitor_id')) {
        assert.equal(options.headers?.Prefer, 'count=exact');
        return new Response('[{"visitor_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]', { status: 200, headers: { 'Content-Range': '0-0/42' } });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('GET', '/api/admin/metrics', undefined, { authorization: `Bearer ${admin.data.token}` }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.totalAccounts, 3);
    assert.equal(response.data.activeAccounts, 1);
    assert.equal(response.data.graceAccounts, 1);
    assert.equal(response.data.disabledAccounts, 1);
    assert.equal(response.data.totalLogins, 14);
    assert.equal(response.data.uniqueVisitors, 42);
  } finally {
    restoreEnv(original);
  }
});

test('public visit registration stores only a validated random browser UUID', async () => {
  const original = snapshotEnv();
  setTestEnv();
  const visitorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    const response = await withMockFetch(async (url, options = {}) => {
      assert.ok(String(url).includes('/rest/v1/albagmi_site_visitors?on_conflict=visitor_id'));
      assert.equal(options.method, 'POST');
      assert.equal(options.headers?.Prefer, 'resolution=ignore-duplicates,return=minimal');
      assert.deepEqual(JSON.parse(options.body), { visitor_id: visitorId });
      return new Response(null, { status: 201 });
    }, () => callApi('POST', '/api/visit', { visitorId }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.data, { ok: true });
    const invalid = await callApi('POST', '/api/visit', { visitorId: 'not-a-uuid', ip: '192.0.2.1' });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.data.error, 'invalid_visitor_id');
  } finally {
    restoreEnv(original);
  }
});

test('client password requests are encrypted at rest and only applied after admin approval', async () => {
  const original = snapshotEnv();
  setTestEnv();
  let savedRequest;
  let appliedPassword;
  try {
    const clientResponse = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*&auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/rest/v1/albagmi_password_change_requests?select=id&')) return new Response('[]', { status: 200 });
      if (target.includes('/rest/v1/albagmi_password_change_requests?select=id,status,created_at')) {
        savedRequest = JSON.parse(options.body);
        return new Response(JSON.stringify([{ id: 'request-1', status: 'pending', created_at: new Date().toISOString() }]), { status: 201 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('POST', '/api/client/password-request', { password: 'new-password-secret-987' }, { authorization: 'Bearer client-token' }));
    assert.equal(clientResponse.statusCode, 201);
    assert.equal(clientResponse.data.request.status, 'pending');
    assert.equal(JSON.stringify(savedRequest).includes('new-password-secret-987'), false);
    assert.ok(savedRequest.password_ciphertext && savedRequest.password_iv && savedRequest.password_tag);

    const admin = await callApi('POST', '/api/admin/login', { password: process.env.ALBAGMI_ADMIN_PASSWORD });
    const approval = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/albagmi_password_change_requests?select=*&')) return new Response(JSON.stringify([savedRequest]), { status: 200 });
      if (target.includes('/auth/v1/admin/users/auth-user-1')) {
        appliedPassword = JSON.parse(options.body).password;
        return new Response('{}', { status: 200 });
      }
      if (target.includes('/rest/v1/albagmi_password_change_requests?id=eq.request-1')) {
        const patch = JSON.parse(options.body);
        assert.equal(patch.password_ciphertext, null);
        assert.equal(patch.password_iv, null);
        assert.equal(patch.password_tag, null);
        return new Response(JSON.stringify([{ id: 'request-1', status: 'approved', reviewed_at: patch.reviewed_at }]), { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('POST', '/api/admin/password-requests/request-1', { decision: 'approve' }, { authorization: `Bearer ${admin.data.token}` }));
    assert.equal(approval.statusCode, 200);
    assert.equal(approval.data.status, 'approved');
    assert.equal(appliedPassword, 'new-password-secret-987');
    assert.equal(JSON.stringify(approval.data).includes('new-password-secret-987'), false);
  } finally {
    restoreEnv(original);
  }
});

test('client can update only its authenticated office name', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const updated = { ...account, office_name: 'مكتب باسم جديد' };
    const response = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?id=eq.account-1')) {
        assert.equal(options.method, 'PATCH');
        assert.deepEqual(JSON.parse(options.body).office_name, 'مكتب باسم جديد');
        return new Response(JSON.stringify([updated]), { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('PATCH', '/api/client/account', { officeName: 'مكتب باسم جديد' }, { authorization: 'Bearer client-token' }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.officeName, 'مكتب باسم جديد');
    const deniedField = await withMockFetch(async (url) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('PATCH', '/api/client/account', { username: 'other-office' }, { authorization: 'Bearer client-token' }));
    assert.equal(deniedField.statusCode, 400);
  } finally {
    restoreEnv(original);
  }
});

test('admin hard delete requires the exact username and deletes the linked Auth user', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const admin = await callApi('POST', '/api/admin/login', { password: process.env.ALBAGMI_ADMIN_PASSWORD });
    const badConfirmation = await withMockFetch(async (url) => {
      if (String(url).includes('id=eq.account-1')) return new Response(JSON.stringify([account]), { status: 200 });
      throw new Error(`Unexpected test URL: ${url}`);
    }, () => callApi('DELETE', '/api/admin/accounts/account-1', { confirmUsername: 'wrong-name' }, { authorization: `Bearer ${admin.data.token}` }));
    assert.equal(badConfirmation.statusCode, 400);
    assert.equal(badConfirmation.data.error, 'delete_confirmation_mismatch');

    let authDeleted = false;
    const deleted = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('id=eq.account-1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.endsWith('/auth/v1/admin/users/auth-user-1')) {
        authDeleted = options.method === 'DELETE';
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('DELETE', '/api/admin/accounts/account-1', { confirmUsername: 'office1' }, { authorization: `Bearer ${admin.data.token}` }));
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.data.deleted, true);
    assert.equal(authDeleted, true);
  } finally {
    restoreEnv(original);
  }
});

test('Vercel rewrites the protected-looking /max route to the SPA entry only', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const publicRoutes = JSON.parse(await readFile(new URL('../public/manus-routes.json', import.meta.url), 'utf8'));
  assert.ok(config.rewrites.some((route) => route.source === '/max' && route.destination === '/'));
  assert.ok(config.rewrites.every((route) => route.source !== '/api/:path*'));
  assert.ok(publicRoutes.routes.every((route) => route.path !== '/max'));
});

test('Vercel has explicit entry points for every multi-segment API route', () => {
  for (const route of [adminLoginRoute, adminAccountsRoute, adminMetricsRoute, updateAccountRoute, renewAccountRoute, clientStateRoute, clientAccountRoute, clientPasswordRequestRoute, adminPasswordRequestsRoute, reviewPasswordRequestRoute]) {
    assert.equal(route, handler);
  }
});

test('office login form sends the client role required by the API', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /role: 'client', username: data\.get\('username'\), password: data\.get\('password'\)/);
});


test('client state reads and writes are scoped to the verified Supabase Auth UID', async () => {
  const original = snapshotEnv();
  setTestEnv();
  const savedState = { officeName: 'مكتب الاختبار', sites: [], transactions: [{ id: 't1' }], expenses: [] };
  let postedRecord;
  try {
    const response = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*&auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/rest/v1/albagmi_user_data?select=app_state&user_id=eq.auth-user-1')) return new Response(JSON.stringify([{ app_state: savedState }]), { status: 200 });
      if (target.includes('/rest/v1/albagmi_user_data?on_conflict=user_id&select=app_state')) {
        assert.equal(options.method, 'POST');
        postedRecord = JSON.parse(options.body);
        return new Response(JSON.stringify([{ app_state: postedRecord.app_state }]), { status: 201 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, async () => {
      const read = await callApi('GET', '/api/client/state', undefined, { authorization: 'Bearer test-access' });
      const write = await callApi('PUT', '/api/client/state', { appState: savedState, user_id: 'untrusted-other-user' }, { authorization: 'Bearer test-access' });
      return { read, write };
    });
    assert.equal(response.read.statusCode, 200);
    assert.equal(response.read.data.userId, 'auth-user-1');
    assert.deepEqual(response.read.data.appState, savedState);
    assert.equal(response.write.statusCode, 200);
    assert.equal(postedRecord.user_id, 'auth-user-1');
    assert.deepEqual(response.write.data.appState, savedState);
  } finally {
    restoreEnv(original);
  }
});

test('daily report totals include only the chosen date and render an A4 portrait report safely', () => {
  const transactions = [
    { dateKey: '2026-10-30', amount: 100, customer: '<script>alert(1)</script>', siteName: 'تأمين', createdAt: '2026-10-30T10:00:00Z' },
    { dateKey: '2026-10-30', amount: 25.5, customer: 'عميل 2', siteName: 'خدمة', createdAt: '2026-10-30T11:00:00Z' },
    { dateKey: '2026-10-29', amount: 900, customer: 'يوم سابق', siteName: 'خدمة', createdAt: '2026-10-29T11:00:00Z' }
  ];
  const expenses = [{ dateKey: '2026-10-30', amount: 10, description: 'مصاريف', createdAt: '2026-10-30T12:00:00Z' }];
  const report = aggregateDailyReport('2026-10-30', transactions, expenses);
  assert.equal(report.salesTotal, 125.5);
  assert.equal(report.expensesTotal, 10);
  assert.equal(report.net, 115.5);
  assert.equal(report.transactions.length, 2);
  const html = renderDailyReportHtml({ officeName: 'مكتب آمن', report });
  assert.match(html, /size: A4 portrait/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('monthly report summarizes every calendar day, including zero-sales days, on A4 landscape', () => {
  const transactions = [
    { dateKey: '2026-03-01', amount: 50 },
    { dateKey: '2026-03-02', amount: 25 },
    { dateKey: '2026-02-28', amount: 1000 }
  ];
  const expenses = [{ dateKey: '2026-03-02', amount: 10 }];
  const report = aggregateMonthlyReport('2026-03', transactions, expenses);
  assert.equal(report.days.length, 31);
  assert.equal(report.salesTotal, 75);
  assert.equal(report.expensesTotal, 10);
  assert.equal(report.net, 65);
  assert.equal(report.days[0].salesTotal, 50);
  assert.equal(report.days[1].net, 15);
  assert.equal(report.days[30].salesTotal, 0);
  const html = renderMonthlyReportHtml({ officeName: 'مكتب آمن', report });
  assert.match(html, /size: A4 landscape/);
  assert.match(html, /إجمالي مبيعات الشهر/);
});


test('office subscription starts when the system manager activates the account', async () => {
  const original = snapshotEnv();
  setTestEnv();
  const requestedDays = 14;
  const startBefore = Date.now();
  try {
    const admin = await callApi('POST', '/api/admin/login', { password: process.env.ALBAGMI_ADMIN_PASSWORD });
    assert.equal(admin.statusCode, 200);
    let inserted;
    const created = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/albagmi_accounts?select=*&username=eq.newoffice')) return new Response('[]', { status: 200 });
      if (target.endsWith('/auth/v1/admin/users') && options.method === 'POST') return new Response(JSON.stringify({ id: 'auth-new-office' }), { status: 201 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*') && options.method === 'POST') {
        inserted = JSON.parse(options.body);
        return new Response(JSON.stringify([{ ...inserted, created_at: inserted.subscription_started_at, updated_at: inserted.subscription_started_at }]), { status: 201 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('POST', '/api/admin/accounts', {
      username: 'newoffice', password: 'office-password-123', officeName: 'مكتب جديد', ownerName: 'المالك', phone: '0500000000', subscriptionDays: requestedDays
    }, { authorization: `Bearer ${admin.data.token}` }));
    const startedAt = Date.parse(inserted.subscription_started_at);
    const endsAt = Date.parse(inserted.subscription_ends_at);
    assert.equal(created.statusCode, 201);
    assert.ok(startedAt >= startBefore && startedAt <= Date.now());
    assert.equal(endsAt - startedAt, requestedDays * 86400000);
  } finally {
    restoreEnv(original);
  }
});
