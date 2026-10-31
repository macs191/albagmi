import './styles.css';
import { aggregateDailyReport, aggregateMonthlyReport, openPrintWindow, renderDailyReportHtml, renderMonthlyReportHtml } from './reports.js';

const STORAGE_KEY = 'servicehub-desktop-v1';
const SESSION_KEY = 'albagmi-session-v1';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const defaultSites = [
  { id: 'site-tameeni', name: 'تأميني', category: 'التأمين', url: 'https://www.tameeni.com/', image: 'https://www.google.com/s2/favicons?domain=www.tameeni.com&sz=128', favorite: true },
  { id: 'site-najm', name: 'نجم', category: 'الحوادث والتأمين', url: 'https://najm.sa/', image: 'https://www.google.com/s2/favicons?domain=najm.sa&sz=128', favorite: true },
  { id: 'site-transport', name: 'الهيئة العامة للنقل', category: 'النقل والتراخيص', url: 'https://tga.gov.sa/', image: 'https://www.google.com/s2/favicons?domain=tga.gov.sa&sz=128', favorite: false },
  { id: 'site-absher', name: 'أبشر', category: 'الخدمات الحكومية', url: 'https://www.absher.sa/', image: 'https://www.google.com/s2/favicons?domain=absher.sa&sz=128', favorite: true },
  { id: 'site-najiz', name: 'ناجز', category: 'الخدمات الحكومية', url: 'https://najiz.sa/', image: '', favorite: false },
  { id: 'site-nafath', name: 'نفاذ', category: 'الخدمات الحكومية', url: 'https://www.iam.gov.sa/', image: '', favorite: false },
  { id: 'site-balady', name: 'بلدي', category: 'المنشآت والبلديات', url: 'https://balady.gov.sa/', image: 'https://www.google.com/s2/favicons?domain=balady.gov.sa&sz=128', favorite: false },
  { id: 'site-business', name: 'منصة الأعمال', category: 'المنشآت والبلديات', url: 'https://business.sa/', image: '', favorite: false },
  { id: 'site-ia', name: 'هيئة التأمين', category: 'التأمين', url: 'https://www.ia.gov.sa/', image: '', favorite: false }
];

const initialState = {
  officeName: 'مكتب البقمي 2',
  sites: defaultSites,
  transactions: [],
  expenses: []
};

let state = loadState();
let authSession = loadSession();
let syncTimer;
let sessionCheckTimer;
let currentView = getViewFromHash();
let openSiteTabs = [];
let activeSiteTabId = null;
let clientPasswordRequest = null;
let adminPasswordRequests = [];
let searchTerm = '';
let categoryFilter = 'الكل';
let selectedSalesDate = todayKey();
let selectedReportMonth = todayKey().slice(0, 7);
let editingSiteId = null;
let toastTimer;

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

function apiUrl(path) {
  const base = API_BASE_URL || (window.location.protocol === 'file:' ? '' : window.location.origin);
  if (!base) throw new Error('نسخة البرنامج تحتاج رابط API المنشور على Vercel داخل إعدادات البناء.');
  return `${base}/api/${path.replace(/^\//, '')}`;
}

async function apiRequest(path, { method = 'GET', body, token = authSession?.token, retryAuth = true } = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    const networkError = new Error('تعذر الوصول إلى API على Vercel. تحقق من نشر دوال API ورابطها وإعدادات CORS لنسخة EXE.');
    networkError.code = 'network_error';
    networkError.cause = error;
    throw networkError;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || result.error || 'تعذر تنفيذ الطلب.');
    error.status = response.status;
    error.code = result.code || result.error;
    error.details = result;
    if (response.status === 401 && retryAuth && authSession?.role === 'client' && path !== 'refresh' && authSession.refreshToken) {
      try {
        const refreshed = await apiRequest('refresh', { method: 'POST', token: null, body: { refreshToken: authSession.refreshToken }, retryAuth: false });
        authSession = { ...authSession, ...refreshed, account: { ...authSession.account, ...refreshed.account, ...(refreshed.subscription || {}) } };
        saveSession(authSession);
        return apiRequest(path, { method, body, token: authSession.token, retryAuth: false });
      } catch (refreshError) {
        if (refreshError.code === 'subscription_locked') throw refreshError;
      }
    }
    throw error;
  }
  return result;
}

function saveSession(session) {
  authSession = session;
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
}

function userStateCacheKey() {
  const identity = authSession?.userId ? `uid:${authSession.userId}` : `username:${authSession?.account?.username || 'current'}`;
  return `${STORAGE_KEY}:${identity}`;
}

function applyAccountState(accountState) {
  const saved = accountState?.appState || accountState?.app_state || accountState?.state || accountState;
  if (saved && typeof saved === 'object' && !Array.isArray(saved) && ('sites' in saved || 'officeName' in saved)) {
    state = {
      ...structuredClone(initialState),
      ...saved,
      officeName: authSession?.account?.officeName || authSession?.account?.office_name || saved.officeName || initialState.officeName,
      sites: Array.isArray(saved.sites) ? saved.sites : structuredClone(initialState.sites),
      transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
      expenses: Array.isArray(saved.expenses) ? saved.expenses : []
    };
  } else {
    state = { ...structuredClone(initialState), officeName: authSession?.account?.officeName || authSession?.account?.office_name || initialState.officeName };
  }
  localStorage.setItem(userStateCacheKey(), JSON.stringify(state));
}

function logout(message = '') {
  saveSession(null);
  clearTimeout(syncTimer);
  clearInterval(sessionCheckTimer);
  openSiteTabs = [];
  activeSiteTabId = null;
  state = structuredClone(initialState);
  authMessage = message;
  render();
}

function refreshSubscriptionBanner() {
  const container = document.querySelector('.page-container');
  if (!container) return;
  container.querySelector('.subscription-banner')?.remove();
  const banner = subscriptionWarning();
  if (banner) container.insertAdjacentHTML('afterbegin', banner);
}

function subscriptionWarning(account = authSession?.account) {
  if (!account) return '';
  const daysRemaining = Number(account.daysRemaining);
  const daysUntilLock = Number(account.daysUntilLock);
  if (!Number.isFinite(daysRemaining) || daysRemaining > 0 || !Number.isFinite(daysUntilLock)) return '';
  const grace = Math.max(1, daysUntilLock);
  return `<div class="subscription-banner"><strong>مهلة التجديد</strong><span>يجب تجديد الاشتراك لتجنب وقف الحساب خلال ${grace} ${grace === 1 ? 'يوم' : 'أيام'}.</span></div>`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return structuredClone(initialState);
    return {
      ...structuredClone(initialState),
      ...saved,
      sites: Array.isArray(saved.sites) ? saved.sites : structuredClone(initialState.sites),
      transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
      expenses: Array.isArray(saved.expenses) ? saved.expenses : []
    };
  } catch {
    return structuredClone(initialState);
  }
}

function saveState() {
  localStorage.setItem(userStateCacheKey(), JSON.stringify(state));
  if (authSession?.role !== 'client') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await apiRequest('client/state', { method: 'PUT', body: { appState: state } });
    } catch (error) {
      if (error.code === 'subscription_locked') logout('تم إيقاف الحساب لانتهاء مهلة التجديد. تواصل مع المدير لتجديد الاشتراك.');
      else showToast('تعذر مزامنة البيانات مع Supabase. تحقق من الاتصال.', 'error');
    }
  }, 350);
}

function getViewFromHash() {
  const value = window.location.hash.replace('#', '');
  return ['sales', 'settings'].includes(value) ? value : 'home';
}

function isAdminRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const hashRoute = window.location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  return pathname === '/max' || (window.location.protocol === 'file:' && hashRoute === 'max');
}

function trackPublicVisitor() {
  if (!/^https?:$/.test(window.location.protocol) || isAdminRoute()) return;
  try {
    const storageKey = 'albagmi-public-visitor-v1';
    let visitorId = localStorage.getItem(storageKey);
    if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
      visitorId = globalThis.crypto?.randomUUID?.();
      if (!visitorId) return;
      localStorage.setItem(storageKey, visitorId);
    }
    fetch(apiUrl('visit'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId }),
    }).catch(() => {});
  } catch { /* Browsers with blocked local storage are omitted from unique-visitor counts. */ }
}

function navigate(view) {
  activeSiteTabId = null;
  currentView = view;
  window.history.replaceState({}, '', view === 'home' ? `${window.location.pathname}` : `#${view}`);
  render();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function safeUrl(value = '') {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function icon(name, size = 20) {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/><path d="M9 21v-6h6v6"/>',
    sales: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/><path d="M15 6h3v3"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H6v-2.6h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V5h2.6v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v2.6h-.1a1.7 1.7 0 0 0-1.6 1Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    external: '<path d="M14 5h5v5"/><path d="m19 5-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
    edit: '<path d="m4 20 4.5-1L19 8.5a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/><path d="m14.5 7.5 3 3"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    wallet: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 7h15"/><path d="M15 12h5v4h-5a2 2 0 1 1 0-4Z"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5a2 2 0 0 0-2-2h-5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 9h18"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س`;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

function imageMarkup(site, sizeClass = '') {
  const initial = escapeHtml((site.name || '?').trim().slice(0, 1));
  const source = safeUrl(site.image || '');
  return `<div class="site-image ${sizeClass}">${source ? `<img src="${escapeHtml(source)}" alt="" onerror="this.style.display='none';this.nextElementSibling.hidden=false">` : ''}<span class="image-fallback" ${source ? 'hidden' : ''}>${initial}</span></div>`;
}

function render() {
  const root = document.querySelector('#app');
  const adminRoute = isAdminRoute();
  if (authSession?.role === 'admin' && !adminRoute) saveSession(null);
  if (adminRoute && (authSession?.role !== 'admin' || !authSession?.token)) {
    root.innerHTML = renderAuth();
    bindAuthEvents();
    syncDesktopSiteViews();
    return;
  }
  if (adminRoute && authSession?.role === 'admin') {
    root.innerHTML = renderAdmin();
    bindAdminEvents();
    syncDesktopSiteViews();
    return;
  }
  if (authSession?.role !== 'client' || !authSession?.token) {
    root.innerHTML = renderAuth();
    bindAuthEvents();
    syncDesktopSiteViews();
    return;
  }
  root.innerHTML = renderShell();
  bindViewEvents();
  syncDesktopSiteViews();
}

function syncDesktopSiteViews() {
  if (!window.desktopBridge?.syncSiteTabs) return;
  const host = document.querySelector('#embeddedSiteHost');
  if (!host) { window.desktopBridge.syncSiteTabs([], null, null); return; }
  const rect = host.getBoundingClientRect();
  window.desktopBridge.syncSiteTabs(openSiteTabs, activeSiteTabId, {
    x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height),
  });
}

function openSiteTab(site) {
  if (!site || !safeUrl(site.url)) return;
  let tab = openSiteTabs.find((item) => item.id === site.id);
  if (!tab) {
    tab = { id: site.id, name: site.name, url: site.url, image: site.image || '' };
    openSiteTabs.push(tab);
  }
  activeSiteTabId = tab.id;
  currentView = 'home';
  render();
}

function closeSiteTab(id) {
  const index = openSiteTabs.findIndex((item) => item.id === id);
  if (index < 0) return;
  const wasActive = activeSiteTabId === id;
  openSiteTabs.splice(index, 1);
  if (wasActive) activeSiteTabId = openSiteTabs[Math.max(0, index - 1)]?.id || null;
  render();
}

function renderAuth(message = authMessage) {
  const admin = isAdminRoute();
  const returnHref = window.location.protocol === 'file:' ? './index.html' : '/';
  const title = admin ? 'دخول مدير النظام' : 'دخول حساب المكتب';
  const fields = admin
    ? '<label>كلمة مرور لوحة الإدارة<input name="password" type="password" required autocomplete="current-password"></label>'
    : '<label>اسم المستخدم<input name="username" required autocomplete="username" minlength="3"></label><label>كلمة المرور<input name="password" type="password" required autocomplete="current-password"></label>';
  return `<main class="auth-screen"><section class="auth-card"><div class="brand-mark auth-mark">SH</div><p class="eyebrow">نظام إدارة المكتب</p><h1>${title}</h1><p class="page-subtitle">${admin ? 'هذه الصفحة مخصصة لمدير النظام.' : 'استخدم بيانات المكتب التي أنشأها المدير.'}</p>${message ? `<div class="form-alert">${escapeHtml(message)}</div>` : ''}<form id="loginForm" class="auth-form">${fields}<button class="primary-btn" type="submit">دخول آمن</button></form><button id="healthCheck" class="ghost-btn health-check" type="button">فحص اتصال الخدمة</button>${admin ? `<a class="auth-route-link" href="${returnHref}">العودة إلى دخول المكاتب</a>` : '<small class="auth-footnote">لا يوجد إنشاء حساب ذاتي. تواصل مع المدير للحصول على حسابك.</small>'}</section></main>`;
}

let authMessage = '';
let adminAccounts = [];
let adminMetrics = { totalAccounts: 0, activeAccounts: 0, graceAccounts: 0, disabledAccounts: 0, totalLogins: 0, uniqueVisitors: 0 };

function bindAuthEvents() {
  document.querySelector('#loginForm')?.addEventListener('submit', handleLogin);
  document.querySelector('#healthCheck')?.addEventListener('click', checkServiceConnection);
}

async function checkServiceConnection(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'جارٍ الفحص…';
  try {
    const result = await apiRequest('health', { token: null, retryAuth: false });
    if (result.ok !== true && !result.error) {
      authMessage = 'الموقع لا يقدّم دالة /api/health. pnpm dev يشغّل الواجهة فقط؛ استخدم vercel dev أو موقع Vercel منشورًا.';
    } else if (!result.ok) {
      authMessage = result.missing?.length
        ? `إعداد Vercel غير مكتمل: ${result.missing.join('، ')}`
        : result.error === 'analytics_table_unavailable'
          ? 'اتصلنا بـSupabase لكن جدول عدّ الزوار غير متاح.'
          : result.error === 'password_request_table_unavailable'
          ? 'اتصلنا بـSupabase لكن جدول طلبات تغيير كلمة المرور غير موجود أو مفتاح الخدمة لا يملك صلاحية الوصول.'
          : result.error === 'user_data_table_unavailable'
          ? 'اتصلنا بـSupabase لكن جدول بيانات الحسابات حسب UID غير متاح.'
          : 'وصلنا إلى API لكن إعداد Supabase أو جدول الحسابات غير سليم.';
    } else {
      authMessage = 'الاتصال يعمل: واجهة Vercel وSupabase وجداول الحسابات والبيانات والإحصاءات متاحة.';
    }
  } catch (error) {
    if (error.code === 'server_configuration_missing' && error.details?.missing?.length) {
      authMessage = `إعدادات Vercel الناقصة: ${error.details.missing.join('، ')}`;
    } else if (error.code === 'supabase_auth_unreachable') {
      authMessage = 'دالة Vercel تعمل لكن لا تستطيع الاتصال بـSupabase Auth. راجع SUPABASE_URL وSUPABASE_ANON_KEY.';
    } else if (error.code === 'account_table_unavailable') {
      authMessage = 'الاتصال بـSupabase يعمل لكن جدول albagmi_accounts أو مفتاح الخدمة غير جاهز.';
    } else if (error.code === 'user_data_table_unavailable') {
      authMessage = 'الاتصال بـSupabase يعمل لكن جدول albagmi_user_data أو مفتاح الخدمة غير جاهز.';
    } else if (error.code === 'password_request_table_unavailable') {
      authMessage = 'الاتصال بـSupabase يعمل لكن جدول albagmi_password_change_requests أو مفتاح الخدمة غير جاهز.';
    } else if (error.code === 'network_error' || error.status === 404) {
      authMessage = 'تعذر الوصول إلى /api/health. انشر دوال Vercel مع الموقع؛ وفي EXE اضبط VITE_API_BASE_URL وALBAGMI_ALLOWED_ORIGINS.';
    } else {
      authMessage = error.message || 'فشل فحص الاتصال. راجع إعدادات Vercel وSupabase.';
    }
  }
  render();
}

async function handleLogin(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const admin = isAdminRoute();
  button.disabled = true;
  button.textContent = 'جارٍ التحقق…';
  authMessage = '';
  try {
    const result = await apiRequest(admin ? 'admin/login' : 'login', {
      method: 'POST', token: null,
      body: admin ? { password: data.get('password') } : { role: 'client', username: data.get('username'), password: data.get('password') }
    });
    saveSession({ ...result, account: { ...result.account, ...(result.subscription || {}) } });
    if (result.role === 'client') {
      const remote = await apiRequest('client/state');
      applyAccountState(remote);
      authSession.account = { ...authSession.account, ...(remote.subscription || {}) };
      saveSession(authSession);
      await refreshClientPasswordRequest();
      if (!remote.appState || !Object.keys(remote.appState).length) saveState();
      startSessionCheck();
    } else {
      await refreshAdminAccounts();
    }
    currentView = 'home';
    render();
  } catch (error) {
    saveSession(null);
    if (error.code === 'subscription_locked') authMessage = 'انتهت مهلة التجديد وتم إيقاف الحساب. يرجى التواصل مع المدير لتجديد الاشتراك.';
    else if (error.code === 'account_disabled') authMessage = 'هذا الحساب موقوف من مدير النظام. تواصل مع المدير لإعادة تفعيله.';
    else if (error.code === 'invalid_credentials' || error.status === 401) authMessage = admin ? 'كلمة مرور لوحة الإدارة غير صحيحة.' : 'اسم المستخدم أو كلمة المرور غير صحيحة.';
    else if (error.code === 'network_error') authMessage = error.message;
    else if (error.code === 'server_configuration_missing') authMessage = `إعداد Vercel غير مكتمل: ${error.details?.missing?.join('، ') || 'راجع متغيرات البيئة.'}`;
    else if (error.code === 'supabase_auth_unreachable' || error.code === 'account_table_unavailable') authMessage = 'الخادم متصل لكن إعداد Supabase أو جدول الحسابات غير سليم. استخدم «فحص اتصال الخدمة».';
    else authMessage = error.message || 'تعذر تسجيل الدخول. استخدم «فحص اتصال الخدمة» ثم تحقق من إعدادات Vercel.';
    render();
  }
}

function startSessionCheck() {
  clearInterval(sessionCheckTimer);
  sessionCheckTimer = setInterval(async () => {
    if (authSession?.role !== 'client') return;
    try {
      const remote = await apiRequest('client/state');
      authSession.account = { ...authSession.account, ...(remote.subscription || {}) };
      saveSession(authSession);
      refreshSubscriptionBanner();
    } catch (error) {
      if (error.status === 401 || error.code === 'subscription_locked' || error.code === 'account_disabled') logout('الحساب موقوف أو انتهت الجلسة/مهلة الاشتراك. تواصل مع المدير.');
    }
  }, 60_000);
}

async function refreshAdminAccounts() {
  const [accounts, metrics, passwordRequests] = await Promise.all([apiRequest('admin/accounts'), apiRequest('admin/metrics'), apiRequest('admin/password-requests')]);
  adminAccounts = accounts;
  adminMetrics = metrics;
  adminPasswordRequests = passwordRequests;
}

async function refreshClientPasswordRequest() {
  try { clientPasswordRequest = (await apiRequest('client/password-request')).request; }
  catch { clientPasswordRequest = null; }
}

function renderAdmin() {
  const formatNumber = (value) => new Intl.NumberFormat('ar-SA').format(Number(value || 0));
  const rows = adminAccounts.map((account) => {
    const end = account.subscriptionEndsAt ? new Date(account.subscriptionEndsAt).toLocaleDateString('ar-SA') : '—';
    const endTime = Date.parse(account.subscriptionEndsAt || '');
    const enabled = account.isActive !== false;
    const status = !enabled ? 'موقوف إداريًا' : !Number.isFinite(endTime) ? 'حالة غير معروفة' : Date.now() <= endTime ? 'نشط' : Date.now() <= endTime + 5 * 86400000 ? 'مهلة تجديد' : 'مقفل لانتهاء الاشتراك';
    const statusClass = !enabled || status === 'مقفل لانتهاء الاشتراك' ? 'status-disabled' : status === 'مهلة تجديد' ? 'status-grace' : 'status-active';
    const lastLogin = account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجل دخول بعد';
    return `<article class="account-row"><div class="account-main"><div class="account-title-line"><strong>${escapeHtml(account.officeName)}</strong><span class="account-status ${statusClass}">${escapeHtml(status)}</span></div><span>المستخدم: ${escapeHtml(account.username)} · المالك: ${escapeHtml(account.ownerName)} · الهاتف: ${escapeHtml(account.phone)}</span><small>ينتهي الاشتراك: ${escapeHtml(end)} · ${formatNumber(account.subscriptionDays)} يوم</small><small>تسجيلات الدخول: ${formatNumber(account.loginCount)} · آخر دخول: ${escapeHtml(lastLogin)}</small></div><div class="account-actions"><form class="renew-form" data-renew-form="${escapeHtml(account.id)}"><input name="days" type="number" min="1" max="36500" value="30" aria-label="أيام التجديد"><button class="secondary-btn" type="submit">تجديد بالأيام</button></form><details class="account-edit-details"><summary>تعديل بيانات الحساب</summary><form class="form-grid admin-form account-edit-form" data-edit-account-form="${escapeHtml(account.id)}"><label>اسم المستخدم<input name="username" value="${escapeHtml(account.username)}" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" autocomplete="off"></label><label>اسم المكتب<input name="officeName" value="${escapeHtml(account.officeName)}" required maxlength="120"></label><label>اسم صاحب المكتب<input name="ownerName" value="${escapeHtml(account.ownerName)}" required maxlength="120"></label><label>رقم الهاتف<input name="phone" value="${escapeHtml(account.phone)}" required maxlength="40"></label><label>كلمة مرور جديدة (اختياري)<input name="password" type="password" minlength="8" maxlength="1024" autocomplete="new-password" placeholder="اتركه فارغًا دون تغيير"></label><label class="account-toggle-label"><input name="isActive" type="checkbox" ${enabled ? 'checked' : ''}><span>الحساب مفعل</span></label><button class="primary-btn" type="submit">حفظ التعديلات</button></form></details><button class="danger-btn" data-delete-account="${escapeHtml(account.id)}" data-delete-username="${escapeHtml(account.username)}" type="button">حذف الحساب نهائيًا</button></div></article>`;
  }).join('');
  const requests = adminPasswordRequests.map((request) => `<article class="password-request-row"><div><strong>${escapeHtml(request.account?.office_name || 'مكتب')}</strong><small>المستخدم: ${escapeHtml(request.account?.username || '—')} · المالك: ${escapeHtml(request.account?.owner_name || '—')}</small><small>تاريخ الطلب: ${escapeHtml(new Date(request.createdAt).toLocaleString('ar-SA'))}</small></div><div class="request-actions"><button class="primary-btn" data-review-password-request="${escapeHtml(request.id)}" data-decision="approve">موافقة</button><button class="icon-btn danger" data-review-password-request="${escapeHtml(request.id)}" data-decision="reject" aria-label="رفض الطلب">رفض</button></div></article>`).join('');
  return `<main class="admin-screen"><header class="admin-header"><div><p class="eyebrow">إدارة الاشتراكات والاستخدام</p><h1>لوحة مدير النظام</h1><p class="page-subtitle">إدارة حسابات المكاتب ومتابعة الاشتراكات والدخول.</p></div><button class="ghost-btn" data-logout>تسجيل الخروج</button></header><section class="summary-grid admin-stats" aria-label="إحصاءات النظام"><article class="summary-card"><span>حسابات نشطة</span><strong>${formatNumber(adminMetrics.activeAccounts)}</strong><small>من أصل ${formatNumber(adminMetrics.totalAccounts)}</small></article><article class="summary-card"><span>داخل مهلة التجديد</span><strong>${formatNumber(adminMetrics.graceAccounts)}</strong><small>مهلة خمسة أيام</small></article><article class="summary-card"><span>تسجيلات دخول المكاتب</span><strong>${formatNumber(adminMetrics.totalLogins)}</strong><small>منذ تفعيل عدّاد الدخول</small></article><article class="summary-card"><span>زوار فريدون تقريبًا</span><strong>${formatNumber(adminMetrics.uniqueVisitors)}</strong><small>معرّفات متصفحات، لا أشخاص مؤكّدين</small></article></section><p class="helper-text admin-privacy-note">يُحسب الزائر مرة لكل متصفح محفوظ فيه معرّف عشوائي. لا يُسجَّل عنوان IP أو اسم الزائر.</p><section class="panel admin-create"><div class="panel-heading"><div><p class="eyebrow">حساب جديد</p><h2>إنشاء حساب مكتب</h2></div></div><form id="createAccountForm" class="form-grid admin-form"><label>اسم المستخدم<input name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" autocomplete="off"></label><label>كلمة مرور مؤقتة<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><label>اسم المكتب<input name="officeName" required maxlength="120"></label><label>اسم صاحب المكتب<input name="ownerName" required maxlength="120"></label><label>رقم الهاتف<input name="phone" required maxlength="40"></label><label>مدة الاشتراك بالأيام<input name="subscriptionDays" type="number" min="1" max="36500" required value="30"></label><button class="primary-btn" type="submit">إنشاء الحساب</button></form><p class="helper-text">شارك كلمة المرور المؤقتة مع صاحب المكتب بأمان. لا يُسمح بالتسجيل الذاتي.</p></section><section class="panel admin-list"><div class="panel-heading"><div><p class="eyebrow">طلبات تغيير كلمة المرور</p><h2>طلبات تنتظر موافقتك</h2></div></div>${requests || '<div class="small-empty">لا توجد طلبات معلقة.</div>'}</section><section class="panel admin-list"><div class="panel-heading"><div><p class="eyebrow">المشتركون</p><h2>الحسابات المسجلة</h2></div><button class="ghost-btn" data-refresh-accounts>تحديث الإحصاءات والحسابات</button></div>${rows ? `<div class="account-list">${rows}</div>` : '<div class="small-empty">لا توجد حسابات بعد.</div>'}</section></main>`;
}

function bindAdminEvents() {
  document.querySelector('[data-logout]')?.addEventListener('click', () => logout());
  document.querySelector('[data-refresh-accounts]')?.addEventListener('click', async () => { try { await refreshAdminAccounts(); render(); } catch (error) { showToast(error.message, 'error'); } });
  document.querySelectorAll('[data-review-password-request]').forEach((button) => button.addEventListener('click', async () => {
    const decision = button.dataset.decision;
    const prompt = decision === 'approve' ? 'ستُطبق كلمة المرور الجديدة فورًا ولن تظهر لك. هل توافق؟' : 'رفض هذا الطلب سيمسح كلمة المرور المطلوبة. هل تريد الرفض؟';
    if (!window.confirm(prompt)) return;
    button.disabled = true;
    try {
      await apiRequest(`admin/password-requests/${encodeURIComponent(button.dataset.reviewPasswordRequest)}`, { method: 'POST', body: { decision } });
      await refreshAdminAccounts();
      showToast(decision === 'approve' ? 'تمت الموافقة وتغيير كلمة المرور.' : 'تم رفض الطلب ومسح كلمة المرور المشفرة.');
      render();
    } catch (error) { showToast(error.message || 'تعذر تنفيذ القرار.', 'error'); if (button.isConnected) button.disabled = false; }
  }));
  document.querySelectorAll('[data-delete-account]').forEach((button) => button.addEventListener('click', async () => {
    const username = button.dataset.deleteUsername;
    const confirmation = window.prompt(`حذف نهائي لا يمكن التراجع عنه. سيُحذف حساب الدخول وجميع بيانات المكتب والسجلات وطلبات تغيير كلمة المرور. اكتب اسم المستخدم «${username}» للتأكيد:`);
    if (confirmation !== username) return;
    button.disabled = true;
    try {
      await apiRequest(`admin/accounts/${encodeURIComponent(button.dataset.deleteAccount)}`, { method: 'DELETE', body: { confirmUsername: confirmation } });
      await refreshAdminAccounts();
      showToast('تم حذف الحساب وبياناته نهائيًا.');
      render();
    } catch (error) { showToast(error.message || 'تعذر حذف الحساب.', 'error'); if (button.isConnected) button.disabled = false; }
  }));
  document.querySelector('#createAccountForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = Object.fromEntries(data.entries());
    body.subscriptionDays = Number(body.subscriptionDays);
    try {
      await apiRequest('admin/accounts', { method: 'POST', body });
      await refreshAdminAccounts();
      showToast('تم إنشاء الحساب. سلّم بيانات الدخول لصاحبه.');
      render();
    } catch (error) { showToast(error.code === 'conflict' ? 'اسم المستخدم مستخدم بالفعل.' : error.message, 'error'); }
  });
  document.querySelectorAll('[data-edit-account-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    const body = {
      username: data.get('username'), officeName: data.get('officeName'), ownerName: data.get('ownerName'), phone: data.get('phone'),
      isActive: form.querySelector('[name="isActive"]').checked,
    };
    if (password) body.password = password;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ…';
    try {
      await apiRequest(`admin/accounts/${encodeURIComponent(form.dataset.editAccountForm)}`, { method: 'PUT', body });
      await refreshAdminAccounts();
      showToast('تم تحديث بيانات الحساب.');
      render();
    } catch (error) {
      const message = error.code === 'username_taken' || error.code === 'conflict' ? 'اسم المستخدم مستخدم بالفعل.' : error.code === 'invalid_password' ? 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.' : error.code === 'account_update_partial_failure' ? 'تم تحديث بيانات الدخول جزئيًا؛ راجع الحساب قبل إعادة المحاولة.' : error.message;
      showToast(message, 'error');
      if (button.isConnected) { button.disabled = false; button.textContent = 'حفظ التعديلات'; }
    }
  }));
  document.querySelectorAll('[data-renew-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const days = Number(new FormData(form).get('days'));
    try {
      await apiRequest(`admin/accounts/${encodeURIComponent(form.dataset.renewForm)}/renew`, { method: 'POST', body: { days } });
      await refreshAdminAccounts();
      showToast('تم تجديد الاشتراك.');
      render();
    } catch (error) { showToast(error.message, 'error'); }
  }));
}

async function restoreSession() {
  if (isAdminRoute() && authSession?.role === 'client') { render(); return; }
  if (!isAdminRoute() && authSession?.role === 'admin') saveSession(null);
  if (!authSession?.token) { render(); return; }
  try {
    if (authSession.role === 'admin') await refreshAdminAccounts();
    else {
      const remote = await apiRequest('client/state');
      authSession.userId = remote.userId || authSession.userId;
      applyAccountState(remote);
      authSession.account = { ...authSession.account, ...(remote.subscription || {}) };
      saveSession(authSession);
      await refreshClientPasswordRequest();
      startSessionCheck();
    }
  } catch (error) {
    saveSession(null);
    authMessage = error.code === 'account_disabled' ? 'هذا الحساب موقوف من مدير النظام. تواصل مع المدير.' : error.code === 'subscription_locked' ? 'انتهت مهلة التجديد وتم إيقاف الحساب. تواصل مع المدير.' : 'انتهت الجلسة. سجّل الدخول مرة أخرى.';
  }
  render();
}

function renderShell() {
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand-mark">SH</div>
        <div><strong>Service Hub</strong><span>مركز الخدمات</span></div>
      </div>
      <nav class="main-nav" aria-label="التنقل الرئيسي">
        <button class="nav-item ${currentView === 'home' ? 'active' : ''}" data-nav="home">${icon('home')}<span>الرئيسية</span></button>
        <button class="nav-item ${currentView === 'sales' ? 'active' : ''}" data-nav="sales">${icon('sales')}<span>المبيعات</span></button>
        <button class="nav-item ${currentView === 'settings' ? 'active' : ''}" data-nav="settings">${icon('settings')}<span>الإعدادات</span></button>
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span> البيانات محفوظة في Supabase</div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <div class="breadcrumb"><span>Service Hub</span><b>/</b><strong>${activeSiteTabId ? escapeHtml(openSiteTabs.find((tab) => tab.id === activeSiteTabId)?.name || 'موقع خدمة') : currentView === 'home' ? 'الرئيسية' : currentView === 'sales' ? 'المبيعات' : 'الإعدادات'}</strong></div>
        <div class="topbar-actions"><span class="live-badge"><i></i>${escapeHtml(authSession.account?.username || '')}</span><button class="ghost-btn" data-logout>خروج</button><button class="icon-btn" data-nav="settings" aria-label="الإعدادات">${icon('settings', 18)}</button></div>
      </header>
      ${renderSiteTabsBar()}
      ${activeSiteTabId ? renderActiveSiteTab() : `<div class="page-container">${subscriptionWarning()}${currentView === 'home' ? renderHome() : currentView === 'sales' ? renderSales() : renderSettings()}</div>`}
    </main>
  </div>`;
}

function renderSiteTabsBar() {
  return `<nav class="site-tabs-bar" aria-label="تبويبات مواقع الخدمات"><button class="site-home-tab ${activeSiteTabId ? '' : 'selected'}" data-home-tab aria-label="الرئيسية" title="الرئيسية">${icon('home', 18)}<span>الرئيسية</span></button><div class="site-tabs-list">${openSiteTabs.map((tab) => `<div class="site-tab ${activeSiteTabId === tab.id ? 'active' : ''}"><button class="site-tab-select" data-activate-site="${escapeHtml(tab.id)}" title="${escapeHtml(tab.name)}">${imageMarkup(tab, 'tab-image')}<span>${escapeHtml(tab.name)}</span></button><button class="site-tab-close" data-close-site-tab="${escapeHtml(tab.id)}" aria-label="إغلاق ${escapeHtml(tab.name)}">${icon('close', 14)}</button></div>`).join('')}</div></nav>`;
}

function renderActiveSiteTab() {
  const tab = openSiteTabs.find((item) => item.id === activeSiteTabId);
  if (!tab) { activeSiteTabId = null; return `<div class="page-container">${renderHome()}</div>`; }
  const url = safeUrl(tab.url);
  return `<section class="embedded-workspace"><div class="embedded-workspace-title">${imageMarkup(tab, 'viewer-image')}<strong>${escapeHtml(tab.name)}</strong><span>الموقع داخل النظام · لا يظهر الرابط</span>${window.desktopBridge?.printActiveSite ? `<button class="icon-btn site-print-button" data-print-site aria-label="طباعة الصفحة" title="طباعة الصفحة">${icon('receipt', 17)}</button>` : ''}</div><div id="embeddedSiteHost" class="embedded-site-host">${window.desktopBridge?.syncSiteTabs ? '' : url ? `<iframe class="embedded-site-frame" src="${escapeHtml(url)}" title="${escapeHtml(tab.name)}" referrerpolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-downloads allow-modals"></iframe>` : '<div class="embedded-site-error">رابط الخدمة غير صالح.</div>'}</div><p class="embedding-notice">إذا ظهرت رسالة «لا يوجد اتصال» أو صفحة فارغة، فقد يكون الموقع يمنع تضمينه داخل إطار وفق سياسة الحماية لديه. هذا المنع يصدر من الموقع نفسه ولا يمكن تجاوزه بأمان؛ لا يفتح النظام المواقع خارج الصفحة.</p></section>`;
}

function renderHome() {
  const filteredSites = state.sites.filter((site) => {
    const matchesSearch = `${site.name} ${site.category}`.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'الكل' || (categoryFilter === 'المفضلة' ? site.favorite : site.category === categoryFilter);
    return matchesSearch && matchesCategory;
  });
  const categories = ['الكل', 'المفضلة', ...new Set(state.sites.map((site) => site.category))];
  return `<section class="home-view">
    <div class="hero-line"><div><p class="eyebrow">مساحة العمل</p><h1>${escapeHtml(state.officeName)}</h1><p class="page-subtitle">${escapeHtml(authSession.account?.ownerName || '')}${authSession.account?.phone ? ` · ${escapeHtml(authSession.account.phone)}` : ''}</p><p class="page-subtitle">كل مواقع الخدمات التي تحتاجها في مكان واحد.</p><a class="download-desktop-btn" href="https://github.com/macs191/albagmi/releases/latest/download/ServiceHub-Desktop-0.1.1.exe" download>${icon('download', 17)} تنزيل برنامج Windows</a></div><div class="hero-stat"><span>${state.sites.length}</span><small>موقع محفوظ</small></div></div>
    <div class="toolbar"><label class="search-box">${icon('search', 18)}<input id="siteSearch" value="${escapeHtml(searchTerm)}" placeholder="ابحث عن موقع أو خدمة" aria-label="ابحث عن موقع أو خدمة"></label><div class="category-chips">${categories.map((category) => `<button class="chip ${categoryFilter === category ? 'selected' : ''}" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}</div></div>
    <div class="section-heading"><div><p class="eyebrow">المواقع المتاحة</p><h2>اختر الخدمة</h2></div><span class="result-count">${filteredSites.length} موقع</span></div>
    ${filteredSites.length ? `<div class="sites-grid">${filteredSites.map(renderSiteCard).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">${icon('search', 28)}</div><h3>لا توجد نتائج</h3><p>جرّب كلمة بحث مختلفة أو أضف موقعًا جديدًا من الإعدادات.</p></div>`}
  </section>`;
}

function renderSiteCard(site) {
  return `<button class="site-card" data-open-site="${escapeHtml(site.id)}" aria-label="فتح ${escapeHtml(site.name)}">
    <div class="card-topline"><span class="category-label">${escapeHtml(site.category)}</span><span class="favorite-mark ${site.favorite ? 'on' : ''}" data-toggle-favorite="${escapeHtml(site.id)}" role="button" tabindex="0" aria-label="${site.favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}">${icon('star', 15)}</span></div>
    ${imageMarkup(site)}
    <strong>${escapeHtml(site.name)}</strong>
  </button>`;
}

function renderSales() {
  const transactions = state.transactions.filter((item) => selectedSalesDate === 'all' || item.dateKey === selectedSalesDate);
  const expenses = state.expenses.filter((item) => selectedSalesDate === 'all' || item.dateKey === selectedSalesDate);
  const salesTotal = transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expensesTotal = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const net = salesTotal - expensesTotal;
  return `<section class="sales-view">
    <div class="view-title-row"><div><p class="eyebrow">الحسابات اليومية</p><h1>المبيعات والمصروفات</h1><p class="page-subtitle">سجّل معاملاتك وتابع صافي اليوم في لحظة.</p></div><label class="date-picker">${icon('calendar', 17)}<span>تصفية حسب اليوم</span><input id="salesDate" type="date" value="${selectedSalesDate === 'all' ? todayKey() : selectedSalesDate}"></label></div>
    <div class="panel report-tools"><div class="report-description"><p class="eyebrow">التقارير والطباعة</p><h2>تقارير المكتب</h2><p class="helper-text">اطبع تقرير اليوم المحدد أو ملخص الشهر على ورقة A4.</p></div><div class="report-actions"><button class="secondary-btn" id="printDailyReport" type="button">طباعة التقرير اليومي A4</button><label class="report-month">شهر التقرير<input id="reportMonth" type="month" value="${selectedReportMonth}"></label><button class="primary-btn" id="printMonthlyReport" type="button">طباعة التقرير الشهري A4</button></div></div>
    <div class="summary-grid"><div class="summary-card sales"><span class="summary-icon">${icon('receipt')}</span><div><small>إجمالي المعاملات</small><strong>${formatMoney(salesTotal)}</strong></div></div><div class="summary-card expense"><span class="summary-icon">${icon('wallet')}</span><div><small>إجمالي المصروفات</small><strong>${formatMoney(expensesTotal)}</strong></div></div><div class="summary-card net"><span class="summary-icon">${icon('sales')}</span><div><small>صافي اليوم</small><strong>${formatMoney(net)}</strong></div></div></div>
    <div class="sales-layout"><div class="panel form-panel"><div class="panel-heading"><div><p class="eyebrow">إضافة جديدة</p><h2>تسجيل معاملة</h2></div><span class="panel-index">01</span></div><form id="transactionForm" class="form-grid"><label>اسم العميل<input name="customer" required placeholder="مثال: عبدالله محمد"></label><label>نوع الخدمة<select name="siteId" required>${state.sites.length ? state.sites.map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`).join('') : '<option value="">أضف خدمة من الإعدادات أولًا</option>'}</select></label><label>سعر المعاملة<input name="amount" required type="number" min="0" step="0.01" placeholder="0.00"></label><button class="primary-btn" type="submit">${icon('plus', 17)} تسجيل المعاملة</button></form></div><div class="panel form-panel expense-panel"><div class="panel-heading"><div><p class="eyebrow">إدارة المصاريف</p><h2>تسجيل مصروف</h2></div><span class="panel-index">02</span></div><form id="expenseForm" class="form-grid"><label>نوع المصروف<input name="description" required placeholder="مثال: طعام، وقود، شحن"></label><label>القيمة<input name="amount" required type="number" min="0" step="0.01" placeholder="0.00"></label><button class="secondary-btn" type="submit">${icon('plus', 17)} إضافة المصروف</button></form></div></div>
    <div class="records-layout"><div class="panel records-panel"><div class="panel-heading"><div><p class="eyebrow">الحركة المالية</p><h2>المعاملات</h2></div><span class="record-count">${transactions.length}</span></div>${transactions.length ? `<div class="records-list">${transactions.slice().reverse().map((item) => `<div class="record-row"><span class="record-avatar">${escapeHtml(item.customer.trim().slice(0, 1))}</span><div class="record-main"><strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.siteName)} · ${formatDateTime(item.createdAt)}</small></div><b class="amount-positive">+ ${formatMoney(item.amount)}</b><button class="row-delete" data-delete-record="transaction:${item.id}" aria-label="حذف المعاملة">${icon('trash', 17)}</button></div>`).join('')}</div>` : `<div class="small-empty">لا توجد معاملات في التاريخ المحدد.</div>`}</div><div class="panel records-panel"><div class="panel-heading"><div><p class="eyebrow">المصروفات</p><h2>المصاريف اليومية</h2></div><span class="record-count">${expenses.length}</span></div>${expenses.length ? `<div class="records-list">${expenses.slice().reverse().map((item) => `<div class="record-row"><span class="record-avatar expense-avatar">${icon('wallet', 17)}</span><div class="record-main"><strong>${escapeHtml(item.description)}</strong><small>${formatDateTime(item.createdAt)}</small></div><b class="amount-negative">- ${formatMoney(item.amount)}</b><button class="row-delete" data-delete-record="expense:${item.id}" aria-label="حذف المصروف">${icon('trash', 17)}</button></div>`).join('')}</div>` : `<div class="small-empty">لا توجد مصروفات في التاريخ المحدد.</div>`}</div></div>
  </section>`;
}

function renderSettings() {
  const editingSite = state.sites.find((site) => site.id === editingSiteId);
  const requestStatus = clientPasswordRequest?.status === 'pending' ? 'طلب تغيير كلمة المرور قيد مراجعة المدير.' : clientPasswordRequest?.status === 'approved' ? 'وافق المدير على آخر طلب تغيير كلمة المرور.' : clientPasswordRequest?.status === 'rejected' ? 'رفض المدير آخر طلب تغيير كلمة المرور؛ يمكنك إرسال طلب جديد.' : 'تغيير كلمة المرور يحتاج موافقة مدير النظام.';
  return `<section class="settings-view"><div class="view-title-row"><div><p class="eyebrow">التحكم في التطبيق</p><h1>الإعدادات</h1><p class="page-subtitle">إدارة بيانات المكتب وكلمة المرور ومواقع الخدمات.</p></div></div>
    <div class="settings-grid"><div class="panel office-panel"><div class="panel-heading"><div><p class="eyebrow">بيانات الحساب</p><h2>${escapeHtml(authSession.account?.officeName || state.officeName)}</h2></div></div><p class="helper-text">صاحب المكتب: ${escapeHtml(authSession.account?.ownerName || '—')}</p><p class="helper-text">رقم الهاتف: ${escapeHtml(authSession.account?.phone || '—')}</p><p class="helper-text">اسم الدخول: ${escapeHtml(authSession.account?.username || '—')}</p><form id="officeNameForm" class="form-grid account-settings-form"><label class="full-span">اسم المكتب<input name="officeName" required maxlength="120" value="${escapeHtml(authSession.account?.officeName || state.officeName)}"></label><button class="primary-btn" type="submit">حفظ اسم المكتب</button></form><hr class="settings-divider"><form id="passwordChangeRequestForm" class="form-grid account-settings-form"><p class="helper-text full-span">${requestStatus}</p><label>كلمة المرور الجديدة<input name="password" type="password" required minlength="8" maxlength="1024" autocomplete="new-password"></label><label>تأكيد كلمة المرور<input name="confirmPassword" type="password" required minlength="8" maxlength="1024" autocomplete="new-password"></label><button class="secondary-btn full-span" type="submit" ${clientPasswordRequest?.status === 'pending' ? 'disabled' : ''}>إرسال طلب تغيير كلمة المرور</button></form></div><div class="panel add-site-panel"><div class="panel-heading"><div><p class="eyebrow">دليل المواقع</p><h2>${editingSite ? 'تعديل موقع' : 'إضافة موقع جديد'}</h2></div>${editingSite ? `<button class="text-btn" data-cancel-edit>إلغاء التعديل</button>` : ''}</div><form id="siteForm" class="form-grid site-form"><label>اسم الموقع<input name="name" required value="${editingSite ? escapeHtml(editingSite.name) : ''}" placeholder="مثال: تأميني"></label><label>التصنيف<input name="category" required value="${editingSite ? escapeHtml(editingSite.category) : ''}" placeholder="مثال: التأمين"></label><label class="full-span">رابط الموقع<input name="url" type="url" required value="${editingSite ? escapeHtml(editingSite.url) : ''}" placeholder="https://example.com"></label><label class="full-span">رابط الصورة <span class="label-hint">اختياري</span><input name="imageUrl" type="url" value="${editingSite && !editingSite.image?.startsWith('data:') ? escapeHtml(editingSite.image) : ''}" placeholder="https://example.com/logo.png"></label><label class="file-picker full-span">أو اختر صورة من الجهاز<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><span>${icon('image', 17)} اختيار ملف صورة</span></label><button class="primary-btn" type="submit">${icon(editingSite ? 'edit' : 'plus', 17)} ${editingSite ? 'حفظ التعديل' : 'إضافة الموقع'}</button></form></div></div>
    <div class="panel manage-panel"><div class="panel-heading"><div><p class="eyebrow">إدارة المحتوى</p><h2>المواقع المضافة</h2></div><span class="record-count">${state.sites.length}</span></div><div class="manage-list">${state.sites.map((site) => `<div class="manage-row">${imageMarkup(site, 'mini-image')}<div class="record-main"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.category)}</small></div><div class="manage-actions"><button class="icon-btn" data-edit-site="${escapeHtml(site.id)}" aria-label="تعديل ${escapeHtml(site.name)}">${icon('edit', 17)}</button><button class="icon-btn danger" data-delete-site="${escapeHtml(site.id)}" aria-label="حذف ${escapeHtml(site.name)}">${icon('trash', 17)}</button></div></div>`).join('')}</div></div>
  </section>`;
}

function bindViewEvents() {
  document.querySelector('[data-logout]')?.addEventListener('click', () => logout());
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
  document.querySelector('[data-home-tab]')?.addEventListener('click', () => navigate('home'));
  document.querySelector('[data-print-site]')?.addEventListener('click', () => window.desktopBridge?.printActiveSite?.());
  document.querySelectorAll('[data-activate-site]').forEach((button) => button.addEventListener('click', () => { activeSiteTabId = button.dataset.activateSite; render(); }));
  document.querySelectorAll('[data-close-site-tab]').forEach((button) => button.addEventListener('click', () => closeSiteTab(button.dataset.closeSiteTab)));
  document.querySelectorAll('[data-open-site]').forEach((button) => button.addEventListener('click', () => {
    const site = state.sites.find((item) => item.id === button.dataset.openSite);
    if (site) openSiteTab(site);
  }));
  document.querySelectorAll('[data-toggle-favorite]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const site = state.sites.find((item) => item.id === button.dataset.toggleFavorite);
    if (site) { site.favorite = !site.favorite; saveState(); render(); }
  }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { categoryFilter = button.dataset.filter; render(); }));
  const search = document.querySelector('#siteSearch');
  if (search) search.addEventListener('input', (event) => { searchTerm = event.target.value; render(); const next = document.querySelector('#siteSearch'); next?.focus(); next?.setSelectionRange(searchTerm.length, searchTerm.length); });
  const salesDate = document.querySelector('#salesDate');
  if (salesDate) salesDate.addEventListener('change', (event) => { selectedSalesDate = event.target.value; render(); });
  const reportMonth = document.querySelector('#reportMonth');
  if (reportMonth) reportMonth.addEventListener('change', (event) => { selectedReportMonth = event.target.value || todayKey().slice(0, 7); });
  document.querySelector('#printDailyReport')?.addEventListener('click', () => {
    const dateKey = selectedSalesDate && selectedSalesDate !== 'all' ? selectedSalesDate : todayKey();
    const report = aggregateDailyReport(dateKey, state.transactions, state.expenses);
    const html = renderDailyReportHtml({ officeName: authSession.account?.officeName || state.officeName, report });
    if (!openPrintWindow(html)) showToast('اسمح بفتح النوافذ المنبثقة لطباعة التقرير.', 'error');
  });
  document.querySelector('#printMonthlyReport')?.addEventListener('click', () => {
    const report = aggregateMonthlyReport(selectedReportMonth, state.transactions, state.expenses);
    const html = renderMonthlyReportHtml({ officeName: authSession.account?.officeName || state.officeName, report });
    if (!openPrintWindow(html)) showToast('اسمح بفتح النوافذ المنبثقة لطباعة التقرير.', 'error');
  });
  document.querySelector('#transactionForm')?.addEventListener('submit', handleTransactionSubmit);
  document.querySelector('#expenseForm')?.addEventListener('submit', handleExpenseSubmit);
  document.querySelector('#siteForm')?.addEventListener('submit', handleSiteSave);
  document.querySelector('#officeNameForm')?.addEventListener('submit', handleOfficeNameSave);
  document.querySelector('#passwordChangeRequestForm')?.addEventListener('submit', handlePasswordChangeRequest);
  document.querySelector('[data-cancel-edit]')?.addEventListener('click', () => { editingSiteId = null; render(); });
  document.querySelectorAll('[data-edit-site]').forEach((button) => button.addEventListener('click', () => { editingSiteId = button.dataset.editSite; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelectorAll('[data-delete-site]').forEach((button) => button.addEventListener('click', () => deleteSite(button.dataset.deleteSite)));
  document.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', () => deleteRecord(button.dataset.deleteRecord)));
}

async function handleSiteSave(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const wasEditing = Boolean(editingSiteId);
  const name = String(formData.get('name') || '').trim();
  const category = String(formData.get('category') || '').trim();
  const url = safeUrl(String(formData.get('url') || '').trim());
  if (!url) return showToast('أدخل رابطًا صحيحًا يبدأ بـ https:// أو http://', 'error');
  const file = formData.get('imageFile');
  let image = String(formData.get('imageUrl') || '').trim();
  if (file instanceof File && file.size) image = await fileToDataUrl(file);
  const oldSite = state.sites.find((site) => site.id === editingSiteId);
  const record = { id: editingSiteId || uid('site'), name, category, url, image: image || oldSite?.image || '', favorite: oldSite?.favorite || false };
  if (editingSiteId) state.sites = state.sites.map((site) => site.id === editingSiteId ? record : site);
  else state.sites.push(record);
  saveState();
  editingSiteId = null;
  showToast(wasEditing ? 'تم تحديث الموقع' : 'تمت إضافة الموقع');
  render();
}

async function handleOfficeNameSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const officeName = String(new FormData(form).get('officeName') || '').trim();
  if (!officeName) return showToast('أدخل اسم المكتب.', 'error');
  try {
    const account = await apiRequest('client/account', { method: 'PATCH', body: { officeName } });
    authSession.account = { ...authSession.account, ...account };
    state.officeName = officeName;
    saveSession(authSession);
    saveState();
    showToast('تم تحديث اسم المكتب.');
    render();
  } catch (error) { showToast(error.message || 'تعذر حفظ اسم المكتب.', 'error'); }
}

async function handlePasswordChangeRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const password = String(data.get('password') || '');
  if (password !== String(data.get('confirmPassword') || '')) return showToast('كلمتا المرور غير متطابقتين.', 'error');
  try {
    await apiRequest('client/password-request', { method: 'POST', body: { password } });
    await refreshClientPasswordRequest();
    showToast('أُرسل طلب تغيير كلمة المرور إلى المدير للموافقة.');
    render();
  } catch (error) {
    showToast(error.code === 'password_request_pending' ? 'لديك طلب تغيير كلمة مرور قيد المراجعة.' : error.message || 'تعذر إرسال الطلب.', 'error');
  }
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amount = Number(data.get('amount'));
  const site = state.sites.find((item) => item.id === data.get('siteId'));
  if (!site || !amount || amount < 0) return showToast('أدخل بيانات المعاملة بشكل صحيح', 'error');
  const createdAt = new Date().toISOString();
  state.transactions.push({ id: uid('txn'), customer: String(data.get('customer')).trim(), siteId: site.id, siteName: site.name, amount, createdAt, dateKey: todayKey() });
  saveState();
  showToast('تم تسجيل المعاملة');
  render();
}

function handleExpenseSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amount = Number(data.get('amount'));
  if (!String(data.get('description')).trim() || !amount || amount < 0) return showToast('أدخل وصف وقيمة المصروف', 'error');
  const createdAt = new Date().toISOString();
  state.expenses.push({ id: uid('exp'), description: String(data.get('description')).trim(), amount, createdAt, dateKey: todayKey() });
  saveState();
  showToast('تمت إضافة المصروف');
  render();
}

function deleteSite(id) {
  const site = state.sites.find((item) => item.id === id);
  if (!site || !window.confirm(`حذف موقع «${site.name}»؟`)) return;
  state.sites = state.sites.filter((item) => item.id !== id);
  saveState();
  showToast('تم حذف الموقع');
  render();
}

function deleteRecord(value) {
  const [type, id] = value.split(':');
  if (!window.confirm('هل تريد حذف هذا السجل؟')) return;
  if (type === 'transaction') state.transactions = state.transactions.filter((item) => item.id !== id);
  if (type === 'expense') state.expenses = state.expenses.filter((item) => item.id !== id);
  saveState();
  showToast('تم حذف السجل');
  render();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  toastTimer = setTimeout(() => toast.remove(), 2600);
}

window.addEventListener('hashchange', () => { currentView = getViewFromHash(); activeSiteTabId = null; render(); });
window.addEventListener('resize', () => syncDesktopSiteViews());
window.desktopBridge?.onSitePopup?.(({ url, title }) => {
  const safe = safeUrl(url);
  if (!safe) return;
  openSiteTab({ id: uid('popup'), name: String(title || 'صفحة خدمة').slice(0, 120), url: safe, image: '' });
});
trackPublicVisitor();
restoreSession();
