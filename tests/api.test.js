import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import handler from '../api/[...path].js';
import adminLoginRoute from '../api/admin/login.js';
import adminAccountsRoute from '../api/admin/accounts.js';
import renewAccountRoute from '../api/admin/accounts/[accountId]/renew.js';
import clientStateRoute from '../api/client/state.js';
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
  } finally {
    restoreEnv(original);
  }
});

test('office login authenticates against Supabase Auth and the matching office row', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const response = await withMockFetch(async (url) => {
      const target = String(url);
      if (target.includes('/rest/v1/albagmi_accounts?select=*&username=eq.office1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/auth/v1/token?grant_type=password')) return new Response(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', user: { id: 'auth-user-1' } }), { status: 200 });
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*&auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('POST', '/api/login', { role: 'client', username: 'office1', password: 'office-test-password' }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.role, 'client');
    assert.equal(response.data.account.officeName, 'مكتب الاختبار');
    assert.equal(response.data.token, 'test-access');
    assert.equal(response.data.userId, 'auth-user-1');
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
  for (const route of [adminLoginRoute, adminAccountsRoute, renewAccountRoute, clientStateRoute]) {
    assert.equal(route, handler);
  }
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
