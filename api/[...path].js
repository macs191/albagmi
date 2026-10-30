import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const ACCOUNT_TABLE = 'albagmi_accounts';
const MAX_STATE_BYTES = 1024 * 1024;
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

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
    officeName: row.office_name,
    ownerName: row.owner_name,
    phone: row.phone,
    subscriptionStartedAt: row.subscription_started_at,
    subscriptionDays: row.subscription_days,
    subscriptionEndsAt: row.subscription_ends_at,
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

function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  const length = Math.max(left.length, right.length, 1);
  const l = Buffer.alloc(length);
  const r = Buffer.alloc(length);
  left.copy(l); right.copy(r);
  return timingSafeEqual(l, r) && left.length === right.length;
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
  const headers = { apikey: key, 'Content-Type': 'application/json', ...options.headers };
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
  const subscription = enforceGrace(account);
  return { account, subscription };
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
  const subscription = enforceGrace(verifiedAccount);
  return { token: auth.access_token, refreshToken: auth.refresh_token, role: 'client', account: accountProfile(verifiedAccount), subscription };
}

async function createAccount(body) {
  const username = normalizeUsername(body.username);
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 1024) throw new HttpError(400, 'invalid_password');
  const subscriptionDays = positiveDays(body.subscriptionDays);
  if (await findAccountByUsername(username)) throw new HttpError(409, 'username_taken');
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
    id: randomUUID(), auth_user_id: authUserId, username,
    office_name: body.officeName.trim(), owner_name: body.ownerName.trim(), phone: body.phone.trim(),
    subscription_started_at: now.toISOString(), subscription_days: subscriptionDays,
    subscription_ends_at: end.toISOString(), app_state: {},
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
      try { await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('id', { limit: '1' })}`, {}, true); }
      catch { return json(res, 503, { ok: false, error: 'account_table_unavailable' }); }
      return json(res, 200, { ok: true, api: 'ready', supabase: 'connected' });
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
      const subscription = enforceGrace(account);
      return json(res, 200, { token: auth.access_token, refreshToken: auth.refresh_token, role: 'client', account: accountProfile(account), subscription });
    }
    if (segments[0] === 'admin' && segments[1] === 'accounts') {
      await requireAdmin(req);
      if (segments.length === 2 && method === 'GET') {
        const { data } = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}${query('id,username,office_name,owner_name,phone,subscription_started_at,subscription_days,subscription_ends_at,created_at,updated_at', { order: 'created_at.desc', limit: '1000' })}`, {}, true);
        return json(res, 200, (Array.isArray(data) ? data : []).map(accountProfile));
      }
      if (segments.length === 2 && method === 'POST') return json(res, 201, await createAccount(parseBody(req)));
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
      const { account, subscription } = await requireClient(req);
      if (method === 'GET') return json(res, 200, { appState: account.app_state || {}, subscription });
      const body = parseBody(req);
      const state = body.app_state ?? body.appState;
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new HttpError(400, 'invalid_app_state');
      if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) throw new HttpError(413, 'payload_too_large');
      const updated = await supabaseFetch(`/rest/v1/${ACCOUNT_TABLE}?id=eq.${encodeURIComponent(account.id)}&select=app_state`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ app_state: state, updated_at: new Date().toISOString() }),
      }, true);
      const row = Array.isArray(updated.data) ? updated.data[0] : updated.data;
      if (!row) throw new HttpError(500, 'state_update_failed');
      return json(res, 200, { appState: row.app_state || {}, subscription });
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
