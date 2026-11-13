import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
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
import { aggregateDailyReport, aggregateMonthlyReport, aggregateRangeReport, renderDailyReportHtml, renderMonthlyReportHtml, renderRangeReportHtml } from '../src/reports.js';
import { buildOfficeWhatsappUrl, normalizeWhatsappNumber, publicServiceCount, renderPublicOfficePage } from '../src/public-page.js';
import { bankBalance, bankLedger, bankMovementTotals, filterBankLedger } from '../src/banks.js';
import { renderPaymentMethodFields } from '../src/bank-view.js';
import { extractScannerFields, normalizeOcrText } from '../src/scanner-text.js';

const require = createRequire(import.meta.url);
const { exportScannerImage, prepareScannerOcrInput } = require('../electron/scanner-formats.cjs');
const { bridgeNodeWorkerOnError } = require('../electron/tesseract-worker-compat.cjs');
const { PDFDocument } = require('pdf-lib');

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
  public_slug: 'office1',
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
      if (String(url).includes('/rest/v1/albagmi_accounts?select=id%2Cpublic_slug&limit=1') || String(url).includes('/rest/v1/albagmi_user_data?select=user_id&limit=1')) {
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

test('public service buttons use the office account WhatsApp phone and include the selected service', () => {
  assert.equal(normalizeWhatsappNumber('٠٥٠٠٠٠٠٠٠٠'), '966500000000');
  const url = new URL(buildOfficeWhatsappUrl('0500000000', 'مكتب تجريبي', 'نقل ملكية السيارات'));
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.pathname, '/966500000000');
  assert.match(decodeURIComponent(url.searchParams.get('text')), /نقل ملكية السيارات/);
  assert.match(decodeURIComponent(url.searchParams.get('text')), /مكتب تجريبي/);
  assert.equal(publicServiceCount(), 24);
  const html = renderPublicOfficePage({ officeName: 'مكتب <اختبار>', phone: '0500000000', officeLocation: 'https://maps.app.goo.gl/example' });
  assert.match(html, /مكتب &lt;اختبار&gt;/);
  assert.match(html, /wa\.me\/966500000000/);
  assert.match(html, /maps\.app\.goo\.gl\/example/);
  assert.doesNotMatch(html, /0500000001/);
});

test('public office endpoint exposes only office name, saved phone and safe map link without saving requests', async () => {
  const original = snapshotEnv();
  setTestEnv();
  const privateMarker = 'DO_NOT_EXPOSE_PRIVATE_SALES';
  try {
    const response = await withMockFetch(async (url, options = {}) => {
      const target = new URL(String(url));
      if (target.pathname === '/rest/v1/albagmi_accounts') {
        assert.equal(target.searchParams.get('public_slug'), 'eq.office1');
        assert.equal(target.searchParams.get('limit'), '1');
        assert.equal(target.searchParams.get('select'), 'public_slug,auth_user_id,office_name,phone,is_active');
        assert.equal(options.method, undefined);
        return new Response(JSON.stringify([{ public_slug: 'office1', auth_user_id: 'auth-user-1', office_name: 'مكتب الاختبار', phone: '0500000000', is_active: true }]), { status: 200 });
      }
      if (target.pathname === '/rest/v1/albagmi_user_data') {
        assert.equal(target.searchParams.get('user_id'), 'eq.auth-user-1');
        assert.equal(target.searchParams.get('limit'), '1');
        return new Response(JSON.stringify([{ app_state: { officeLocation: 'https://maps.app.goo.gl/example', transactions: [{ note: privateMarker }] } }]), { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('GET', '/api/public-page/office1'));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.data, { publicSlug: 'office1', officeName: 'مكتب الاختبار', phone: '0500000000', officeLocation: 'https://maps.app.goo.gl/example' });
    assert.equal(JSON.stringify(response.data).includes(privateMarker), false);
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

test('authenticated office can read its own public page slug', async () => {
  const original = snapshotEnv();
  setTestEnv();
  try {
    const response = await withMockFetch(async (url) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*&auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      throw new Error(`Unexpected test URL: ${target}`);
    }, () => callApi('GET', '/api/client/account', undefined, { authorization: 'Bearer client-token' }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.publicSlug, 'office1');
    assert.equal(response.data.phone, account.phone);
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

test('client state API requires the saved deletion password before removing transactions or expenses', async () => {
  const original = snapshotEnv();
  setTestEnv();
  const password = 'delete-me-123';
  const salt = '0123456789abcdef0123456789abcdef';
  const previousState = {
    officeName: 'مكتب الاختبار', sites: [],
    transactions: [{ id: 'txn-protected', amount: 20 }], expenses: [{ id: 'exp-protected', amount: 5 }],
    recordDeletionProtection: { salt, hash: pbkdf2Sync(password, Buffer.from(salt, 'hex'), 160000, 32, 'sha256').toString('hex'), iterations: 160000 }
  };
  let writeCount = 0;
  let currentState = { ...previousState, recordDeletionProtection: undefined };
  try {
    const result = await withMockFetch(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'auth-user-1' }), { status: 200 });
      if (target.includes('/rest/v1/albagmi_accounts?select=*&auth_user_id=eq.auth-user-1')) return new Response(JSON.stringify([account]), { status: 200 });
      if (target.includes('/rest/v1/albagmi_user_data?select=app_state&user_id=eq.auth-user-1')) return new Response(JSON.stringify([{ app_state: currentState }]), { status: 200 });
      if (target.includes('/rest/v1/albagmi_user_data?on_conflict=user_id&select=app_state')) {
        writeCount += 1;
        currentState = JSON.parse(options.body).app_state;
        return new Response(JSON.stringify([{ app_state: currentState }]), { status: 201 });
      }
      throw new Error(`Unexpected test URL: ${target}`);
    }, async () => {
      const appState = { ...previousState, transactions: [], expenses: [] };
      const unconfigured = await callApi('PUT', '/api/client/state', { appState }, { authorization: 'Bearer test-access' });
      currentState = previousState;
      const wrong = await callApi('PUT', '/api/client/state', { appState, deletionPassword: 'wrong-password' }, { authorization: 'Bearer test-access' });
      const correct = await callApi('PUT', '/api/client/state', { appState, deletionPassword: password }, { authorization: 'Bearer test-access' });
      return { unconfigured, wrong, correct };
    });
    assert.equal(result.unconfigured.statusCode, 403);
    assert.equal(result.unconfigured.data.error, 'record_deletion_password_required');
    assert.equal(result.wrong.statusCode, 403);
    assert.equal(result.wrong.data.error, 'invalid_record_deletion_password');
    assert.equal(result.correct.statusCode, 200);
    assert.equal(writeCount, 1);
    assert.deepEqual(result.correct.data.appState.transactions, []);
  } finally {
    restoreEnv(original);
  }
});

test('daily report totals include only the chosen date and render an A4 portrait report safely', () => {
  const transactions = [
    { dateKey: '2026-10-30', amount: 100, costAmount: 40, siteName: '<script>alert(1)</script>', createdAt: '2026-10-30T10:00:00Z' },
    { dateKey: '2026-10-30', amount: 25.5, siteName: 'خدمة', createdAt: '2026-10-30T11:00:00Z' },
    { dateKey: '2026-10-29', amount: 900, customer: 'يوم سابق', siteName: 'خدمة', createdAt: '2026-10-29T11:00:00Z' }
  ];
  const expenses = [{ dateKey: '2026-10-30', amount: 10, description: 'مصاريف', createdAt: '2026-10-30T12:00:00Z' }];
  const report = aggregateDailyReport('2026-10-30', transactions, expenses);
  assert.equal(report.salesTotal, 125.5);
  assert.equal(report.transactionCostsTotal, 40);
  assert.equal(report.transactionProfit, 85.5);
  assert.equal(report.expensesTotal, 10);
  assert.equal(report.net, 75.5);
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
  assert.match(html, /إيراد البيع/);
});

test('custom report date ranges include only the selected records and escape printed details', () => {
  const transactions = [
    { dateKey: '2026-03-02', amount: 50, siteName: '<b>عميل</b>', createdAt: '2026-03-02T09:00:00Z' },
    { dateKey: '2026-03-04', amount: 25, customer: 'عميل 2', siteName: 'نجم', createdAt: '2026-03-04T10:00:00Z' },
    { dateKey: '2026-03-05', amount: 500, customer: 'خارج الفترة', siteName: 'خدمة', createdAt: '2026-03-05T10:00:00Z' }
  ];
  const expenses = [{ dateKey: '2026-03-03', amount: 10, description: 'وقود', createdAt: '2026-03-03T11:00:00Z' }];
  const report = aggregateRangeReport('2026-03-02', '2026-03-04', transactions, expenses);
  assert.equal(report.days.length, 3);
  assert.equal(report.transactions.length, 2);
  assert.equal(report.salesTotal, 75);
  assert.equal(report.expensesTotal, 10);
  assert.equal(report.net, 65);
  const html = renderRangeReportHtml({ officeName: 'مكتب آمن', report });
  assert.match(html, /size: A4 landscape/);
  assert.match(html, /&lt;b&gt;عميل&lt;\/b&gt;/);
  assert.equal(html.includes('خارج الفترة'), false);
  assert.throws(() => aggregateRangeReport('2026-03-04', '2026-03-02'), /invalid_report_range/);
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
    assert.match(inserted.public_slug, /^office-[0-9a-f]{16}$/);
    assert.ok(startedAt >= startBefore && startedAt <= Date.now());
    assert.equal(endsAt - startedAt, requestedDays * 86400000);
  } finally {
    restoreEnv(original);
  }
});

test('Desktop packaging, browser tabs, and service persistence use the intended platform behavior', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const electronMain = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  assert.equal(packageJson.version, '0.1.23');
  assert.deepEqual(packageJson.build.publish[0], { provider: 'github', owner: 'macs191', repo: 'albagmi', releaseType: 'release' });
  assert.doesNotMatch(appSource, /تثبيت Windows|ServiceHub-Desktop-0\.1\.6-Setup\.exe/);
  assert.match(appSource, /data-nav="notepad"/);
  assert.match(appSource, /data-nav="scanner"/);
  assert.match(appSource, /data-save-scan/);
  assert.match(appSource, /data-print-scan/);
  assert.match(appSource, /recognizeScannerText\(id, scannerOcrLanguage\)/);
  assert.doesNotMatch(appSource, /createWorker\(|cdn\.jsdelivr\.net|tessdata\.projectnaptha/);
  assert.match(appSource, /function openGoogleSearch\(query\)/);
  assert.match(appSource, /id="googleSearchButton"/);
  assert.match(appSource, /event\.key === 'Enter'.*openGoogleSearch/s);
  assert.match(electronMain, /scanner:recognize-text/);
  assert.match(electronMain, /createWorker\(language/);
  assert.match(electronMain, /supportedLanguages = new Set\(\['ara\+eng', 'ara', 'eng'\]\)/);
  assert.match(electronMain, /langPath: path\.join\(__dirname, '\.\.', 'dist', 'tesseract', 'tessdata'\)/);
  assert.match(electronMain, /cacheMethod: 'none'/);
  assert.match(electronMain, /prepareScannerOcrInput\(file, resizeScannerImageWithWindows\)/);
  assert.match(electronMain, /worker\.worker\.once\('error'/);
  assert.match(electronMain, /bridgeNodeWorkerOnError\(\)/);
  assert.match(electronMain, /2200\.0 \/ \[Math\]::Max/);
  assert.match(preload, /recognizeScannerText/);
  assert.match(preload, /onScannerOcrProgress/);
  const ocrAssetsScript = await readFile(new URL('../scripts/prepare-ocr-assets.mjs', import.meta.url), 'utf8');
  assert.match(packageJson.scripts.build, /prepare:ocr-assets/);
  assert.match(packageJson.scripts['package:win'], /prepare:ocr-assets/);
  assert.match(ocrAssetsScript, /@tesseract\.js-data\/\$\{lang\}\/4\.0\.0_best_int/);
  assert.match(electronMain, /scanner:recognize-text/);
  assert.match(appSource, /documentRecord\.text = normalizeOcrText\(result\.text\)/);
  assert.match(appSource, /function renderScannerFields\(text\)/);
  assert.match(appSource, /data-copy-scanner-field/);
  assert.match(appSource, /scannerOcrLanguage/);
  assert.match(electronMain, /autoUpdater\.autoDownload = true/);
  assert.match(electronMain, /autoUpdater\.autoInstallOnAppQuit = true/);
  assert.match(electronMain, /checkForUpdates\(\)/);
  assert.match(electronMain, /quitAndInstall/);
  assert.match(electronMain, /download-progress/);
  assert.match(electronMain, /update-status/);
  assert.match(electronMain, /install-update/);
  assert.match(appSource, /data-install-update/);
  assert.match(appSource, /update-progress/);
  assert.match(workflow, /v0\.1\.23/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /\.blockmap/);
  assert.match(appSource, /data-nav="debts"/);
  assert.match(appSource, /data-nav="invoices"/);
  assert.doesNotMatch(appSource, /data-open-whatsapp|WHATSAPP_WEB|web\.whatsapp\.com/);
  assert.match(appSource, /function renderDebts\(\)/);
  assert.match(appSource, /function renderInvoices\(\)/);
  assert.match(appSource, /function amountInArabic\(amount\)/);
  assert.match(appSource, /servicehub-desktop-\$\{name\}-v1/);
  assert.match(appSource, /data-print-invoice/);
  assert.ok(appSource.includes('توقيع ${escapeHtml(officeName)}'));
  assert.match(appSource, /servicehub-notepad-v1/);
  assert.match(packageJson.scripts['package:win'], /vite build --base=\.\//);
  assert.match(packageJson.scripts['package:win'], /--win nsis --publish never/);
  assert.match(packageJson.scripts.desktop, /vite build --base=\.\//);
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.match(appSource, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.match(appSource, /syncSiteTabs\(openSiteTabs, null, null\)/);
  assert.match(appSource, /new ResizeObserver\(scheduleDesktopSiteSync\)/);
  assert.match(appSource, /addEventListener\('resize', scheduleDesktopSiteSync/);
  assert.match(appSource, /Math\.max\(rect\.width, window\.innerWidth - rect\.left\)/);
  assert.match(electronMain, /persist:servicehub-sites/);
  assert.match(electronMain, /WIA\.CommonDialog/);
  assert.match(electronMain, /scannerImagePath/);
  assert.match(electronMain, /exportScannerImage/);
  assert.match(electronMain, /pageSize: 'A4'/);
  assert.match(preload, /exportScannerDocument/);
  assert.match(preload, /printScannerDocument/);
  assert.match(electronMain, /backgroundThrottling: false/);
  assert.match(electronMain, /setAudioMuted\(false\)/);
  assert.doesNotMatch(electronMain, /WhatsApp|whatsapp|isWhatsAppUrl|setPermissionRequestHandler/);
  assert.match(electronMain, /safeStorage\.encryptString/);
  assert.match(electronMain, /safeStorage\.decryptString/);
  assert.match(preload, /getRememberedLogin/);
  assert.match(preload, /saveRememberedLogin/);
  assert.match(appSource, /تعذر الدخول تلقائيًا بالبيانات المحفوظة/);
  assert.match(electronMain, /did-fail-load/);
  assert.match(electronMain, /تعذر الاتصال بموقع الخدمة/);
});

test('scanner export creates valid JPEG, PNG, BMP, TIFF, WebP and single-page PDF files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servicehub-scanner-test-'));
  try {
    const input = join(directory, 'source.jpg');
    const rawPixels = Buffer.from([240, 35, 35, 35, 220, 90, 30, 80, 230, 255, 255, 255, 20, 20, 20, 90, 180, 130]);
    await sharp(rawPixels, { raw: { width: 3, height: 2, channels: 3 } }).jpeg({ quality: 90 }).toFile(input);
    const signatures = { jpeg: [0xff, 0xd8], png: [0x89, 0x50, 0x4e, 0x47], bmp: [0x42, 0x4d], webp: [0x52, 0x49, 0x46, 0x46] };
    for (const format of ['jpeg', 'png', 'bmp', 'tiff', 'webp']) {
      const output = join(directory, `scan.${format}`);
      await exportScannerImage(input, output, format);
      const bytes = await readFile(output);
      assert.ok(bytes.length > 54, `${format} output should not be empty`);
      if (signatures[format]) assert.deepEqual([...bytes.subarray(0, signatures[format].length)], signatures[format], `${format} signature`);
      if (format === 'webp') assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
      if (format === 'bmp') { assert.equal(bytes.readInt32LE(18), 3); assert.equal(bytes.readInt32LE(22), 2); }
      if (format === 'tiff') assert.ok(bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])));
    }
    const pdfPath = join(directory, 'scan.pdf');
    await exportScannerImage(input, pdfPath, 'pdf');
    const pdf = await PDFDocument.load(await readFile(pdfPath));
    assert.equal(pdf.getPageCount(), 1);
    assert.ok((await readFile(pdfPath)).subarray(0, 5).equals(Buffer.from('%PDF-')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('OCR keeps detected line order, cleans bidi artifacts and converts Arabic digits to English', () => {
  const input = '\u200fرقم الهوية: ١٢٣٤٥٦٧٨٩٠\r\nتاريخ الميلاد: ۱۴۰۲ / ٠٥ / ٢١\n\n\nالاسم: محمد   أحمد';
  assert.equal(normalizeOcrText(input), 'رقم الهوية: 1234567890\nتاريخ الميلاد: 1402 / 05 / 21\n\nالاسم: محمد أحمد');
});

test('identity OCR extracts only ID number, birth date and labeled serial in Arabic and English', () => {
  const fields = extractScannerFields('رقم الهوية: ١٢٣٤٥٦٧٨٩٠\nتاريخ الميلاد: ١٩٩٠/٠٥/٢١\nالرقم التسلسلي: ٨٧٦٥٤٣٢١\nتاريخ الانتهاء: ٢٠٣٠/٠٥/٢١\nPhone: +966 55 123 4567');
  assert.deepEqual(fields, { identityNumber: '1234567890', birthDate: '1990/05/21', serialNumber: '87654321' });
  assert.deepEqual(extractScannerFields('National ID: 2123456789\nDate of Birth: 12/03/1994\nSerial Number: 99887766\nExpiry: 12/03/2030'), {
    identityNumber: '2123456789', birthDate: '12/03/1994', serialNumber: '99887766'
  });
});

test('identity OCR does not mistake phone numbers or expiry dates for requested identity fields', () => {
  assert.deepEqual(extractScannerFields('Phone: +966 55 123 4567\nتاريخ الانتهاء: 2030/04/15'), {
    identityNumber: '', birthDate: '', serialNumber: ''
  });
});

test('scanner OCR falls back to original BMP bytes when Sharp does not support the scan format', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servicehub-ocr-fallback-'));
  try {
    const jpeg = join(directory, 'source.jpg');
    const bmp = join(directory, 'scanner-output.bmp');
    const pixels = Buffer.alloc(16 * 16 * 3, 210);
    await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } }).jpeg().toFile(jpeg);
    await exportScannerImage(jpeg, bmp, 'bmp');
    const result = await prepareScannerOcrInput(bmp);
    assert.equal(result.preprocessed, false);
    assert.ok(result.warning.length > 0);
    assert.deepEqual(result.buffer, await readFile(bmp));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scanner OCR uses a safe converted buffer instead of an unsupported original scan when a fallback processor exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servicehub-ocr-safe-fallback-'));
  try {
    const jpeg = join(directory, 'source.jpg');
    const bmp = join(directory, 'scanner-output.bmp');
    const pixels = Buffer.alloc(16 * 16 * 3, 210);
    await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } }).jpeg().toFile(jpeg);
    await exportScannerImage(jpeg, bmp, 'bmp');
    const safePng = await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer();
    const result = await prepareScannerOcrInput(bmp, async (inputPath) => {
      assert.equal(inputPath, bmp);
      return safePng;
    });
    assert.equal(result.preprocessed, true);
    assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.buffer, safePng);
    assert.notDeepEqual(result.buffer, await readFile(bmp));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Tesseract Node worker errors reject initialization instead of becoming uncaught EventEmitter exceptions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servicehub-ocr-worker-error-'));
  try {
    const workerPath = join(directory, 'throwing-worker.cjs');
    await writeFile(workerPath, 'throw new Error("simulated worker startup failure");');
    assert.equal(bridgeNodeWorkerOnError(), true);
    const { createWorker } = require('tesseract.js');
    await assert.rejects(createWorker('eng', 1, { workerPath }), /simulated worker startup failure/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scanner OCR image preparation enhances contrast locally and returns a readable PNG data URL', async () => {
  const { prepareScannerOcrImage } = require('../electron/scanner-formats.cjs');
  const directory = await mkdtemp(join(tmpdir(), 'servicehub-ocr-test-'));
  try {
    const input = join(directory, 'low-resolution.jpg');
    const pixels = Buffer.alloc(240 * 120 * 3, 220);
    for (let y = 30; y < 90; y += 1) for (let x = 35; x < 205; x += 1) {
      const offset = (y * 240 + x) * 3;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = (x % 9 < 3 && y % 12 < 8) ? 25 : 210;
    }
    await sharp(pixels, { raw: { width: 240, height: 120, channels: 3 } }).jpeg({ quality: 75 }).toFile(input);
    const result = await prepareScannerOcrImage(input);
    assert.match(result, /^data:image\/png;base64,/);
    const output = Buffer.from(result.split(',')[1], 'base64');
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 528);
    assert.equal(metadata.height, 264);
    const stats = await sharp(output).stats();
    assert.ok(Math.abs(stats.channels[0].mean - stats.channels[1].mean) < 0.5);
    assert.ok(Math.abs(stats.channels[1].mean - stats.channels[2].mean) < 0.5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scanner OCR preparation downsizes high-resolution scans to a 2200-pixel maximum side', async () => {
  const { prepareScannerOcrImage } = require('../electron/scanner-formats.cjs');
  const directory = await mkdtemp(join(tmpdir(), 'servicehub-ocr-large-'));
  try {
    const input = join(directory, 'large-scan.jpg');
    await sharp({ create: { width: 3200, height: 4800, channels: 3, background: '#eeeeee' } }).jpeg().toFile(input);
    const dataUrl = await prepareScannerOcrImage(input);
    const metadata = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
    assert.equal(Math.max(metadata.width, metadata.height), 2200);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sales and service UI hides redundant chrome and requires the deletion dialog and manual item path', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /id="embeddedSiteHost"/);
  assert.match(source, /class="app-shell \$\{activeSiteTabId \? 'site-active' : ''\} \$\{window\.desktopBridge\?\.syncSiteTabs \? 'desktop-app' : 'web-app'\}"/);
  assert.match(styles, /\.app-shell\.site-active \.sidebar \{ display: none; \}/);
  assert.doesNotMatch(source, /الموقع داخل النظام · لا يظهر الرابط/);
  assert.doesNotMatch(source, /إذا ظهرت رسالة «لا يوجد اتصال»/);
  assert.doesNotMatch(source, /sidebar-download|تثبيت Windows/);
  assert.match(source, /function renderNotepad\(\)/);
  assert.match(source, /localStorage\.setItem\(notepadStorageKey\(\), notepadText\)/);
  assert.match(source, /مسح المفكرة/);
  assert.doesNotMatch(source, /موقع محفوظ/);
  assert.match(source, /value="__custom__">إضافة بند يدوياً/);
  assert.match(source, /id="reportDialogStart"/);
  assert.match(source, /reportDialogMode === 'daily' \? 'التقرير اليومي'/);
  assert.match(source, /id="recordDeleteForm"/);
  assert.match(source, /recordDeletionProtection/);
  assert.match(styles, /\.modal-backdrop/);
});

test('bank ledger reconciles deposits, withdrawals, transfers, bank sales, expenses and date filters', () => {
  const accounts = [{ id: 'bank-a', name: 'الأول', openingBalance: 100 }, { id: 'bank-b', name: 'الثاني', openingBalance: 40 }, { id: 'bank-c', name: 'الثالث', openingBalance: 0 }];
  const operations = [
    { id: 'd1', type: 'deposit', bankAccountId: 'bank-a', amount: 25, dateKey: '2026-11-03', createdAt: '2026-11-03T09:00:00Z' },
    { id: 'w1', type: 'withdrawal', bankAccountId: 'bank-a', amount: 5, dateKey: '2026-11-03', createdAt: '2026-11-03T10:00:00Z' },
    { id: 't1', type: 'transfer', bankAccountId: 'bank-a', toBankAccountId: 'bank-b', amount: 30, dateKey: '2026-11-04', createdAt: '2026-11-04T11:00:00Z' },
    { id: 'a1', type: 'adjustment', bankAccountId: 'bank-b', delta: -2, amount: 2, dateKey: '2026-11-05', createdAt: '2026-11-05T12:00:00Z' }
  ];
  const transactions = [
    { id: 'sale-bank', paymentMethod: 'bank', bankAccountId: 'bank-a', amount: 50, customer: 'سارة', siteName: 'تأمين', dateKey: '2026-11-05', createdAt: '2026-11-05T13:00:00Z' },
    { id: 'sale-cash', paymentMethod: 'cash', amount: 99, dateKey: '2026-11-05', createdAt: '2026-11-05T13:30:00Z' },
    { id: 'service-cost-bank', siteName: 'خدمة', amount: 600, costAmount: 500, receiptMethod: 'cash', costPaymentMethod: 'bank', costBankAccountId: 'bank-c', dateKey: '2026-11-05', createdAt: '2026-11-05T15:00:00Z' }
  ];
  const expenses = [{ id: 'expense-bank', paymentMethod: 'bank', bankAccountId: 'bank-a', amount: 10, description: 'وقود', dateKey: '2026-11-05', createdAt: '2026-11-05T14:00:00Z' }];
  assert.equal(bankBalance(accounts[0], operations, transactions, expenses), 130);
  assert.equal(bankBalance(accounts[1], operations, transactions, expenses), 68);
  assert.equal(bankBalance(accounts[2], operations, transactions, expenses), -500, 'cash received from the customer is not deposited into the bank; only the bank-paid cost is deducted');
  const aLedger = bankLedger('bank-a', accounts, operations, transactions, expenses);
  const daily = filterBankLedger(aLedger, 'daily', '2026-11-05');
  assert.equal(daily.length, 2);
  assert.deepEqual(bankMovementTotals(daily), { incoming: 50, outgoing: 10, net: 40, count: 2 });
  assert.equal(filterBankLedger(aLedger, 'monthly', '2026-11').length, 5);
  const costLedger = bankLedger('bank-c', accounts, operations, transactions, expenses);
  assert.equal(costLedger.length, 1);
  assert.equal(costLedger[0].amount, -500);
  assert.equal(costLedger[0].title, 'تكلفة تنفيذ الخدمة');
  const bTransfer = bankLedger('bank-b', accounts, operations, transactions, expenses).find((entry) => entry.title.includes('تحويل من'));
  assert.equal(bTransfer.amount, 30);
});

test('bank controls remain Windows-only while web bank views are read-only and image links remain safe', async () => {
  const appSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const viewSource = await readFile(new URL('../src/bank-view.js', import.meta.url), 'utf8');
  const electronMain = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const fields = renderPaymentMethodFields('transaction', [{ id: 'b1', name: 'الراجحي' }]);
  assert.match(appSource, /currentView === 'banks' \? \(window\.desktopBridge\?\.syncSiteTabs \? renderBanks\(\) : renderWebBanks\(/);
  assert.match(appSource, /renderWebSales\(state, selectedSalesDate, todayKey\)/);
  assert.match(appSource, /if \(!window\.desktopBridge\?\.syncSiteTabs \|\| currentView !== 'sales'\) return/);
  assert.match(appSource, /paymentMethod, bankAccountId/);
  assert.match(viewSource, /url\.protocol === 'https:'/);
  assert.match(fields, /value="cash">نقدي/);
  assert.match(fields, /طريقة دفع التكلفة/);
  assert.match(fields, /طريقة استلام مبلغ العميل/);
  assert.match(fields, /value="bank"/);
  assert.match(appSource, /name="costAmount"/);
  assert.doesNotMatch(appSource, /name="customer"/);
  assert.match(appSource, /data-settings-open/);
  assert.match(appSource, /settingsDialog \? renderSettingsDialog\(\)/);
  assert.match(electronMain, /configureEditContextMenu/);
  assert.match(electronMain, /role: 'cut'/);
  assert.match(electronMain, /role: 'copy'/);
  assert.match(electronMain, /role: 'paste'/);
  assert.match(electronMain, /role: 'selectAll'/);
  assert.match(fields, /الراجحي/);
  assert.doesNotMatch(electronMain, /WhatsApp|whatsapp|isWhatsAppUrl|browserCompatibleUserAgent/);
});

test('A4 daily and range reports include payment method and bank name', () => {
  const report = {
    dateKey: '2026-11-05', startKey: '2026-11-05', endKey: '2026-11-05', days: [],
    transactions: [{ siteName: 'تأمين', amount: 120, costAmount: 60, paymentMethod: 'bank', bankName: 'الراجحي', dateKey: '2026-11-05', createdAt: '2026-11-05T12:00:00Z' }],
    expenses: [{ description: 'رسوم', amount: 10, paymentMethod: 'cash', dateKey: '2026-11-05', createdAt: '2026-11-05T12:05:00Z' }],
    salesTotal: 120, transactionCostsTotal: 60, transactionProfit: 60, expensesTotal: 10, net: 50
  };
  const dailyHtml = renderDailyReportHtml({ officeName: 'مكتب', report });
  const rangeHtml = renderRangeReportHtml({ officeName: 'مكتب', report });
  for (const html of [dailyHtml, rangeHtml]) {
    assert.match(html, /الاستلام/);
    assert.match(html, /التكلفة/);
    assert.match(html, /بنكي · الراجحي/);
    assert.match(html, /نقدي/);
    assert.match(html, /الربح/);
  }
});


test('public office pages use Vercel path slugs and UID-scoped map settings', async () => {
  const appSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pageSource = await readFile(new URL('../src/public-page.js', import.meta.url), 'utf8');
  const apiSource = await readFile(new URL('../api/[...path].js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261031070000_add_public_page_slug.sql', import.meta.url), 'utf8');
  const privacyMigration = await readFile(new URL('../supabase/migrations/20261031112000_randomize_public_page_slugs.sql', import.meta.url), 'utf8');
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(vercel.rewrites.some((rule) => rule.source === '/m/:slug' && rule.destination === '/'));
  assert.match(appSource, /publicPageSlug = window\.location\.pathname\.match\(\/\^\\\/m\\\//);
  assert.match(appSource, /id="officeLocationForm"/);
  assert.match(appSource, /apiRequest\('client\/account'\)/);
  assert.match(pageSource, /https:\/\/wa\.me\/\$\{number\}/);
  assert.match(pageSource, /buildOfficeWhatsappUrl\(phone, officeName, service\)/);
  assert.match(apiSource, /public-page' && method === 'GET'/);
  assert.match(apiSource, /const publicSlug = `office-/);
  assert.match(apiSource, /officeLocation: safePublicMapUrl\(saved\?\.officeLocation\)/);
  assert.match(migration, /add column if not exists public_slug text/);
  assert.match(privacyMigration, /gen_random_uuid\(\)/);
});
