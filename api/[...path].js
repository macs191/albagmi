import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

const ACCOUNT_TABLE = 'albagmi_accounts';
const USER_DATA_TABLE = 'albagmi_user_data';
const VISITOR_TABLE = 'albagmi_site_visitors';
const PASSWORD_REQUEST_TABLE = 'albagmi_password_change_requests';
const MAX_STATE_BYTES = 1024 * 1024;
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;
const RECORD_DELETE_PBKDF2_ITERATIONS = 160000;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new HttpError(503, 'server_configuration_missing', { missing: [name] });
  return value;
}

class HttpError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseBody(req) {
  let body = req.body;
  if (body == null && typeof req.rawBody === 'string') body = req.rawBody;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_STATE_BYTES) throw new HttpError(413, 'payload_too_large');
    try { body = JSON.parse(body); } catch { throw new HttpError(400, 'invalid_json'); }
  }
  if (body == null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_body');
  if (Number(req.headers?.['content-length']) > MAX_STATE_BYTES) throw new HttpError(413, 'payload_too_large');
  return body;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_username');
  const username = value.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'invalid_username');
  return username;
}

function positiveDays(value) {
  if (!Number.isInteger(value) || value < 1 || value > 36500) throw new HttpError(400, 'invalid_subscription_days');
  return value;
}

function accountProfile(row) {
  return {
    id: row.id,
    username: row.username,
    publicSlug: row.public_slug,
    officeName: row.office_name,
    ownerName: row.owner_name,
    phone: row.phone,
    subscriptionStartedAt: row.subscription_started_at,
    subscriptionDays: row.subscription_days,
    subscriptionEndsAt: row.subscription_ends_at,
    isActive: row.is_active !== false,
    loginCount: Number(row.login_count || 0),
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subscriptionInfo(row, now = Date.now()) {
  const endMs = Date.parse(row.subscription_ends_at);
  if (!Number.isFinite(endMs)) throw new HttpError(500, 'invalid_subscription_data');
  const graceEnds = endMs + 5 * 24 * 60 * 60 * 1000;
  return {
    subscriptionStartedAt: row.subscription_started_at,
    subscriptionDays: row.subscription_days,
    subscriptionEndsAt: row.subscription_ends_at,
    graceEndsAt: new Date(graceEnds).toISOString(),
    daysRemaining: Math.ceil((endMs - now) / 86400000),
    daysUntilLock: Math.ceil((graceEnds - now) / 86400000),
  };
}

function enforceGrace(row) {
  const info = subscriptionInfo(row);
  if (Date.now() > Date.parse(info.graceEndsAt)) {
    throw new HttpError(403, 'subscription_locked', { subscription: info });
  }
  return info;
}

function enforceAccountActive(row) {
  if (row.is_active === false) throw new HttpError(403, 'account_disabled');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  const length = Math.max(left.length, right.length, 1);
  const l = Buffer.alloc(length);
  const r = Buffer.alloc(length);
  left.copy(l); right.copy(r);
  return timingSafeEqual(l, r) && left.length === right.length;
}

function hasRemovedRecords(previous = {}, next = {}) {
  const removedFrom = (before, after) => {
    const retainedIds = new Set((Array.isArray(after) ? after : []).map((item) => String(item?.id || '')).filter(Boolean));
    return (Array.isArray(before) ? before : []).some((item) => item?.id && !retainedIds.has(String(item.id)));
  };
  return removedFrom(previous.transactions, next.transactions) || removedFrom(previous.expenses, next.expenses);
}

function verifyRecordDeletionPassword(protection, password) {
  if (!protection || typeof password !== 'string' || password.length < 8 || password.length > 128) return false;
  if (protection.iterations !== RECORD_DELETE_PBKDF2_ITERATIONS || !/^[a-f0-9]{32}$/i.test(protection.salt || '') || !/^[a-f0-9]{64}$/i.test(protection.hash || '')) return false;
  const derived = pbkdf2Sync(password, Buffer.from(protection.salt, 'hex'), RECORD_DELETE_PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return safeEqual(derived, protection.hash.toLowerCase());
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signAdminToken() {
  const secret = env('ALBAGMI_ADMIN_JWT_SECRET');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: 'albagmi-admin', role: 'admin', iat: now, exp: now + 60 * 60 * 8 }));
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function verifyAdminToken(token) {
  const secret = env('ALBAGMI_ADMIN_JWT_SECRET');
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const input = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(input).digest();
  let actual;
  try { actual = Buffer.from(parts[2], 'base64url'); } catch { return false; }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return header.alg === 'HS256' && payload.role === 'admin' && payload.sub === 'albagmi-admin' && Number.isFinite(payload.exp) && payload.exp > Date.now() / 1000;
  } catch { return false; }
}

function bearer(req) {
  const value = req.headers?.authorization || req.headers?.Authorization;
  const match = typeof value === 'string' && value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function loginAttemptKey(req, role, username) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'unknown';
  return `${ip}:${role}:${String(username || '').trim().toLowerCase()}`;
}

function enforceLoginLimit(key) {
  const entry = loginFailures.get(key);
  if (entry && entry.until > Date.now() && entry.count >= MAX_LOGIN_FAILURES) throw new HttpError(429, 'login_rate_limited');
  if (entry && entry.until <= Date.now()) loginFailures.delete(key);
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.until <= now) loginFailures.set(key, { count: 1, until: now + LOGIN_WINDOW_MS });
  else entry.count += 1;
  if (loginFailures.size > 10000) {
    for (const [candidate, value] of loginFailures) if (value.until <= now) loginFailures.delete(candidate);
  }
}

async function supabaseFetch(path, options = {}, useService = false) {
  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  const key = useService ? env('SUPABASE_SERVICE_ROLE_KEY') : env('SUPABASE_ANON_KEY');
  const headers = {
    apikey: key,
    ...(useService ? { Authorization: `Bearer ${key}` } : {}),
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!response.ok) {
    if (response.status === 404) throw new HttpError(404, 'not_found');
    if (response.status === 409) throw new HttpError(409, 'conflict');
    if (response.status === 400 || response.status === 422) throw new HttpError(400, 'invalid_request');
    if (response.status === 401 || response.status === 403) throw new HttpError(401, 'authentication_failed');
    throw new HttpError(response.status >= 500 ? 502 : response.status, 'upstream_request_failed');
  }
  return { data, response };
}

function query(columns, params = {}) {
  const q = new URLSearchParams({ select: columns, ...params });
  return `?${q.toString()}`;
}

async function findAccountByUsername(username) {
  const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('*', { username: `eq.${username}`, limit: '1' })}`, {}, true);
  return Array.isArray(data) ? data[0] || null : null;
}

async function findAccountById(id) {
  const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('*', { id: `eq.${id}`, limit: '1' })}`, {}, true);
  return Array.isArray(data) ? data[0] || null : null;
}

async function findAccountByAuthId(id) {
  const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('*', { auth_user_id: `eq.${id}`, limit: '1' })}`, {}, true);
  return Array.isArray(data) ? data[0] || null : null;
}

function safePublicMapUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co'
      || host === 'google.com' || host.endsWith('.google.com');
    return url.protocol === 'https:' && allowed ? url.href : '';
  } catch { return ''; }
}

async function getPublicOfficePage(slugValue) {
  const slug = typeof slugValue === 'string' ? slugValue.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(slug)) throw new HttpError(404, 'public_page_not_found');
  const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('public_slug,auth_user_id,office_name,phone,is_active', { public_slug: `eq.${slug}`, limit: '1' })}`, {}, true);
  const account = Array.isArray(data) ? data[0] : null;
  if (!account || account.is_active === false) throw new HttpError(404, 'public_page_not_found');
  const stateResult = await supabaseFetch(`/rest/v1/${USER_DATA_TABLE}${query('app_state', { user_id: `eq.${account.auth_user_id}`, limit: '1' })}`, {}, true);
  const saved = Array.isArray(stateResult.data) ? stateResult.data[0]?.app_state : null;
  return {
    publicSlug: account.public_slug,
    officeName: account.office_name,
    phone: account.phone,
    officeLocation: safePublicMapUrl(saved?.officeLocation),
  };
}

async function incrementAccountLogin(accountId) {
  await supabaseFetch('/rest/v1/rpc/albagmi_increment_login', {
    method: 'POST', body: JSON.stringify({ p_account_id: accountId }),
  }, true);
}

async function requireClient(req) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'unauthorized');
  let auth;
  try {
    const result = await supabaseFetch('/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } });
    auth = result.data;
  } catch { throw new HttpError(401, 'unauthorized'); }
  if (!auth?.id) throw new HttpError(401, 'unauthorized');
  const account = await findAccountByAuthId(auth.id);
  if (!account) throw new HttpError(403, 'account_not_found');
  enforceAccountActive(account);
  const subscription = enforceGrace(account);
  return { account, subscription, userId: auth.id };
}

async function requireAdmin(req) {
  if (!verifyAdminToken(bearer(req))) throw new HttpError(401, 'unauthorized');
}

async function clientLogin(username, password) {
  const account = await findAccountByUsername(username);
  if (!account) throw new HttpError(401, 'invalid_credentials');
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) throw new HttpError(401, 'invalid_credentials');
  const email = `${username}@albagmi.local`;
  let auth;
  try {
    const result = await supabaseFetch('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    auth = result.data;
  } catch { throw new HttpError(401, 'invalid_credentials'); }
  const verifiedAccount = await findAccountByAuthId(auth?.user?.id);
  if (!verifiedAccount || verifiedAccount.id !== account.id) throw new HttpError(401, 'invalid_credentials');
  enforceAccountActive(verifiedAccount);
  const subscription = enforceGrace(verifiedAccount);
  await incrementAccountLogin(verifiedAccount.id);
  return { token: auth.access_token, refreshToken: auth.refresh_token, userId: auth.user.id, role: 'client', account: accountProfile(verifiedAccount), subscription };
}

async function createAccount(body) {
  const username = normalizeUsername(body.username);
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 1024) throw new HttpError(400, 'invalid_password');
  const subscriptionDays = positiveDays(body.subscriptionDays);
  if (await findAccountByUsername(username)) throw new HttpError(409, 'username_taken');
  const publicSlug = `office-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  for (const key of ['officeName', 'ownerName', 'phone']) {
    if (typeof body[key] !== 'string' || body[key].trim().length > 300) throw new HttpError(400, `invalid_${key}`);
  }
  const email = `${username}@albagmi.local`;
  const created = await supabaseFetch('/auth/v1/admin/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ email, password: body.password, email_confirm: true, user_metadata: { username } }),
  }, true);
  const authUserId = created.data?.id;
  if (!authUserId) throw new HttpError(502, 'upstream_request_failed');
  const now = new Date();
  const end = new Date(now.getTime() + subscriptionDays * 86400000);
  const record = {
    id: randomUUID(), auth_user_id: authUserId, username, public_slug: publicSlug,
    office_name: body.officeName.trim(), owner_name: body.ownerName.trim(), phone: body.phone.trim(),
    subscription_started_at: now.toISOString(), subscription_days: subscriptionDays,
    subscription_ends_at: end.toISOString(), app_state: {},
    is_active: true, login_count: 0, last_login_at: null,
  };
  try {
    const inserted = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}?select=*`, {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record),
    }, true);
    const row = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
    if (!row) throw new HttpError(502, 'upstream_request_failed');
    return accountProfile(row);
  } catch (error) {
    try {
      await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
      }, true);
    } catch { /* rollback is best-effort; do not expose upstream details */ }
    throw error;
  }
}

async function updateAccount(id, body) {
  const current = await findAccountById(id);
  if (!current) throw new HttpError(404, 'account_not_found');
  const allowed = new Set(['username', 'officeName', 'ownerName', 'phone', 'isActive', 'password']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new HttpError(400, 'invalid_account_field');
  const patch = {};
  const authPatch = {};
  let usernameChanged = false;

  if (body.username !== undefined) {
    const username = normalizeUsername(body.username);
    if (username !== current.username) {
      const existing = await findAccountByUsername(username);
      if (existing && existing.id !== current.id) throw new HttpError(409, 'username_taken');
      patch.username = username;
      authPatch.email = `${username}@albagmi.local`;
      authPatch.email_confirm = true;
      usernameChanged = true;
    }
  }

  for (const [field, column, min, max] of [
    ['officeName', 'office_name', 1, 120],
    ['ownerName', 'owner_name', 1, 120],
    ['phone', 'phone', 3, 40],
  ]) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') throw new HttpError(400, `invalid_${field}`);
    const value = body[field].trim();
    if (value.length < min || value.length > max) throw new HttpError(400, `invalid_${field}`);
    patch[column] = value;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new HttpError(400, 'invalid_isActive');
    patch.is_active = body.isActive;
  }

  if (body.password !== undefined && body.password !== '') {
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 1024) {
      throw new HttpError(400, 'invalid_password');
    }
    authPatch.password = body.password;
  }

  let authUpdated = false;
  if (Object.keys(authPatch).length) {
    try {
      await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(current.auth_user_id)}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify(authPatch),
      }, true);
    } catch (error) {
      if (usernameChanged && (error.code === 'conflict' || error.code === 'invalid_request')) throw new HttpError(409, 'username_taken');
      throw error;
    }
    authUpdated = true;
  }

  if (!Object.keys(patch).length) return accountProfile(current);
  patch.updated_at = new Date().toISOString();
  try {
    const updated = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
    }, true);
    const row = Array.isArray(updated.data) ? updated.data[0] : updated.data;
    if (!row) throw new HttpError(404, 'account_not_found');
    return accountProfile(row);
  } catch (error) {
    if (authUpdated && usernameChanged) {
      try {
        await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(current.auth_user_id)}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ email: `${current.username}@albagmi.local`, email_confirm: true }),
        }, true);
      } catch { throw new HttpError(502, 'account_update_partial_failure'); }
    }
    if (authUpdated && authPatch.password) throw new HttpError(502, 'account_update_partial_failure');
    throw error;
  }
}

async function getAdminMetrics() {
  const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('is_active,subscription_ends_at,login_count', { order: 'created_at.asc', limit: '1000' })}`, {}, true);
  const accounts = Array.isArray(data) ? data : [];
  const now = Date.now();
  let activeAccounts = 0;
  let graceAccounts = 0;
  let disabledAccounts = 0;
  let lockedAccounts = 0;
  let totalLogins = 0;
  for (const account of accounts) {
    totalLogins += Number(account.login_count || 0);
    if (account.is_active === false) { disabledAccounts += 1; continue; }
    const end = Date.parse(account.subscription_ends_at);
    if (!Number.isFinite(end)) continue;
    if (now <= end) activeAccounts += 1;
    else if (now <= end + 5 * 86400000) graceAccounts += 1;
    else lockedAccounts += 1;
  }
  const { response } = await supabaseFetch(`/rest/v1/${VISITOR_TABLE}?select=visitor_id&limit=1`, {
    headers: { Prefer: 'count=exact' },
  }, true);
  const range = response.headers.get('content-range') || '';
  const uniqueVisitors = Number(range.split('/').pop());
  if (!Number.isSafeInteger(uniqueVisitors) || uniqueVisitors < 0) throw new HttpError(502, 'visitor_count_unavailable');
  return { totalAccounts: accounts.length, activeAccounts, graceAccounts, disabledAccounts, lockedAccounts, totalLogins, uniqueVisitors };
}

async function recordSiteVisitor(body) {
  const visitorId = body.visitorId;
  if (typeof visitorId !== 'string' || !UUID_RE.test(visitorId)) throw new HttpError(400, 'invalid_visitor_id');
  await supabaseFetch(`/rest/v1/${VISITOR_TABLE}?on_conflict=visitor_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ visitor_id: visitorId }),
  }, true);
}

function passwordRequestKey() {
  return createHash('sha256').update(`albagmi-password-request-v1:${env('ALBAGMI_ADMIN_JWT_SECRET')}`).digest();
}

function encryptRequestedPassword(password) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', passwordRequestKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return { password_ciphertext: ciphertext.toString('base64url'), password_iv: iv.toString('base64url'), password_tag: cipher.getAuthTag().toString('base64url') };
}

function decryptRequestedPassword(request) {
  const decipher = createDecipheriv('aes-256-gcm', passwordRequestKey(), Buffer.from(request.password_iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(request.password_tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(request.password_ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

async function createPasswordChangeRequest(account, password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new HttpError(400, 'invalid_password');
  const { data: pending } = await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}${query('id', { auth_user_id: `eq.${account.auth_user_id}`, status: 'eq.pending', limit: '1' })}`, {}, true);
  if (Array.isArray(pending) && pending.length) throw new HttpError(409, 'password_request_pending');
  const secret = encryptRequestedPassword(password);
  const created = await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}?select=id,status,created_at`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: randomUUID(), account_id: account.id, auth_user_id: account.auth_user_id, status: 'pending', ...secret }),
  }, true);
  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  if (!row) throw new HttpError(502, 'password_request_failed');
  return { id: row.id, status: row.status, createdAt: row.created_at };
}

async function getClientPasswordRequest(userId) {
  const { data } = await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}${query('id,status,created_at,reviewed_at', { auth_user_id: `eq.${userId}`, order: 'created_at.desc', limit: '1' })}`, {}, true);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { id: row.id, status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at } : null;
}

async function listPasswordChangeRequests() {
  const { data } = await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}${query('id,account_id,status,created_at,reviewed_at,albagmi_accounts(username,office_name,owner_name,phone)', { status: 'eq.pending', order: 'created_at.asc', limit: '500' })}`, {}, true);
  return Array.isArray(data) ? data.map((row) => ({ id: row.id, accountId: row.account_id, status: row.status, createdAt: row.created_at, account: row.albagmi_accounts })) : [];
}

async function reviewPasswordChangeRequest(requestId, decision) {
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'invalid_decision');
  const { data } = await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}${query('*', { id: `eq.${requestId}`, status: 'eq.pending', limit: '1' })}`, {}, true);
  const request = Array.isArray(data) ? data[0] : null;
  if (!request) throw new HttpError(404, 'password_request_not_found');
  if (decision === 'approve') {
    let password;
    try { password = decryptRequestedPassword(request); }
    catch { throw new HttpError(500, 'password_request_decryption_failed'); }
    await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(request.auth_user_id)}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ password }),
    }, true);
  }
  const updated = await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}?id=eq.${encodeURIComponent(requestId)}&status=eq.pending&select=id,status,reviewed_at`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), password_ciphertext: null, password_iv: null, password_tag: null }),
  }, true);
  const row = Array.isArray(updated.data) ? updated.data[0] : null;
  if (!row) throw new HttpError(409, 'password_request_already_reviewed');
  return { id: row.id, status: row.status, reviewedAt: row.reviewed_at };
}

function pathSegments(req) {
  let path = req.url || '/';
  try { path = new URL(path, 'http://localhost').pathname; } catch { /* use original path */ }
  path = path.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
  try { return path ? path.split('/').map(decodeURIComponent) : []; }
  catch { throw new HttpError(400, 'invalid_path'); }
}

function setCors(req, res) {
  const origin = req.headers?.origin;
  const allow = (process.env.ALBAGMI_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (origin && (allow.includes('*') || allow.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', allow.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    const segments = pathSegments(req);
    const method = req.method;
    if (segments.length === 1 && segments[0] === 'health' && method === 'GET') {
      const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ALBAGMI_ADMIN_PASSWORD', 'ALBAGMI_ADMIN_JWT_SECRET'];
      const missing = required.filter((name) => !process.env[name]);
      if (missing.length) return json(res, 503, { ok: false, error: 'server_configuration_missing', missing });
      try { await supabaseFetch('/auth/v1/settings'); }
      catch { return json(res, 502, { ok: false, error: 'supabase_auth_unreachable' }); }
      try { await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('id,public_slug', { limit: '1' })}`, {}, true); }
      catch { return json(res, 503, { ok: false, error: 'account_table_unavailable' }); }
      try { await supabaseFetch(`/rest/v1/${USER_DATA_TABLE}${query('user_id', { limit: '1' })}`, {}, true); }
      catch { return json(res, 503, { ok: false, error: 'user_data_table_unavailable' }); }
      try { await supabaseFetch(`/rest/v1/${VISITOR_TABLE}${query('visitor_id', { limit: '1' })}`, {}, true); }
      catch { return json(res, 503, { ok: false, error: 'analytics_table_unavailable' }); }
      try { await supabaseFetch(`/rest/v1/${PASSWORD_REQUEST_TABLE}${query('id', { limit: '1' })}`, {}, true); }
      catch { return json(res, 503, { ok: false, error: 'password_request_table_unavailable' }); }
      return json(res, 200, { ok: true, api: 'ready', supabase: 'connected' });
    }
    if (segments.length === 1 && segments[0] === 'visit' && method === 'POST') {
      await recordSiteVisitor(parseBody(req));
      return json(res, 200, { ok: true });
    }
    if (segments.length === 2 && segments[0] === 'public-page' && method === 'GET') {
      return json(res, 200, await getPublicOfficePage(segments[1]));
    }
    if (segments.length === 2 && segments[0] === 'admin' && segments[1] === 'login' && method === 'POST') {
      const body = parseBody(req);
      const password = env('ALBAGMI_ADMIN_PASSWORD');
      const attemptKey = loginAttemptKey(req, 'admin', 'system');
      enforceLoginLimit(attemptKey);
      if (typeof body.password !== 'string' || !safeEqual(body.password, password)) {
        recordLoginFailure(attemptKey);
        throw new HttpError(401, 'invalid_credentials');
      }
      loginFailures.delete(attemptKey);
      return json(res, 200, { token: signAdminToken(), role: 'admin', account: { username: 'admin' } });
    }
    if (segments.length === 1 && segments[0] === 'login' && method === 'POST') {
      const body = parseBody(req);
      if (body.role === 'client') {
        const username = normalizeUsername(body.username);
        if (typeof body.password !== 'string') throw new HttpError(401, 'invalid_credentials');
        const attemptKey = loginAttemptKey(req, 'client', username);
        enforceLoginLimit(attemptKey);
        try {
          const result = await clientLogin(username, body.password);
          loginFailures.delete(attemptKey);
          return json(res, 200, result);
        } catch (error) {
          if (error.status === 401) recordLoginFailure(attemptKey);
          throw error;
        }
      }
      throw new HttpError(400, 'invalid_role');
    }
    if (segments.length === 1 && segments[0] === 'refresh' && method === 'POST') {
      const body = parseBody(req);
      if (typeof body.refreshToken !== 'string' || body.refreshToken.length < 10) throw new HttpError(401, 'unauthorized');
      let auth;
      try {
        const result = await supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: JSON.stringify({ refresh_token: body.refreshToken }),
        });
        auth = result.data;
      } catch { throw new HttpError(401, 'unauthorized'); }
      const account = await findAccountByAuthId(auth?.user?.id);
      if (!account) throw new HttpError(403, 'account_not_found');
      enforceAccountActive(account);
      const subscription = enforceGrace(account);
      return json(res, 200, { token: auth.access_token, refreshToken: auth.refresh_token, userId: auth.user.id, role: 'client', account: accountProfile(account), subscription });
    }
    if (segments.length === 2 && segments[0] === 'admin' && segments[1] === 'metrics' && method === 'GET') {
      await requireAdmin(req);
      return json(res, 200, await getAdminMetrics());
    }
    if (segments.length === 2 && segments[0] === 'admin' && segments[1] === 'password-requests' && method === 'GET') {
      await requireAdmin(req);
      return json(res, 200, await listPasswordChangeRequests());
    }
    if (segments.length === 3 && segments[0] === 'admin' && segments[1] === 'password-requests' && method === 'POST') {
      await requireAdmin(req);
      const body = parseBody(req);
      return json(res, 200, await reviewPasswordChangeRequest(segments[2], body.decision));
    }
    if (segments.length === 2 && segments[0] === 'client' && segments[1] === 'account' && method === 'GET') {
      const { account } = await requireClient(req);
      return json(res, 200, accountProfile(account));
    }
    if (segments.length === 2 && segments[0] === 'client' && segments[1] === 'account' && method === 'PATCH') {
      const { account } = await requireClient(req);
      const body = parseBody(req);
      if (Object.keys(body).some((key) => key !== 'officeName') || typeof body.officeName !== 'string') throw new HttpError(400, 'invalid_account_field');
      const officeName = body.officeName.trim();
      if (officeName.length < 1 || officeName.length > 120) throw new HttpError(400, 'invalid_officeName');
      const updated = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}?id=eq.${encodeURIComponent(account.id)}&select=*`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ office_name: officeName, updated_at: new Date().toISOString() }),
      }, true);
      const row = Array.isArray(updated.data) ? updated.data[0] : null;
      if (!row) throw new HttpError(404, 'account_not_found');
      return json(res, 200, accountProfile(row));
    }
    if (segments.length === 2 && segments[0] === 'client' && segments[1] === 'password-request' && method === 'GET') {
      const { userId } = await requireClient(req);
      return json(res, 200, { request: await getClientPasswordRequest(userId) });
    }
    if (segments.length === 2 && segments[0] === 'client' && segments[1] === 'password-request' && method === 'POST') {
      const { account } = await requireClient(req);
      const body = parseBody(req);
      if (Object.keys(body).some((key) => key !== 'password')) throw new HttpError(400, 'invalid_body');
      return json(res, 201, { request: await createPasswordChangeRequest(account, body.password) });
    }
    if (segments[0] === 'admin' && segments[1] === 'accounts') {
      await requireAdmin(req);
      if (segments.length === 2 && method === 'GET') {
        const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('id,username,public_slug,office_name,owner_name,phone,subscription_started_at,subscription_days,subscription_ends_at,is_active,login_count,last_login_at,created_at,updated_at', { order: 'created_at.desc', limit: '1000' })}`, {}, true);
        return json(res, 200, (Array.isArray(data) ? data : []).map(accountProfile));
      }
      if (segments.length === 2 && method === 'POST') return json(res, 201, await createAccount(parseBody(req)));
      if (segments.length === 3 && method === 'PUT') return json(res, 200, await updateAccount(segments[2], parseBody(req)));
      if (segments.length === 3 && method === 'DELETE') {
        const body = parseBody(req);
        const current = await findAccountById(segments[2]);
        if (!current) throw new HttpError(404, 'account_not_found');
        if (body.confirmUsername !== current.username) throw new HttpError(400, 'delete_confirmation_mismatch');
        await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(current.auth_user_id)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
        }, true);
        return json(res, 200, { ok: true, deleted: true });
      }
      if (segments.length === 4 && segments[3] === 'renew' && method === 'POST') {
        const body = parseBody(req);
        const days = positiveDays(body.days);
        const current = await findAccountById(segments[2]);
        if (!current) throw new HttpError(404, 'account_not_found');
        const now = Date.now();
        const priorEnd = Date.parse(current.subscription_ends_at);
        if (!Number.isFinite(priorEnd)) throw new HttpError(500, 'invalid_subscription_data');
        const start = Math.max(priorEnd, now);
        const newEnd = new Date(start + days * 86400000);
        const patch = {
          subscription_started_at: new Date(start).toISOString(),
          subscription_days: days,
          subscription_ends_at: newEnd.toISOString(),
          updated_at: new Date().toISOString(),
        };
        const updated = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}?id=eq.${encodeURIComponent(segments[2])}&select=*`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
        }, true);
        const row = Array.isArray(updated.data) ? updated.data[0] : updated.data;
        if (!row) throw new HttpError(404, 'account_not_found');
        return json(res, 200, accountProfile(row));
      }
      throw new HttpError(404, 'not_found');
    }
    if (segments.length === 2 && segments[0] === 'client' && segments[1] === 'state' && (method === 'GET' || method === 'PUT')) {
      const { subscription, userId } = await requireClient(req);
      if (method === 'GET') {
        const { data } = await supabaseFetch(`/rest/v1/${USER_DATA_TABLE}${query('app_state', { user_id: `eq.${userId}`, limit: '1' })}`, {}, true);
        const row = Array.isArray(data) ? data[0] : data;
        return json(res, 200, { appState: row?.app_state || {}, subscription, userId });
      }
      const body = parseBody(req);
      const state = body.app_state ?? body.appState;
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new HttpError(400, 'invalid_app_state');
      if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) throw new HttpError(413, 'payload_too_large');
      const previousResult = await supabaseFetch(`/rest/v1/${USER_DATA_TABLE}${query('app_state', { user_id: `eq.${userId}`, limit: '1' })}`, {}, true);
      const previousState = Array.isArray(previousResult.data) ? previousResult.data[0]?.app_state || {} : {};
      if (hasRemovedRecords(previousState, state)) {
        const protection = previousState.recordDeletionProtection;
        if (!protection) throw new HttpError(403, 'record_deletion_password_required');
        if (!verifyRecordDeletionPassword(protection, body.deletionPassword)) throw new HttpError(403, 'invalid_record_deletion_password');
      }
      const updated = await supabaseFetch(`/rest/v1/${USER_DATA_TABLE}?on_conflict=user_id&select=app_state`, {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ user_id: userId, app_state: state, updated_at: new Date().toISOString() }),
      }, true);
      const row = Array.isArray(updated.data) ? updated.data[0] : updated.data;
      if (!row) throw new HttpError(500, 'state_update_failed');
      return json(res, 200, { appState: row.app_state || {}, subscription, userId });
    }
    throw new HttpError(404, 'not_found');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'internal_server_error';
    const output = { error: code };
    if (error instanceof HttpError && error.details) Object.assign(output, error.details);
    return json(res, status, output);
  }
}
