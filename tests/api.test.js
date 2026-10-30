import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import handler from '../api/[...path].js';

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

test('health verifies Supabase Auth and the isolated account table', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const response = await withMockFetch(async (url) => {
      if (String(url).endsWith('/auth/v1/settings')) return new Response('{}', { status: 200 });
      if (String(url).includes('/rest/v1/albagmi_accounts?select=id&limit=1')) return new Response('[]', { status: 200 });
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
