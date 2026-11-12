import './styles.css';
import { aggregateDailyReport, aggregateRangeReport, openPrintWindow, renderDailyReportHtml, renderRangeReportHtml } from './reports.js';
import './public-page.css';
import { renderPublicOfficePage, renderPublicPageLoading, renderPublicPageUnavailable } from './public-page.js';
import { bankBalance } from './banks.js';
import { renderBankView, renderPaymentMethodFields } from './bank-view.js';
import { extractScannerFields, normalizeOcrText } from './scanner-text.js';
import { renderDocuments, bindDocuments } from './documents.js';
import { renderWebSales, renderWebBanks } from './web-readonly.js';

const STORAGE_KEY = 'servicehub-desktop-v1';
const SESSION_KEY = 'albagmi-session-v1';
const NOTEPAD_STORAGE_KEY = 'servicehub-notepad-v1';
const SCANNER_STORAGE_KEY = 'servicehub-scanner-v1';
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
  officeLocation: '',
  sites: defaultSites,
  transactions: [],
  expenses: [],
  bankAccounts: [],
  bankOperations: []
};

let state = loadState();
let authSession = loadSession();
let debtRecords = loadDesktopCollection('debts');
let invoices = loadDesktopCollection('invoices');
let scannerDocuments = loadDesktopCollection('scans');
const publicPageSlug = window.location.pathname.match(/^\/m\/([a-z0-9._-]{3,40})\/?$/i)?.[1]?.toLowerCase() || '';
let publicOfficeProfile = null;
let publicPageLoading = Boolean(publicPageSlug);
let syncTimer;
let sessionCheckTimer;
let currentView = getViewFromHash();
let openSiteTabs = [];
let activeSiteTabId = null;
let notepadText = loadNotepad();
let selectedScannerDocumentId = scannerDocuments[0]?.id || null;
let scannerPreviewUrl = '';
let scannerBusy = false;
let scannerOcrStatus = '';
let scannerOcrLanguage = 'ara+eng';
let clientPasswordRequest = null;
let adminPasswordRequests = [];
let searchTerm = '';
let categoryFilter = 'الكل';
let selectedSalesDate = todayKey();
let selectedReportMonth = todayKey().slice(0, 7);
let selectedBankAccountId = null;
let bankPeriodMode = 'daily';
let bankPeriodDate = todayKey();
let bankPeriodMonth = todayKey().slice(0, 7);
let bankActionModal = null;
let settingsDialog = null;
let editingSiteId = null;
let reportDialogMode = null;
let reportDialogStart = todayKey();
let reportDialogEnd = todayKey();
let recordToDelete = null;
let toastTimer;
let desktopSiteResizeObserver;
let observedDesktopSiteHost = null;
let desktopSyncFrame = 0;

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
  debtRecords = session?.role === 'client' ? loadDesktopCollection('debts') : [];
  invoices = session?.role === 'client' ? loadDesktopCollection('invoices') : [];
  scannerDocuments = session?.role === 'client' ? loadDesktopCollection('scans') : [];
  selectedScannerDocumentId = scannerDocuments[0]?.id || null;
  scannerPreviewUrl = '';
}

function desktopCollectionKey(name) {
  const identity = authSession?.userId ? `uid:${authSession.userId}` : `username:${authSession?.account?.username || 'current'}`;
  return `servicehub-desktop-${name}-v1:${identity}`;
}

function loadDesktopCollection(name) {
  try {
    const stored = JSON.parse(localStorage.getItem(desktopCollectionKey(name)) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch { return []; }
}

function saveDesktopCollection(name, collection) {
  localStorage.setItem(desktopCollectionKey(name), JSON.stringify(collection));
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
      officeLocation: typeof saved.officeLocation === 'string' ? saved.officeLocation : '',
      sites: Array.isArray(saved.sites) ? saved.sites : structuredClone(initialState.sites),
      transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
      expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
      bankAccounts: Array.isArray(saved.bankAccounts) ? saved.bankAccounts : [],
      bankOperations: Array.isArray(saved.bankOperations) ? saved.bankOperations : []
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
      officeLocation: typeof saved.officeLocation === 'string' ? saved.officeLocation : '',
      sites: Array.isArray(saved.sites) ? saved.sites : structuredClone(initialState.sites),
      transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
      expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
      bankAccounts: Array.isArray(saved.bankAccounts) ? saved.bankAccounts : [],
      bankOperations: Array.isArray(saved.bankOperations) ? saved.bankOperations : []
    };
  } catch {
    return structuredClone(initialState);
  }
}

function saveState(deletionPassword, immediate = false) {
  localStorage.setItem(userStateCacheKey(), JSON.stringify(state));
  if (authSession?.role !== 'client') return;
  clearTimeout(syncTimer);
  const sync = async () => {
    try {
      await apiRequest('client/state', { method: 'PUT', body: { appState: state, ...(typeof deletionPassword === 'string' ? { deletionPassword } : {}) } });
    } catch (error) {
      if (typeof deletionPassword === 'string' || immediate) throw error;
      if (error.code === 'subscription_locked') logout('تم إيقاف الحساب لانتهاء مهلة التجديد. تواصل مع المدير لتجديد الاشتراك.');
      else showToast('تعذر مزامنة البيانات مع Supabase. تحقق من الاتصال.', 'error');
    }
  };
  if (typeof deletionPassword === 'string' || immediate) return sync();
  syncTimer = setTimeout(sync, 350);
}

function getViewFromHash() {
  const hashRoute = window.location.hash.replace(/^#/, '');
  const desktopViews = window.desktopBridge?.syncSiteTabs ? ['notepad', 'scanner', 'banks', 'debts', 'invoices', 'documents'] : [];
  const webViews = window.desktopBridge?.syncSiteTabs ? [] : ['banks'];
  return [...desktopViews, ...webViews, 'sales', 'settings'].includes(hashRoute) ? hashRoute : 'home';
}

function notepadStorageKey() {
  const identity = authSession?.userId ? `uid:${authSession.userId}` : `username:${authSession?.account?.username || 'current'}`;
  return `${NOTEPAD_STORAGE_KEY}:${identity}`;
}

function loadNotepad() {
  try { return localStorage.getItem(notepadStorageKey()) || ''; } catch { return ''; }
}

function saveNotepad(value) {
  notepadText = String(value || '');
  localStorage.setItem(notepadStorageKey(), notepadText);
  const status = document.querySelector('#notepadSaveStatus');
  if (status) status.textContent = 'تم الحفظ على هذا الجهاز';
}

function saveScannerDocuments() {
  saveDesktopCollection('scans', scannerDocuments);
}

async function startScannerAcquisition() {
  if (scannerBusy) return;
  if (!window.desktopBridge?.acquireScannerImage) return showToast('ميزة الماسح متاحة في تطبيق Windows فقط.', 'error');
  if (scannerDocuments.length >= 100) return showToast('وصل سجل الماسح إلى 100 مستند. احذف مستندات قديمة أولًا.', 'error');
  scannerBusy = true;
  scannerOcrStatus = 'يتم الاتصال بالماسح…';
  render();
  try {
    const result = await window.desktopBridge.acquireScannerImage();
    if (!result || result.cancelled) {
      scannerBusy = false;
      scannerOcrStatus = '';
      render();
      return;
    }
    const document = { id: result.id, filename: result.filename, createdAt: result.createdAt, size: result.size, text: '' };
    scannerDocuments.unshift(document);
    selectedScannerDocumentId = document.id;
    scannerPreviewUrl = '';
    saveScannerDocuments();
    scannerBusy = false;
    scannerOcrStatus = 'جارٍ تحميل صورة المستند…';
    render();
    await openScannerDocument(document.id);
  } catch (error) {
    scannerBusy = false;
    scannerOcrStatus = '';
    render();
    showToast(error.message || 'تعذر الاتصال بالماسح. تحقق من تعريف Windows WIA.', 'error');
  }
}

async function openScannerDocument(id) {
  selectedScannerDocumentId = id;
  scannerPreviewUrl = '';
  scannerOcrStatus = 'جارٍ تحميل صورة المستند…';
  render();
  try {
    const imageUrl = await window.desktopBridge.readScannerImage(id);
    if (selectedScannerDocumentId !== id) return;
    scannerPreviewUrl = imageUrl;
    const document = scannerDocuments.find((item) => item.id === id);
    if (document && !document.text) await extractScannerText(id);
    else { scannerOcrStatus = 'يمكنك مراجعة النص وتصحيحه قبل نسخه.'; render(); }
  } catch {
    scannerOcrStatus = 'تعذر فتح صورة هذا المستند. قد يكون الملف حُذف من الكمبيوتر.';
    render();
  }
}

async function extractScannerText(id) {
  scannerBusy = true;
  scannerOcrStatus = 'تهيئة محرك OCR المحلي…';
  render();
  const removeProgressListener = window.desktopBridge?.onScannerOcrProgress?.((message) => {
    if (message?.id !== id || selectedScannerDocumentId !== id) return;
    const statusLabels = { 'loading tesseract core': 'تهيئة محرك OCR المحلي', 'initializing tesseract': 'تهيئة محرك القراءة', 'loading language traineddata': 'تحميل نماذج العربية والإنجليزية من الجهاز', 'initializing api': 'تهيئة اللغات', 'recognizing text': 'قراءة محتوى المستند' };
    const progress = Number.isFinite(message.progress) ? ` · ${Math.round(message.progress * 100)}٪` : '';
    scannerOcrStatus = `${statusLabels[message.status] || 'معالجة المستند'}${progress}`;
    const status = document.querySelector('#scannerOcrStatus');
    if (status) status.textContent = scannerOcrStatus;
  });
  try {
    const result = await window.desktopBridge.recognizeScannerText(id, scannerOcrLanguage);
    const documentRecord = scannerDocuments.find((item) => item.id === id);
    if (documentRecord) {
      documentRecord.text = normalizeOcrText(result.text).slice(0, 100000);
      saveScannerDocuments();
      const confidence = Number.isFinite(result.confidence) && result.confidence > 0 ? ` · الثقة التقريبية ${Math.round(result.confidence)}٪` : '';
      const sourceHint = result.preprocessed === false ? ' · تمت القراءة من الصورة الأصلية' : '';
      scannerOcrStatus = documentRecord.text ? `اكتمل استخراج النص. راجعه وصححه قبل النسخ.${confidence}${sourceHint}` : 'لم يظهر نص واضح؛ جرّب لغة أخرى أو ارفع دقة المسح إلى 300 DPI ثم أعد المحاولة.';
    }
  } catch (error) {
    console.error('[Service Hub OCR] Failed to initialize or recognize text:', error);
    scannerOcrStatus = `تعذر تشغيل محرك OCR المحلي. ${String(error?.message || '').slice(0, 350)} يمكنك كتابة النص يدويًا.`;
    showToast('تعذر تشغيل OCR المحلي. صورة المستند محفوظة ويمكنك إدخال النص يدويًا.', 'error');
  } finally {
    removeProgressListener?.();
    scannerBusy = false;
    render();
  }
}

async function copyScannerText() {
  const document = scannerDocuments.find((item) => item.id === selectedScannerDocumentId);
  if (!document?.text) return showToast('لا يوجد نص لنسخه.', 'error');
  try {
    if (window.desktopBridge?.copyText) await window.desktopBridge.copyText(document.text);
    else await navigator.clipboard.writeText(document.text);
    showToast('تم نسخ النص المستخرج.');
  } catch { showToast('تعذر نسخ النص إلى الحافظة.', 'error'); }
}

async function deleteScannerDocument(id) {
  const item = scannerDocuments.find((document) => document.id === id);
  if (!item || !window.confirm(`سيُحذف المستند وصورته نهائيًا من هذا الكمبيوتر. هل تريد متابعة حذف «${item.filename}»؟`)) return;
  try { await window.desktopBridge?.deleteScannerImage?.(id); } catch { return showToast('تعذر حذف صورة المستند من الكمبيوتر.', 'error'); }
  scannerDocuments = scannerDocuments.filter((document) => document.id !== id);
  if (selectedScannerDocumentId === id) {
    selectedScannerDocumentId = scannerDocuments[0]?.id || null;
    scannerPreviewUrl = '';
  }
  scannerOcrStatus = '';
  saveScannerDocuments();
  render();
  if (selectedScannerDocumentId) await openScannerDocument(selectedScannerDocumentId);
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
    notepad: '<path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h8V3M8 13h8M8 17h8"/>',
    scanner: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M7 9h10v7H7zM9 12h6M9 14h4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M4.9 9A7.5 7.5 0 0 1 18 6.4L20 12M4 17v-5h5"/><path d="M19.1 15A7.5 7.5 0 0 1 6 17.6L4 12"/>',
    bank: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/><circle cx="17" cy="15" r="1"/>',
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
  if (publicPageSlug) {
    if (authSession?.role === 'admin') saveSession(null);
    if (publicOfficeProfile) {
      document.title = `${publicOfficeProfile.officeName} | خدمات المكتب`;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = `خدمات النقل والتأمين والخدمات الإلكترونية لدى ${publicOfficeProfile.officeName}.`;
      root.innerHTML = renderPublicOfficePage(publicOfficeProfile);
      bindPublicPageEvents();
    } else {
      root.innerHTML = publicPageLoading ? renderPublicPageLoading() : renderPublicPageUnavailable();
    }
    return;
  }
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

async function loadPublicOfficePage() {
  render();
  try {
    publicOfficeProfile = await apiRequest(`public-page/${encodeURIComponent(publicPageSlug)}`, { token: null, retryAuth: false });
  } catch {
    publicOfficeProfile = null;
  } finally {
    publicPageLoading = false;
    render();
  }
}

function bindPublicPageEvents() {
  const input = document.querySelector('#publicServiceSearch');
  input?.addEventListener('input', () => {
    const queryText = input.value.trim().toLocaleLowerCase('ar');
    let visibleCount = 0;
    document.querySelectorAll('[data-public-group]').forEach((group) => {
      const heading = group.querySelector('.public-service-group-head')?.textContent.toLocaleLowerCase('ar') || '';
      let groupCount = 0;
      group.querySelectorAll('[data-public-service]').forEach((link) => {
        const matches = !queryText || heading.includes(queryText) || link.dataset.publicService.toLocaleLowerCase('ar').includes(queryText);
        link.hidden = !matches;
        if (matches) groupCount += 1;
      });
      group.hidden = groupCount === 0;
      visibleCount += groupCount;
    });
    const counter = document.querySelector('#publicServiceCount');
    if (counter) counter.textContent = `${visibleCount} خدمة`;
    const empty = document.querySelector('#publicNoServices');
    if (empty) empty.hidden = visibleCount > 0;
  });
}

function officePublicPageUrl() {
  const slug = authSession?.account?.publicSlug;
  if (!slug) return '';
  const origin = /^https?:$/.test(window.location.protocol) ? window.location.origin : API_BASE_URL || 'https://albagmi.vercel.app';
  try { return new URL(`/m/${encodeURIComponent(slug)}`, origin).href; } catch { return ''; }
}

function mountPublicPageSettings() {
  const panel = document.querySelector('.public-settings-panel');
  if (!panel || panel.querySelector('.public-profile-settings')) return;
  const pageUrl = officePublicPageUrl();
  const linkMarkup = pageUrl
    ? `<div class="public-page-link-row"><a href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pageUrl)}</a><button type="button" class="secondary-btn" data-copy-public-page>نسخ الرابط</button></div>`
    : '<p class="helper-text">سيظهر رابط الصفحة بعد تحديث بيانات الحساب.</p>';
  panel.insertAdjacentHTML('beforeend', `<section class="public-profile-settings"><div><p class="eyebrow">صفحة المكتب العامة</p><h3>رابط الخدمات والتواصل</h3><p class="helper-text">هذه الصفحة تعرض اسم المكتب ورقم الحساب وقائمة الخدمات؛ يفتح اختيار الخدمة محادثة WhatsApp مباشرة.</p></div>${linkMarkup}<form id="officeLocationForm" class="form-grid account-settings-form"><label class="full-span">موقع المكتب على خرائط Google<input name="officeLocation" type="url" maxlength="2048" value="${escapeHtml(state.officeLocation || '')}" placeholder="https://maps.app.goo.gl/…"></label><p class="helper-text full-span">انسخ رابط المشاركة من Google Maps. سيظهر زر الموقع في صفحة المكتب العامة.</p><button type="submit" class="primary-btn">حفظ موقع المكتب</button></form></section>`);
}

function syncDesktopSiteViews() {
  if (!window.desktopBridge?.syncSiteTabs) return;
  const host = document.querySelector('#embeddedSiteHost');
  if (host !== observedDesktopSiteHost) {
    if (observedDesktopSiteHost) desktopSiteResizeObserver?.unobserve(observedDesktopSiteHost);
    observedDesktopSiteHost = host;
    if (host) desktopSiteResizeObserver?.observe(host);
  }
  if (!host) { window.desktopBridge.syncSiteTabs(openSiteTabs, null, null); return; }
  const rect = host.getBoundingClientRect();
  const width = Math.max(rect.width, window.innerWidth - rect.left);
  const height = Math.max(rect.height, window.innerHeight - rect.top);
  window.desktopBridge.syncSiteTabs(openSiteTabs, activeSiteTabId, {
    x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(width), height: Math.round(height),
  });
}

function scheduleDesktopSiteSync() {
  if (!window.desktopBridge?.syncSiteTabs || desktopSyncFrame) return;
  desktopSyncFrame = requestAnimationFrame(() => {
    desktopSyncFrame = 0;
    syncDesktopSiteViews();
  });
}

if (window.desktopBridge?.syncSiteTabs) {
  if (typeof ResizeObserver !== 'undefined') desktopSiteResizeObserver = new ResizeObserver(scheduleDesktopSiteSync);
  window.addEventListener('resize', scheduleDesktopSiteSync, { passive: true });
}

function openSiteTab(site) {
  const url = safeUrl(site?.url);
  if (!site || !url) return;
  if (!window.desktopBridge?.syncSiteTabs) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  let tab = openSiteTabs.find((item) => item.id === site.id);
  if (!tab) {
    tab = { id: site.id, name: site.name, url: site.url, image: site.image || '' };
    openSiteTabs.push(tab);
  }
  activeSiteTabId = tab.id;
  currentView = 'home';
  render();
}

function openGoogleSearch(query) {
  const value = String(query || '').trim().slice(0, 200);
  if (!value) return showToast('اكتب عبارة البحث أولًا.', 'error');
  const url = `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  const title = `Google: ${value}`.slice(0, 70);
  if (!window.desktopBridge?.syncSiteTabs) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  openSiteTab({ id: uid('google-search'), name: title, url, image: 'https://www.google.com/s2/favicons?domain=google.com&sz=128' });
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
      authSession.userId = remote.userId || authSession.userId;
      notepadText = loadNotepad();
      applyAccountState(remote);
      authSession.account = { ...authSession.account, ...(remote.subscription || {}) };
      saveSession(authSession);
      await refreshClientPasswordRequest();
      if (window.desktopBridge?.saveRememberedLogin) {
        try {
          const remembered = await window.desktopBridge.saveRememberedLogin({ username: data.get('username'), password: data.get('password') });
          if (!remembered) showToast('تعذر حفظ الدخول بأمان على هذا الجهاز؛ سيظل بإمكانك تسجيل الدخول يدويًا.', 'error');
        } catch { showToast('تم الدخول، لكن تعذر حفظ بيانات الدخول على هذا الجهاز.', 'error'); }
      }
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
  if (!authSession?.token) {
    render();
    if (!isAdminRoute() && window.desktopBridge?.getRememberedLogin) {
      let credentials = null;
      try {
        credentials = await window.desktopBridge.getRememberedLogin();
        if (credentials?.username && credentials?.password) {
          const result = await apiRequest('login', { method: 'POST', token: null, body: { role: 'client', username: credentials.username, password: credentials.password } });
          saveSession({ ...result, account: { ...result.account, ...(result.subscription || {}) } });
          const remote = await apiRequest('client/state');
          authSession.userId = remote.userId || authSession.userId;
          notepadText = loadNotepad();
          applyAccountState(remote);
          authSession.account = { ...authSession.account, ...(remote.subscription || {}) };
          saveSession(authSession);
          await refreshClientPasswordRequest();
          if (!remote.appState || !Object.keys(remote.appState).length) saveState();
          startSessionCheck();
          currentView = 'home';
          render();
          return;
        }
      } catch (error) {
        saveSession(null);
        authMessage = error.code === 'account_disabled' ? 'الحساب المحفوظ موقوف. أدخل بيانات حساب آخر أو تواصل مع المدير.' : error.code === 'subscription_locked' ? 'انتهت مهلة الحساب المحفوظ. تواصل مع المدير لتجديد الاشتراك.' : 'تعذر الدخول تلقائيًا بالبيانات المحفوظة؛ تحقق منها وسجّل الدخول يدويًا.';
        render();
        const form = document.querySelector('#loginForm');
        if (form) {
          form.elements.username.value = credentials?.username || '';
          form.elements.password.value = credentials?.password || '';
        }
        return;
      }
    }
    return;
  }
  try {
    if (authSession.role === 'admin') await refreshAdminAccounts();
    else {
      const account = await apiRequest('client/account');
      authSession.account = { ...authSession.account, ...account };
      const remote = await apiRequest('client/state');
      authSession.userId = remote.userId || authSession.userId;
      notepadText = loadNotepad();
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
  return `<div class="app-shell ${activeSiteTabId ? 'site-active' : ''} ${window.desktopBridge?.syncSiteTabs ? 'desktop-app' : 'web-app'}">
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand-mark">SH</div>
        <div><strong>Service Hub</strong><span>مركز الخدمات</span></div>
      </div>
      <section class="sidebar-office"><strong>${escapeHtml(authSession.account?.officeName || state.officeName)}</strong><span>${escapeHtml(authSession.account?.ownerName || '')}</span></section>
      <nav class="main-nav" aria-label="التنقل الرئيسي">
        <button class="nav-item ${currentView === 'home' || (!window.desktopBridge?.syncSiteTabs && currentView === 'sales') ? 'active' : ''}" data-nav="home">${icon('sales')}<span>${window.desktopBridge?.syncSiteTabs ? 'الرئيسية' : 'المبيعات'}</span></button>
        ${window.desktopBridge?.syncSiteTabs ? `<button class="nav-item ${currentView === 'sales' ? 'active' : ''}" data-nav="sales">${icon('sales')}<span>المبيعات</span></button>` : ''}
        <button class="nav-item ${currentView === 'settings' ? 'active' : ''}" data-nav="settings">${icon('settings')}<span>الإعدادات</span></button>
        ${window.desktopBridge?.syncSiteTabs ? `<button class="nav-item ${currentView === 'banks' ? 'active' : ''}" data-nav="banks">${icon('bank')}<span>الحسابات البنكية</span></button><button class="nav-item ${currentView === 'debts' ? 'active' : ''}" data-nav="debts">${icon('wallet')}<span>المديونيات</span></button><button class="nav-item ${currentView === 'invoices' ? 'active' : ''}" data-nav="invoices">${icon('receipt')}<span>الفواتير</span></button><button class="nav-item ${currentView === 'notepad' ? 'active' : ''}" data-nav="notepad">${icon('notepad')}<span>Notepad</span></button><button class="nav-item ${currentView === 'scanner' ? 'active' : ''}" data-nav="scanner">${icon('scanner')}<span>الماسح</span></button><button class="nav-item ${currentView === 'documents' ? 'active' : ''}" data-nav="documents">${icon('receipt')}<span>الوثائق والأسعار</span></button>` : `<button class="nav-item ${currentView === 'banks' ? 'active' : ''}" data-nav="banks">${icon('bank')}<span>الحسابات البنكية</span></button>`}
      </nav>
      ${window.desktopBridge?.syncSiteTabs ? `<section class="sidebar-account"><span class="sidebar-account-label">الحساب</span><strong>${escapeHtml(authSession.account?.username || '')}</strong><small>${escapeHtml(authSession.account?.phone || '')}</small><button class="sidebar-logout" data-logout>${icon('logout', 17)}<span>تسجيل الخروج</span></button></section>` : '<div class="sidebar-footer"><span class="status-dot"></span> البيانات محفوظة في Supabase</div>'}
    </aside>
    <main class="main-content">
      ${window.desktopBridge?.syncSiteTabs ? renderSiteTabsBar() : `<header class="topbar"><div class="breadcrumb"><span>Service Hub</span><b>/</b><strong>${currentView === 'home' ? (window.desktopBridge?.syncSiteTabs ? 'الرئيسية' : 'المبيعات') : currentView === 'sales' ? 'المبيعات' : currentView === 'banks' ? 'الحسابات البنكية' : currentView === 'documents' ? 'الوثائق والأسعار' : 'الإعدادات'}</strong></div><div class="topbar-actions"><span class="live-badge"><i></i>${escapeHtml(authSession.account?.username || '')}</span><button class="ghost-btn" data-logout>خروج</button><button class="icon-btn" data-nav="settings" aria-label="الإعدادات">${icon('settings', 18)}</button></div></header>`}
      ${activeSiteTabId ? renderActiveSiteTab() : `<div class="page-container ${currentView === 'home' ? 'home-page-container' : ''}">${subscriptionWarning()}${currentView === 'home' ? (window.desktopBridge?.syncSiteTabs ? renderHome() : renderWebSales(state, selectedSalesDate, todayKey)) : currentView === 'sales' ? (window.desktopBridge?.syncSiteTabs ? renderSales() : renderWebSales(state, selectedSalesDate, todayKey)) : currentView === 'banks' ? (window.desktopBridge?.syncSiteTabs ? renderBanks() : renderWebBanks(state, selectedBankAccountId, bankPeriodMode, bankPeriodDate, bankPeriodMonth)) : currentView === 'notepad' && window.desktopBridge?.syncSiteTabs ? renderNotepad() : currentView === 'scanner' && window.desktopBridge?.syncSiteTabs ? renderScanner() : currentView === 'debts' && window.desktopBridge?.syncSiteTabs ? renderDebts() : currentView === 'invoices' && window.desktopBridge?.syncSiteTabs ? renderInvoices() : currentView === 'documents' && window.desktopBridge?.syncSiteTabs ? renderDocuments() : renderSettings()}</div>`}
    </main>
  </div>${reportDialogMode ? renderReportDialog() : ''}${recordToDelete ? renderRecordDeleteDialog() : ''}`;
}

function renderSiteTabsBar() {
  return `<nav class="site-tabs-bar" aria-label="تبويبات مواقع الخدمات"><button class="site-home-tab ${activeSiteTabId ? '' : 'selected'}" data-home-tab aria-label="الرئيسية" title="الرئيسية">${icon('home', 18)}<span>الرئيسية</span></button><div class="site-tabs-list">${openSiteTabs.map((tab) => `<div class="site-tab ${activeSiteTabId === tab.id ? 'active' : ''}"><button class="site-tab-select" data-activate-site="${escapeHtml(tab.id)}" title="${escapeHtml(tab.name)}">${imageMarkup(tab, 'tab-image')}<span>${escapeHtml(tab.name)}</span></button><button class="site-tab-close" data-close-site-tab="${escapeHtml(tab.id)}" aria-label="إغلاق ${escapeHtml(tab.name)}">${icon('close', 14)}</button></div>`).join('')}</div></nav>`;
}

function renderActiveSiteTab() {
  const tab = openSiteTabs.find((item) => item.id === activeSiteTabId);
  if (!tab) { activeSiteTabId = null; return `<div class="page-container">${renderHome()}</div>`; }
  const url = safeUrl(tab.url);
  return `<section class="embedded-workspace"><div id="embeddedSiteHost" class="embedded-site-host">${window.desktopBridge?.syncSiteTabs ? '' : url ? `<iframe class="embedded-site-frame" src="${escapeHtml(url)}" title="${escapeHtml(tab.name)}" referrerpolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-downloads allow-modals"></iframe>` : '<div class="embedded-site-error">رابط الخدمة غير صالح.</div>'}</div></section>`;
}

function renderHome() {
  const filteredSites = state.sites.filter((site) => {
    const matchesSearch = `${site.name} ${site.category}`.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'الكل' || (categoryFilter === 'المفضلة' ? site.favorite : site.category === categoryFilter);
    return matchesSearch && matchesCategory;
  });
  const categories = ['الكل', 'المفضلة', ...new Set(state.sites.map((site) => site.category))];
  return `<section class="home-view">
    <div class="toolbar"><div class="home-search-group"><label class="search-box">${icon('search', 18)}<input id="siteSearch" value="${escapeHtml(searchTerm)}" placeholder="ابحث عن موقع أو خدمة" aria-label="ابحث عن موقع أو خدمة؛ اضغط Enter للبحث في Google"></label><button class="secondary-btn google-search-btn" type="button" id="googleSearchButton">${icon('search', 16)} بحث Google</button></div><div class="category-chips">${categories.map((category) => `<button class="chip ${categoryFilter === category ? 'selected' : ''}" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}</div></div>
    <div class="section-heading"><div><h2>المواقع المتاحة</h2></div></div>
    ${filteredSites.length ? `<div class="sites-grid">${filteredSites.map(renderSiteCard).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">${icon('search', 28)}</div><h3>لا توجد نتائج</h3><p>جرّب كلمة بحث مختلفة أو أضف موقعًا جديدًا من الإعدادات.</p></div>`}
  </section>`;
}

function renderNotepad() {
  return `<section class="notepad-view"><div class="view-title-row"><div><p class="eyebrow">مساحة خاصة على هذا الجهاز</p><h1>Notepad</h1><p class="page-subtitle">اكتب أو الصق بيانات مؤقتة؛ تُحفظ تلقائيًا على هذا الجهاز ولا تُرسل إلى Supabase.</p></div><button class="secondary-btn" id="clearNotepad" type="button">مسح المفكرة</button></div><label class="notepad-paper"><span class="sr-only">ملاحظات مؤقتة</span><textarea id="notepadText" spellcheck="false" placeholder="اكتب أو الصق بيانات العميل هنا…">${escapeHtml(notepadText)}</textarea></label><div class="notepad-footer"><span id="notepadSaveStatus" aria-live="polite">تم الحفظ على هذا الجهاز</span><span>لا تُمسح الملاحظات عند تسجيل الخروج؛ امسحها يدويًا عند الانتهاء.</span></div></section>`;
}

function renderScannerFields(text) {
  const fields = extractScannerFields(text);
  const cards = [
    ['identityNumber', 'رقم الهوية'],
    ['birthDate', 'تاريخ الميلاد'],
    ['serialNumber', 'الرقم التسلسلي']
  ];
  return `<section class="scanner-fields" data-scanner-fields><header class="scanner-fields-heading"><div><p class="eyebrow">استخراج تلقائي</p><h3>بيانات الهوية</h3></div><span>تُحدّث مع تعديل النص</span></header><div class="scanner-field-groups">${cards.map(([key, title]) => `<button class="scanner-field-chip" type="button" data-copy-scanner-field="${key}" title="نسخ ${title}" ${fields[key] ? '' : 'disabled'}><span>${title}</span><strong dir="ltr">${escapeHtml(fields[key] || 'لم يتم العثور عليها')}</strong><small>${fields[key] ? `${icon('copy', 12)} نسخ` : 'راجع النص وعدّله يدويًا'}</small></button>`).join('')}</div></section>`;
}

function renderScanner() {
  const selected = scannerDocuments.find((item) => item.id === selectedScannerDocumentId) || null;
  const scanList = scannerDocuments.map((item) => `<button class="scanner-history-item ${item.id === selected?.id ? 'active' : ''}" type="button" data-select-scan="${escapeHtml(item.id)}"><span class="scanner-history-icon">${icon('image', 18)}</span><span class="scanner-history-copy"><strong>${escapeHtml(item.filename || 'مستند ممسوح')}</strong><small>${escapeHtml(formatDateTime(item.createdAt))}</small></span><span class="scanner-history-arrow">‹</span></button>`).join('');
  const preview = selected && scannerPreviewUrl ? `<img class="scanner-document-image" src="${escapeHtml(scannerPreviewUrl)}" alt="معاينة ${escapeHtml(selected.filename)}">` : `<div class="scanner-preview-placeholder">${icon('scanner', 34)}<strong>${selected ? 'جارٍ تحميل المعاينة…' : 'ستظهر معاينة المستند هنا'}</strong><small>ضع المستند على الماسح ثم اختر «مسح مستند»</small></div>`;
  const detail = selected ? `<section class="scanner-workspace"><div class="scanner-preview-card"><div class="scanner-preview-toolbar"><div><strong>معاينة المستند</strong><small>${escapeHtml(selected.filename || '')}</small></div><button class="icon-btn danger" type="button" data-delete-scan="${escapeHtml(selected.id)}" aria-label="حذف المستند" title="حذف المستند">${icon('trash', 17)}</button></div><div class="scanner-preview-canvas">${preview}</div></div><div class="scanner-text-card"><header class="scanner-text-heading"><div><p class="eyebrow">التعرف الضوئي على الحروف</p><h2>النص المستخرج</h2></div><button class="secondary-btn scanner-copy-btn" type="button" data-copy-scan-text ${selected.text && !scannerBusy ? '' : 'disabled'}>${icon('copy', 16)} نسخ النص</button></header><p id="scannerOcrStatus" class="scanner-ocr-status" aria-live="polite">${escapeHtml(scannerOcrStatus || (selected.text ? 'يمكنك مراجعة النص وتصحيحه قبل نسخه.' : 'جارٍ تجهيز النص…'))}</p><textarea id="scannerExtractedText" class="scanner-extracted-text" dir="auto" spellcheck="false" maxlength="100000" ${scannerBusy ? 'disabled' : ''} placeholder="سيظهر هنا النص الذي تم التعرف عليه، ويمكنك تعديله يدويًا…">${escapeHtml(selected.text || '')}</textarea>${renderScannerFields(selected.text || '')}<footer class="scanner-text-footer"><span id="scannerSaveStatus" aria-live="polite">محفوظ على هذا الجهاز فقط</span><button class="ghost-btn" type="button" data-rerun-ocr ${scannerBusy ? 'disabled' : ''}>${icon('refresh', 15)} إعادة استخراج النص</button></footer></div></section>` : `<section class="scanner-empty-panel"><div class="scanner-empty-icon">${icon('scanner', 38)}</div><h2>لا توجد مستندات ممسوحة</h2><p>ابدأ مسح بطاقة الهوية أو أي مستند. ستظهر صورته هنا، ويمكنك حفظها أو طباعتها بصيغ متعددة.</p></section>`;
  const formats = [['pdf', 'PDF'], ['jpeg', 'JPG / JPEG'], ['png', 'PNG'], ['bmp', 'BMP'], ['tiff', 'TIFF'], ['webp', 'WebP']];
  return `<section class="scanner-view"><header class="view-title-row scanner-title-row"><div><p class="eyebrow">محفوظ محليًا — لا يتم رفع الصور</p><h1>الماسح الضوئي</h1><p class="page-subtitle">امسح مستندًا، راجع النص، ثم احفظه بصيغ الصور الشائعة أو PDF أو اطبعه.</p></div><div class="scanner-actions"><label class="scanner-language-picker"><span>لغة القراءة</span><select id="scannerOcrLanguage"><option value="ara+eng" ${scannerOcrLanguage === 'ara+eng' ? 'selected' : ''}>العربية والإنجليزية</option><option value="ara" ${scannerOcrLanguage === 'ara' ? 'selected' : ''}>العربية فقط</option><option value="eng" ${scannerOcrLanguage === 'eng' ? 'selected' : ''}>الإنجليزية فقط</option></select></label><label class="scanner-format-picker"><span>صيغة الحفظ</span><select id="scannerExportFormat">${formats.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><button class="secondary-btn" type="button" data-save-scan ${selected ? '' : 'disabled'}>${icon('download', 16)} حفظ باسم</button><button class="secondary-btn" type="button" data-print-scan ${selected ? '' : 'disabled'}>${icon('receipt', 16)} طباعة</button><button class="primary-btn" type="button" data-start-scan ${scannerBusy ? 'disabled' : ''}>${icon('scanner', 18)} ${scannerBusy ? 'جارٍ المعالجة…' : 'مسح مستند'}</button></div></header><div class="scanner-privacy-note"><span>${icon('lock', 16)}</span><p>اختر العربية والإنجليزية للبطاقات المختلطة، أو لغة واحدة إذا كان المستند أحادي اللغة. اختر 300 DPI أو أعلى؛ عند رفض صيغة الصورة للتحسين، يحاول البرنامج قراءة الملف الأصلي مباشرةً.</p></div><div class="scanner-layout"><aside class="scanner-history-panel"><div class="scanner-history-heading"><div><p class="eyebrow">سجل محلي</p><h2>المستندات</h2></div><span class="record-count">${scannerDocuments.length}</span></div>${scanList || '<div class="scanner-history-empty">لا يوجد سجل بعد</div>'}</aside>${detail}</div></section>`;
}

function renderBanks() {
  return renderBankView(state, { selectedAccountId: selectedBankAccountId, periodMode: bankPeriodMode, periodDate: bankPeriodDate, periodMonth: bankPeriodMonth, actionModal: bankActionModal, formatMoney, formatDateTime });
}

function renderDebts() {
  const receivable = debtRecords.filter((item) => item.direction === 'receivable').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const payable = debtRecords.filter((item) => item.direction === 'payable').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const groups = new Map();
  for (const item of debtRecords) {
    const key = `${item.direction}:${item.person.trim().toLocaleLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { direction: item.direction, person: item.person, entries: [], total: 0 });
    const group = groups.get(key);
    group.entries.push(item);
    group.total += Number(item.amount || 0);
  }
  const rows = [...groups.values()].map((group) => `<section class="debt-person-card"><header><div><span class="debt-direction ${group.direction}">${group.direction === 'receivable' ? 'مستحق لي' : 'مستحق له عليّ'}</span><h3>${escapeHtml(group.person)}</h3></div><strong class="${group.direction === 'receivable' ? 'amount-positive' : 'amount-negative'}">${formatMoney(group.total)}</strong></header><div class="debt-entry-list">${group.entries.map((entry) => `<div class="debt-entry"><div><span>${escapeHtml(entry.note || 'مبلغ مسجل')}</span><small>${escapeHtml(formatDateTime(entry.createdAt))}</small></div><strong>${formatMoney(entry.amount)}</strong><button class="icon-btn danger" type="button" data-delete-debt="${escapeHtml(entry.id)}" aria-label="حذف المبلغ">${icon('trash', 16)}</button></div>`).join('')}</div></section>`).join('');
  return `<section class="desktop-ledger-view"><div class="view-title-row"><div><p class="eyebrow">محفوظة على هذا الجهاز فقط</p><h1>المديونيات</h1><p class="page-subtitle">أضف أكثر من مبلغ للشخص نفسه، وتابع ما لك وما عليك.</p></div></div><div class="summary-grid debt-summary"><article class="summary-card sales"><span class="summary-icon">${icon('wallet')}</span><div><small>إجمالي المبالغ المستحقة لي</small><strong>${formatMoney(receivable)}</strong></div></article><article class="summary-card expense"><span class="summary-icon">${icon('receipt')}</span><div><small>إجمالي المبالغ المستحقة عليّ</small><strong>${formatMoney(payable)}</strong></div></article><article class="summary-card net"><span class="summary-icon">${icon('sales')}</span><div><small>صافي الفرق</small><strong>${formatMoney(receivable - payable)}</strong></div></article></div><div class="debt-layout"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">تسجيل حركة</p><h2>إضافة مبلغ</h2></div></div><form id="debtForm" class="form-grid"><label>نوع المديونية<select name="direction"><option value="receivable">لي عند الشخص (مستحق لي)</option><option value="payable">له عندي (مبلغ عليّ للشخص)</option></select></label><label>اسم الشخص<input name="person" required maxlength="120" autocomplete="off" placeholder="اكتب الاسم"></label><label>المبلغ بالريال<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required inputmode="decimal"></label><label>بيان المبلغ (اختياري)<input name="note" maxlength="160" placeholder="سبب المبلغ"></label><button class="primary-btn full-span" type="submit">${icon('plus', 17)} حفظ المبلغ على هذا الجهاز</button></form></section><section class="debt-people"><div class="panel-heading"><div><p class="eyebrow">كشف الأسماء</p><h2>الأرصدة المسجلة</h2></div><span class="record-count">${groups.size} شخص</span></div>${rows || '<div class="empty-state debt-empty"><div class="empty-icon">' + icon('wallet', 26) + '</div><h3>لا توجد مديونيات بعد</h3><p>أضف اسمًا ومبلغًا لتظهر حركة الحساب هنا.</p></div>'}</section></div></section>`;
}

const arabicOnes = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const arabicTeens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const arabicTens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const arabicHundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
function spellArabicUnderThousand(value) {
  const parts = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(arabicHundreds[hundreds]);
  if (rest >= 10 && rest <= 19) parts.push(arabicTeens[rest - 10]);
  else if (rest >= 20) {
    if (rest % 10) parts.push(arabicOnes[rest % 10]);
    parts.push(arabicTens[Math.floor(rest / 10)]);
  } else if (rest > 0) parts.push(arabicOnes[rest]);
  return parts.join(' و');
}
function spellArabicNumber(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 0 || number > 999999999) return 'مبلغ يتجاوز الحد المسموح';
  if (number === 0) return 'صفر';
  const scales = ['', 'ألف', 'مليون'];
  const parts = [];
  let remaining = number;
  for (let index = 2; index >= 0; index -= 1) {
    const divisor = 1000 ** index;
    const group = Math.floor(remaining / divisor);
    remaining %= divisor;
    if (!group) continue;
    if (!index) parts.push(spellArabicUnderThousand(group));
    else if (group === 1) parts.push(scales[index]);
    else if (group === 2) parts.push(`${scales[index]}ان`);
    else if (group <= 10) parts.push(`${spellArabicUnderThousand(group)} ${index === 1 ? 'آلاف' : 'ملايين'}`);
    else parts.push(`${spellArabicUnderThousand(group)} ${scales[index]}ًا`);
  }
  return parts.join(' و');
}
function amountInArabic(amount) {
  const value = Math.round(Number(amount) * 100);
  const riyals = Math.floor(value / 100);
  const halalas = value % 100;
  const main = `${spellArabicNumber(riyals)} ريال سعودي`;
  return halalas ? `${main} و${spellArabicNumber(halalas)} هللة` : main;
}
function renderInvoices() {
  const officeName = authSession.account?.officeName || state.officeName || 'المكتب';
  const rows = invoices.map((invoice) => `<article class="invoice-row"><div class="invoice-row-main"><span class="invoice-number">${escapeHtml(invoice.number)}</span><strong>${escapeHtml(invoice.customerName)}</strong><small>${escapeHtml(invoice.serviceDescription)} · ${escapeHtml(formatDateTime(invoice.createdAt))}</small></div><strong class="amount-positive">${formatMoney(invoice.amount)}</strong><div class="invoice-row-actions"><button class="icon-btn" type="button" data-print-invoice="${escapeHtml(invoice.id)}" aria-label="طباعة الفاتورة">${icon('receipt', 17)}</button><button class="icon-btn danger" type="button" data-delete-invoice="${escapeHtml(invoice.id)}" aria-label="حذف الفاتورة">${icon('trash', 17)}</button></div></article>`).join('');
  return `<section class="desktop-ledger-view"><div class="view-title-row"><div><p class="eyebrow">فاتورة باسم المكتب المسجل: ${escapeHtml(officeName)}</p><h1>الفواتير</h1><p class="page-subtitle">أنشئ فاتورة خدمة واطبعها بتنسيق A4، مع كتابة المبلغ بالأرقام والحروف.</p></div></div><div class="invoice-layout"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">فاتورة جديدة</p><h2>بيانات العميل والخدمة</h2></div></div><form id="invoiceForm" class="form-grid"><label>اسم العميل<input name="customerName" maxlength="120" required autocomplete="off"></label><label>السعر بالريال السعودي<input name="amount" type="number" min="0.01" max="999999999" step="0.01" required inputmode="decimal"></label><label class="full-span">وصف الخدمة المقدمة<textarea name="serviceDescription" rows="3" maxlength="500" required></textarea></label><div class="invoice-preview full-span" id="invoiceAmountPreview">سيظهر السعر كتابةً بالعربية بعد إدخاله.</div><button class="primary-btn full-span" type="submit">${icon('receipt', 17)} إنشاء وحفظ الفاتورة</button></form></section><section class="panel invoice-history"><div class="panel-heading"><div><p class="eyebrow">محفوظة على هذا الجهاز فقط</p><h2>سجل الفواتير</h2></div><span class="record-count">${invoices.length} فاتورة</span></div>${rows || '<div class="small-empty">لا توجد فواتير محفوظة حتى الآن.</div>'}</section></div></section>`;
}

function printInvoice(invoice) {
  const officeName = authSession.account?.officeName || state.officeName || 'المكتب';
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فاتورة ${escapeHtml(invoice.number)}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#142f2a;margin:0}.invoice{min-height:260mm;padding:15mm;border:1px solid #d5e5df}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #16836d;padding-bottom:20px}.brand{font-size:27px;color:#08745e;font-weight:bold}.meta{line-height:2;color:#516560;text-align:left}.title{text-align:center;margin:34px 0;color:#17483e;font-size:30px}.customer{margin:24px 0;padding:18px;background:#f1f7f4;border-radius:8px;line-height:2}.desc{min-height:90px;padding:20px 0;border-bottom:1px solid #dfe9e5;line-height:2.1}.amount{margin-top:25px;padding:18px;background:#eff8f4;border-right:5px solid #16836d;border-radius:6px}.amount strong{display:block;font-size:24px;margin-bottom:12px}.amount span{color:#46615a}.signature{display:flex;justify-content:space-between;margin-top:72px}.signature div{width:42%;padding-top:14px;border-top:1px solid #9cafaa;text-align:center;color:#38564e}footer{margin-top:40px;text-align:center;color:#81938e;font-size:11px}@media print{.invoice{border:0}}</style></head><body><main class="invoice"><header class="top"><div><div class="brand">${escapeHtml(officeName)}</div><div>فاتورة خدمات</div></div><div class="meta">رقم الفاتورة: ${escapeHtml(invoice.number)}<br>التاريخ: ${escapeHtml(new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(new Date(invoice.createdAt)))}</div></header><h1 class="title">فاتورة</h1><section class="customer"><strong>السادة / ${escapeHtml(invoice.customerName)}</strong><br>تحية طيبة، نرفق لكم تفاصيل الخدمة المقدمة:</section><section class="desc"><strong>وصف الخدمة</strong><br>${escapeHtml(invoice.serviceDescription).replace(/\n/g, '<br>')}</section><section class="amount"><strong>الإجمالي: ${formatMoney(invoice.amount)}</strong><span>المبلغ كتابةً: ${escapeHtml(amountInArabic(invoice.amount))} لا غير.</span></section><section class="signature"><div>توقيع العميل</div><div>ختم وتوقيع ${escapeHtml(officeName)}</div></section><footer>نشكر لكم ثقتكم.</footer></main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script></body></html>`;
  if (!openPrintWindow(html)) showToast('تعذر فتح نافذة الطباعة؛ تحقق من السماح بالنوافذ المنبثقة.', 'error');
}

function mountPaymentMethodFields() {
  if (!window.desktopBridge?.syncSiteTabs || currentView !== 'sales') return;
  for (const [formId, prefix] of [['transactionForm', 'transaction'], ['expenseForm', 'expense']]) {
    const form = document.querySelector(`#${formId}`);
    const submit = form?.querySelector('button[type="submit"]');
    if (!form || !submit || form.querySelector(`#${prefix}PaymentMethod`)) continue;
    submit.insertAdjacentHTML('beforebegin', renderPaymentMethodFields(prefix, state.bankAccounts));
  }
}

function updatePaymentMethodField(prefix) {
  const updateField = (methodId, fieldId, selectName) => {
    const method = document.querySelector(`#${methodId}`);
    const field = document.querySelector(`#${fieldId}`);
    const select = field?.querySelector(`select[name="${selectName}"]`);
    if (!method || !field || !select) return;
    const isBank = method.value === 'bank';
    field.hidden = !isBank;
    select.required = isBank;
  };
  if (prefix === 'transaction') {
    updateField('transactionPaymentMethod', 'transactionBankAccountField', 'costBankAccountId');
    updateField('transactionReceiptMethod', 'transactionReceiptBankField', 'receiptBankAccountId');
  } else updateField(`${prefix}PaymentMethod`, `${prefix}BankAccountField`, 'bankAccountId');
}

function updateTransactionProfitPreview() {
  const form = document.querySelector('#transactionForm');
  const preview = document.querySelector('#transactionProfitPreview');
  if (!form || !preview) return;
  const data = new FormData(form);
  const amount = Number(data.get('amount')) || 0;
  const cost = Number(data.get('costAmount')) || 0;
  preview.textContent = `الربح المتوقع: ${formatMoney(amount - cost)} (المقبوض ${formatMoney(amount)} − التكلفة ${formatMoney(cost)})`;
  preview.classList.toggle('profit-loss', amount < cost);
}

function decoratePaymentRecords() {
  if (!window.desktopBridge?.syncSiteTabs) return;
  document.querySelectorAll('[data-delete-record]').forEach((button) => {
    const [type, id] = String(button.dataset.deleteRecord || '').split(':');
    const record = (type === 'transaction' ? state.transactions : state.expenses).find((item) => item.id === id);
    if (!record) return;
    const small = button.closest('.record-row')?.querySelector('.record-main small');
    if (!small) return;
    if (type === 'transaction') {
      const costMethod = record.costPaymentMethod || record.paymentMethod || 'cash';
      const receiptMethod = record.receiptMethod || (record.costPaymentMethod ? 'cash' : record.paymentMethod || 'cash');
      const costBank = state.bankAccounts.find((account) => account.id === (record.costBankAccountId || record.bankAccountId))?.name;
      const receiptBank = state.bankAccounts.find((account) => account.id === (record.receiptBankAccountId || (!record.costPaymentMethod ? record.bankAccountId : null)))?.name;
      small.textContent += ` · قبض ${receiptMethod === 'bank' ? `بنكي${receiptBank ? `: ${receiptBank}` : ''}` : 'نقدي'} · تكلفة ${costMethod === 'bank' ? `من البنك${costBank ? `: ${costBank}` : ''}` : 'نقدًا'}`;
    } else {
      const bankName = state.bankAccounts.find((account) => account.id === record.bankAccountId)?.name;
      small.textContent += ` · ${record.paymentMethod === 'bank' ? `بنكي${bankName ? `: ${bankName}` : ''}` : 'نقدي'}`;
    }
  });
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
  const transactionCostsTotal = transactions.reduce((sum, item) => sum + Number(item.costAmount || 0), 0);
  const transactionProfit = salesTotal - transactionCostsTotal;
  const expensesTotal = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const net = transactionProfit - expensesTotal;
  return `<section class="sales-view">
    <div class="view-title-row"><div><p class="eyebrow">الحسابات اليومية</p><h1>المبيعات والمصروفات</h1><p class="page-subtitle">سجّل معاملاتك وتابع صافي اليوم في لحظة.</p></div><label class="date-picker">${icon('calendar', 17)}<span>تصفية حسب اليوم</span><input id="salesDate" type="date" value="${selectedSalesDate === 'all' ? todayKey() : selectedSalesDate}"></label></div>
    <div class="panel report-tools"><div class="report-description"><p class="eyebrow">التقارير والطباعة</p><h2>تقارير المكتب</h2><p class="helper-text">راجع السجلات وحدد اليوم أو الفترة قبل الطباعة على ورقة A4.</p></div><div class="report-actions"><button class="secondary-btn" id="printDailyReport" type="button">التقرير اليومي A4</button><label class="report-month">شهر البداية<input id="reportMonth" type="month" value="${selectedReportMonth}"></label><button class="primary-btn" id="printMonthlyReport" type="button">التقرير الشهري / فترة A4</button></div></div>
    <div class="summary-grid sales-summary-grid"><div class="summary-card sales"><span class="summary-icon">${icon('receipt')}</span><div><small>إيراد البيع المقبوض</small><strong>${formatMoney(salesTotal)}</strong></div></div><div class="summary-card expense"><span class="summary-icon">−</span><div><small>تكلفة تنفيذ المعاملات</small><strong>${formatMoney(transactionCostsTotal)}</strong></div></div><div class="summary-card net"><span class="summary-icon">${icon('sales')}</span><div><small>ربح المعاملات</small><strong>${formatMoney(transactionProfit)}</strong></div></div><div class="summary-card expense"><span class="summary-icon">${icon('wallet')}</span><div><small>مصروفات أخرى · الصافي</small><strong>${formatMoney(expensesTotal)} · ${formatMoney(net)}</strong></div></div></div>
    <div class="sales-layout"><div class="panel form-panel"><div class="panel-heading"><div><p class="eyebrow">إضافة جديدة</p><h2>تسجيل معاملة</h2></div><span class="panel-index">01</span></div><form id="transactionForm" class="form-grid"><label>نوع الخدمة<select id="transactionSiteSelect" name="siteId" required><option value="">اختر نوع المعاملة</option>${state.sites.map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`).join('')}<option value="__custom__">إضافة بند يدوياً…</option></select></label><label id="customServiceField" class="full-span" hidden>اسم البند اليدوي<input name="customServiceName" maxlength="120" placeholder="اكتب نوع المعاملة"></label><label>المبلغ المقبوض من العميل / سعر البيع<input name="amount" required type="number" min="0.01" step="0.01" placeholder="مثال: 600.00"></label><label>تكلفة تنفيذ الخدمة<input name="costAmount" required type="number" min="0" step="0.01" value="0.00" placeholder="مثال: 500.00"></label><p class="transaction-profit-preview full-span" id="transactionProfitPreview">الربح المتوقع: 0.00 ر.س</p><button class="primary-btn" type="submit">${icon('plus', 17)} تسجيل المعاملة</button></form></div><div class="panel form-panel expense-panel"><div class="panel-heading"><div><p class="eyebrow">إدارة المصاريف الأخرى</p><h2>تسجيل مصروف</h2></div><span class="panel-index">02</span></div><form id="expenseForm" class="form-grid"><label>نوع المصروف<input name="description" required placeholder="مثال: طعام، وقود، شحن"></label><label>القيمة<input name="amount" required type="number" min="0.01" step="0.01" placeholder="0.00"></label><button class="secondary-btn" type="submit">${icon('plus', 17)} إضافة المصروف</button></form></div></div>
    <div class="records-layout"><div class="panel records-panel"><div class="panel-heading"><div><p class="eyebrow">الحركة المالية</p><h2>المعاملات</h2></div><span class="record-count">${transactions.length}</span></div>${transactions.length ? `<div class="records-list">${transactions.slice().reverse().map((item) => `<div class="record-row"><span class="record-avatar">${icon('receipt', 17)}</span><div class="record-main"><strong>${escapeHtml(item.siteName)}</strong><small>${formatDateTime(item.createdAt)} · البيع ${formatMoney(item.amount)} · التكلفة ${formatMoney(item.costAmount || 0)} · الربح ${formatMoney(Number(item.amount || 0) - Number(item.costAmount || 0))}</small></div><b class="amount-positive">+ ${formatMoney(item.amount)}</b><button class="row-delete" data-delete-record="transaction:${item.id}" aria-label="حذف المعاملة">${icon('trash', 17)}</button></div>`).join('')}</div>` : `<div class="small-empty">لا توجد معاملات في التاريخ المحدد.</div>`}</div><div class="panel records-panel"><div class="panel-heading"><div><p class="eyebrow">المصروفات</p><h2>المصاريف اليومية</h2></div><span class="record-count">${expenses.length}</span></div>${expenses.length ? `<div class="records-list">${expenses.slice().reverse().map((item) => `<div class="record-row"><span class="record-avatar expense-avatar">${icon('wallet', 17)}</span><div class="record-main"><strong>${escapeHtml(item.description)}</strong><small>${formatDateTime(item.createdAt)}</small></div><b class="amount-negative">- ${formatMoney(item.amount)}</b><button class="row-delete" data-delete-record="expense:${item.id}" aria-label="حذف المصروف">${icon('trash', 17)}</button></div>`).join('')}</div>` : `<div class="small-empty">لا توجد مصروفات في التاريخ المحدد.</div>`}</div></div>
  </section>`;
}

function renderReportDialog() {
  const report = aggregateRangeReport(reportDialogStart, reportDialogMode === 'daily' ? reportDialogStart : reportDialogEnd, state.transactions, state.expenses);
  const records = [
    ...report.transactions.map((item) => {
      const receiptMethod = item.receiptMethod || (item.costPaymentMethod ? 'cash' : item.paymentMethod || 'cash');
      const costMethod = item.costPaymentMethod || item.paymentMethod || 'cash';
      const receiptBankName = state.bankAccounts.find((account) => account.id === (item.receiptBankAccountId || (!item.costPaymentMethod ? item.bankAccountId : null)))?.name;
      const costBankName = state.bankAccounts.find((account) => account.id === (item.costBankAccountId || (item.costPaymentMethod ? item.bankAccountId : null)))?.name;
      return { kind: 'sale', dateKey: item.dateKey, createdAt: item.createdAt, title: item.siteName || 'معاملة', detail: `استلام ${receiptMethod === 'bank' ? `بنكي · ${receiptBankName || 'حساب'}` : 'نقدي'} · تكلفة ${costMethod === 'bank' ? `من البنك · ${costBankName || 'حساب'}` : 'نقدية'} · التكلفة ${formatMoney(item.costAmount || 0)} · الربح ${formatMoney(Number(item.amount || 0) - Number(item.costAmount || 0))}`, amount: Number(item.amount || 0) };
    }),
    ...report.expenses.map((item) => ({ kind: 'expense', dateKey: item.dateKey, createdAt: item.createdAt, title: item.description || 'مصروف', detail: `مصروف · ${item.paymentMethod === 'bank' ? `بنكي · ${state.bankAccounts.find((account) => account.id === item.bankAccountId)?.name || 'حساب'}` : 'نقدي'}`, amount: -Number(item.amount || 0) }))
  ].sort((a, b) => `${a.dateKey}${a.createdAt || ''}`.localeCompare(`${b.dateKey}${b.createdAt || ''}`));
  const recordRows = records.length ? records.map((item) => `<div class="report-record-row"><span class="report-record-type ${item.kind}">${item.kind === 'sale' ? 'مبيعة' : 'مصروف'}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)} · ${escapeHtml(item.dateKey)} · ${escapeHtml(item.createdAt ? formatDateTime(item.createdAt) : '')}</small></div><b class="${item.amount >= 0 ? 'amount-positive' : 'amount-negative'}">${item.amount >= 0 ? '+' : '−'} ${formatMoney(Math.abs(item.amount))}</b></div>`).join('') : '<div class="small-empty">لا توجد سجلات في الفترة المحددة.</div>';
  const dateFields = reportDialogMode === 'daily'
    ? `<label>يوم التقرير<input id="reportDialogStart" type="date" required value="${escapeHtml(reportDialogStart)}"></label>`
    : `<label>من تاريخ<input id="reportDialogStart" type="date" required value="${escapeHtml(reportDialogStart)}"></label><label>إلى تاريخ<input id="reportDialogEnd" type="date" required value="${escapeHtml(reportDialogEnd)}"></label>`;
  return `<div class="modal-backdrop" data-report-backdrop><section class="modal-card report-modal" role="dialog" aria-modal="true" aria-labelledby="reportDialogTitle"><header class="modal-heading"><div><p class="eyebrow">معاينة السجلات</p><h2 id="reportDialogTitle">${reportDialogMode === 'daily' ? 'التقرير اليومي' : 'تقرير الشهر / الفترة'}</h2></div><button type="button" class="icon-btn" data-close-report aria-label="إغلاق">${icon('close', 18)}</button></header><div class="report-dialog-filters">${dateFields}</div><div class="report-dialog-summary"><div><small>إيراد البيع</small><strong>${formatMoney(report.salesTotal)}</strong></div><div><small>تكلفة المعاملات</small><strong>${formatMoney(report.transactionCostsTotal)}</strong></div><div><small>ربح المعاملات</small><strong>${formatMoney(report.transactionProfit)}</strong></div><div><small>مصروفات أخرى</small><strong>${formatMoney(report.expensesTotal)}</strong></div><div><small>الصافي</small><strong>${formatMoney(report.net)}</strong></div></div><p class="report-dialog-count">${records.length} سجل — هذه القائمة ستظهر في التقرير المطبوع.</p><div class="report-dialog-records">${recordRows}</div><footer class="modal-actions"><button type="button" class="ghost-btn" data-close-report>إلغاء</button><button type="button" class="primary-btn" id="confirmPrintReport">${icon('receipt', 17)} طباعة التقرير A4</button></footer></section></div>`;
}

function openReportDialog(mode) {
  reportDialogMode = mode;
  if (mode === 'daily') {
    reportDialogStart = selectedSalesDate && selectedSalesDate !== 'all' ? selectedSalesDate : todayKey();
    reportDialogEnd = reportDialogStart;
  } else {
    const [year, month] = selectedReportMonth.split('-').map(Number);
    reportDialogStart = `${selectedReportMonth}-01`;
    reportDialogEnd = `${selectedReportMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  }
  render();
}

function closeReportDialog() {
  reportDialogMode = null;
  render();
}

function printSelectedReport() {
  const officeName = authSession.account?.officeName || state.officeName;
  const withPaymentNames = (records) => records.map((item) => ({
    ...item,
    bankName: state.bankAccounts.find((account) => account.id === item.bankAccountId)?.name || '',
    receiptBankName: state.bankAccounts.find((account) => account.id === (item.receiptBankAccountId || (!item.costPaymentMethod ? item.bankAccountId : null)))?.name || '',
    costBankName: state.bankAccounts.find((account) => account.id === (item.costBankAccountId || (item.costPaymentMethod ? item.bankAccountId : null)))?.name || ''
  }));
  const html = reportDialogMode === 'daily'
    ? renderDailyReportHtml({ officeName, report: aggregateDailyReport(reportDialogStart, withPaymentNames(state.transactions), withPaymentNames(state.expenses)) })
    : renderRangeReportHtml({ officeName, report: aggregateRangeReport(reportDialogStart, reportDialogEnd, withPaymentNames(state.transactions), withPaymentNames(state.expenses)) });
  if (!openPrintWindow(html)) return showToast('اسمح بفتح نافذة الطباعة من إعدادات المتصفح.', 'error');
  reportDialogMode = null;
  render();
}

function updateCustomServiceField() {
  const select = document.querySelector('#transactionSiteSelect');
  const field = document.querySelector('#customServiceField');
  const input = field?.querySelector('input[name="customServiceName"]');
  if (!select || !field || !input) return;
  const manual = select.value === '__custom__';
  field.hidden = !manual;
  input.required = manual;
  if (manual) input.focus();
}

function renderRecordDeleteDialog() {
  const collection = recordToDelete.type === 'transaction' ? state.transactions : state.expenses;
  const record = collection.find((item) => item.id === recordToDelete.id);
  const title = recordToDelete.type === 'transaction' ? record?.customer || 'المعاملة' : record?.description || 'المصروف';
  return `<div class="modal-backdrop" data-delete-backdrop><form id="recordDeleteForm" class="modal-card delete-modal" role="dialog" aria-modal="true" aria-labelledby="deleteDialogTitle"><header class="modal-heading"><div><p class="eyebrow">حماية السجلات</p><h2 id="deleteDialogTitle">تأكيد حذف السجل</h2></div><button type="button" class="icon-btn" data-cancel-delete aria-label="إغلاق">${icon('close', 18)}</button></header><p class="delete-record-label">${escapeHtml(title)} — ${formatMoney(record?.amount || 0)}</p><label>أدخل رمز الحذف الذي ضبطته في الإعدادات<input name="deletionPassword" type="password" required minlength="8" maxlength="128" autocomplete="current-password" autofocus></label><footer class="modal-actions"><button type="button" class="ghost-btn" data-cancel-delete>إلغاء</button><button type="submit" class="danger-btn">تأكيد الحذف</button></footer></form></div>`;
}

function renderSettings() {
  const deletionPasswordExists = Boolean(state.recordDeletionProtection?.hash && state.recordDeletionProtection?.salt);
  const options = [
    ['account', 'بيانات المستخدم', 'اسم المكتب وطلب تغيير كلمة المرور', 'user'],
    ['sites', 'دليل المواقع', `${state.sites.length} موقعًا · إضافة أو تعديل أو حذف`, 'globe'],
    ['protection', 'حماية المعلومات', deletionPasswordExists ? 'رمز حذف السجلات مضبوط' : 'اضبط رمز حماية المعاملات', 'lock'],
    ['public', 'صفحة المكتب العامة', 'رابط الصفحة وموقع المكتب على الخرائط', 'external'],
    ['backup', 'النسخ الاحتياطي والاستعادة', 'احفظ بيانات البرنامج المحلية في ملف مضغوط أو استعدها', 'download']
  ];
  return `<section class="settings-view"><div class="view-title-row"><div><p class="eyebrow">التحكم في التطبيق</p><h1>الإعدادات</h1><p class="page-subtitle">اختر القسم؛ تفتح أدواته في نافذة مستقلة لتبقى الشاشة مرتبة.</p></div></div><div class="settings-launch-grid">${options.map(([key, title, desc, iconName]) => `<button class="settings-launch-card" type="button" data-settings-open="${key}"><span class="settings-launch-icon">${icon(iconName)}</span><span><strong>${title}</strong><small>${desc}</small></span><span class="settings-launch-arrow">←</span></button>`).join('')}</div>${settingsDialog ? renderSettingsDialog() : ''}</section>`;
}

function renderSettingsDialog() {
  const editingSite = state.sites.find((site) => site.id === editingSiteId);
  const deletionPasswordExists = Boolean(state.recordDeletionProtection?.hash && state.recordDeletionProtection?.salt);
  const requestStatus = clientPasswordRequest?.status === 'pending' ? 'طلب تغيير كلمة المرور قيد مراجعة المدير.' : clientPasswordRequest?.status === 'approved' ? 'وافق المدير على آخر طلب تغيير كلمة المرور.' : clientPasswordRequest?.status === 'rejected' ? 'رفض المدير آخر طلب تغيير كلمة المرور؛ يمكنك إرسال طلب جديد.' : 'تغيير كلمة المرور يحتاج موافقة مدير النظام.';
  const headings = { account: 'بيانات المستخدم', sites: 'دليل المواقع', protection: 'حماية المعلومات', public: 'صفحة المكتب العامة' };
  let content = '';
  if (settingsDialog === 'account') content = `<div class="settings-dialog-content"><section class="settings-info-strip"><span>صاحب المكتب: <strong>${escapeHtml(authSession.account?.ownerName || '—')}</strong></span><span>رقم الهاتف: <strong>${escapeHtml(authSession.account?.phone || '—')}</strong></span><span>اسم الدخول: <strong>${escapeHtml(authSession.account?.username || '—')}</strong></span></section><form id="officeNameForm" class="form-grid account-settings-form"><label class="full-span">اسم المكتب<input name="officeName" required maxlength="120" value="${escapeHtml(authSession.account?.officeName || state.officeName)}"></label><button class="primary-btn" type="submit">حفظ اسم المكتب</button></form><hr class="settings-divider"><form id="passwordChangeRequestForm" class="form-grid account-settings-form"><p class="helper-text full-span">${requestStatus}</p><label>كلمة المرور الجديدة<input name="password" type="password" required minlength="8" maxlength="1024" autocomplete="new-password"></label><label>تأكيد كلمة المرور<input name="confirmPassword" type="password" required minlength="8" maxlength="1024" autocomplete="new-password"></label><button class="secondary-btn full-span" type="submit" ${clientPasswordRequest?.status === 'pending' ? 'disabled' : ''}>إرسال طلب تغيير كلمة المرور</button></form></div>`;
  else if (settingsDialog === 'protection') content = `<div class="record-protection-settings"><p class="helper-text">لا يمكن حذف معاملة أو مصروف من الواجهة أو الخادم إلا بهذا الرمز. لا تحفظ كلمة المرور نفسها.</p><form id="recordDeletionPasswordForm" class="form-grid account-settings-form">${deletionPasswordExists ? '<label class="full-span">رمز الحذف الحالي<input name="currentPassword" type="password" required minlength="8" maxlength="128" autocomplete="current-password"></label>' : ''}<label>رمز الحذف الجديد<input name="newPassword" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><label>تأكيد الرمز<input name="confirmPassword" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><button class="primary-btn full-span" type="submit">${deletionPasswordExists ? 'تغيير رمز الحذف' : 'حفظ رمز الحذف'}</button></form></div>`;
  else if (settingsDialog === 'sites') content = `<div class="settings-dialog-content"><div class="panel add-site-panel"><div class="panel-heading"><h3>${editingSite ? 'تعديل موقع' : 'إضافة موقع جديد'}</h3>${editingSite ? '<button class="text-btn" data-cancel-edit>إلغاء التعديل</button>' : ''}</div><form id="siteForm" class="form-grid site-form"><label>اسم الموقع<input name="name" required value="${editingSite ? escapeHtml(editingSite.name) : ''}" placeholder="مثال: تأميني"></label><label>التصنيف<input name="category" required value="${editingSite ? escapeHtml(editingSite.category) : ''}" placeholder="مثال: التأمين"></label><label class="full-span">رابط الموقع<input name="url" type="url" required value="${editingSite ? escapeHtml(editingSite.url) : ''}" placeholder="https://example.com"></label><label class="full-span">رابط الصورة (اختياري)<input name="imageUrl" type="url" value="${editingSite && !editingSite.image?.startsWith('data:') ? escapeHtml(editingSite.image) : ''}" placeholder="https://example.com/logo.png"></label><label class="file-picker full-span">أو اختر صورة من الجهاز<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><span>${icon('image', 17)} اختيار ملف صورة</span></label><button class="primary-btn" type="submit">${icon(editingSite ? 'edit' : 'plus', 17)} ${editingSite ? 'حفظ التعديل' : 'إضافة الموقع'}</button></form></div><div class="manage-list settings-sites-list">${state.sites.map((site) => `<div class="manage-row">${imageMarkup(site, 'mini-image')}<div class="record-main"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.category)}</small></div><div class="manage-actions"><button class="icon-btn" data-edit-site="${escapeHtml(site.id)}" aria-label="تعديل ${escapeHtml(site.name)}">${icon('edit', 17)}</button><button class="icon-btn danger" data-delete-site="${escapeHtml(site.id)}" aria-label="حذف ${escapeHtml(site.name)}">${icon('trash', 17)}</button></div></div>`).join('')}</div></div>`;
  else if (settingsDialog === 'public') content = '<div class="panel office-panel public-settings-panel"></div>';
  else if (settingsDialog === 'backup') content = '<div class="backup-settings-panel"><p class="helper-text">ينسخ هذا الملف بيانات التطبيق المحلية، الوثائق والأسعار، المفكرة، الفواتير، المديونيات، إعدادات المواقع، وصور الماسح الموجودة داخل نسخة Windows. لا ترفع البيانات إلى الإنترنت.</p><div class="backup-actions"><button class="primary-btn" type="button" data-backup-local>تنزيل نسخة احتياطية مضغوطة</button><button class="secondary-btn" type="button" data-restore-local>استعادة من ملف مضغوط</button></div><p class="helper-text">الاستعادة تستبدل البيانات المحلية الحالية بعد تأكيدك، ثم يعاد تشغيل التطبيق.</p></div>';
  return `<div class="modal-backdrop settings-modal-backdrop" data-settings-backdrop><section class="modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsDialogTitle"><header class="modal-heading"><div><p class="eyebrow">الإعدادات</p><h2 id="settingsDialogTitle">${escapeHtml(headings[settingsDialog] || 'إعدادات')}</h2></div><button type="button" class="icon-btn" data-close-settings aria-label="إغلاق">×</button></header>${content}<footer class="modal-actions"><button type="button" class="ghost-btn" data-close-settings>إغلاق</button></footer></section></div>`;
}

function bindViewEvents() {
  mountPaymentMethodFields();
  decoratePaymentRecords();
  mountPublicPageSettings();
  if (currentView === 'documents' && window.desktopBridge?.syncSiteTabs) bindDocuments(render, (message, type = 'error') => showToast(message, type));
  document.querySelectorAll('[data-settings-open]').forEach((button) => button.addEventListener('click', () => { settingsDialog = button.dataset.settingsOpen; render(); }));
  document.querySelectorAll('[data-close-settings]').forEach((button) => button.addEventListener('click', () => { settingsDialog = null; editingSiteId = null; render(); }));
  document.querySelector('[data-settings-backdrop]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) { settingsDialog = null; editingSiteId = null; render(); } });
  document.querySelector('[data-logout]')?.addEventListener('click', () => logout());
  document.querySelector('[data-backup-local]')?.addEventListener('click', async () => { try { const result = await window.desktopBridge?.backupLocalData?.(Object.fromEntries(Object.entries(localStorage))); if (result?.filename) showToast(`تم حفظ النسخة الاحتياطية: ${result.filename}`); } catch (error) { showToast(error.message || 'تعذر إنشاء النسخة الاحتياطية.', 'error'); } });
  document.querySelector('[data-restore-local]')?.addEventListener('click', async () => { if (!window.confirm('سيتم استبدال البيانات المحلية الحالية بالنسخة المختارة. هل تريد المتابعة؟')) return; try { const result = await window.desktopBridge?.restoreLocalData?.(); if (result?.restored) { for (const key of Object.keys(localStorage)) localStorage.removeItem(key); for (const [key, value] of Object.entries(result.localStorage || {})) localStorage.setItem(key, String(value)); showToast('تمت الاستعادة. سيعاد تشغيل البرنامج الآن.'); setTimeout(() => window.location.reload(), 900); } } catch (error) { showToast(error.message || 'تعذر استعادة النسخة الاحتياطية.', 'error'); } });
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
  document.querySelector('#salesDate')?.addEventListener('change', (event) => { selectedSalesDate = event.target.value || todayKey(); render(); });
  for (const prefix of ['transaction', 'expense']) {
    document.querySelector(`#${prefix}PaymentMethod`)?.addEventListener('change', () => updatePaymentMethodField(prefix));
    updatePaymentMethodField(prefix);
  }
  document.querySelector('#transactionReceiptMethod')?.addEventListener('change', () => updatePaymentMethodField('transaction'));
  document.querySelector('#bankPeriodMode')?.addEventListener('change', (event) => { bankPeriodMode = event.target.value; render(); });
  document.querySelector('#bankPeriodDate')?.addEventListener('change', (event) => { bankPeriodDate = event.target.value || todayKey(); render(); });
  document.querySelector('#bankPeriodMonth')?.addEventListener('change', (event) => { bankPeriodMonth = event.target.value || todayKey().slice(0, 7); render(); });
  document.querySelectorAll('[data-bank-action]').forEach((button) => button.addEventListener('click', () => { bankActionModal = button.dataset.bankAction; render(); }));
  document.querySelectorAll('[data-close-bank-action]').forEach((button) => button.addEventListener('click', () => { bankActionModal = null; render(); }));
  document.querySelector('[data-bank-modal-backdrop]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) { bankActionModal = null; render(); } });
  document.querySelectorAll('[data-open-bank]').forEach((button) => button.addEventListener('click', () => { selectedBankAccountId = button.dataset.openBank; render(); }));
  document.querySelectorAll('[data-open-web-bank]').forEach((button) => button.addEventListener('click', () => { selectedBankAccountId = button.dataset.openWebBank; render(); }));
  document.querySelector('[data-back-banks]')?.addEventListener('click', () => { selectedBankAccountId = null; render(); });
  document.querySelectorAll('[data-bank-image]').forEach((image) => image.addEventListener('error', () => {
    const fallback = document.createElement('span'); fallback.className = 'bank-logo-fallback'; fallback.textContent = 'BANK'; image.replaceWith(fallback);
  }, { once: true }));
  document.querySelector('#notepadText')?.addEventListener('input', (event) => saveNotepad(event.currentTarget.value));
  document.querySelectorAll('[data-start-scan]').forEach((button) => button.addEventListener('click', startScannerAcquisition));
  document.querySelector('[data-save-scan]')?.addEventListener('click', async () => {
    if (!selectedScannerDocumentId) return;
    const format = document.querySelector('#scannerExportFormat')?.value || 'pdf';
    try {
      const result = await window.desktopBridge.exportScannerDocument({ id: selectedScannerDocumentId, format });
      if (!result?.cancelled) showToast(`تم حفظ ${result.filename} في المكان الذي اخترته.`);
    } catch (error) { showToast(error.message || 'تعذر حفظ المستند.', 'error'); }
  });
  document.querySelector('[data-print-scan]')?.addEventListener('click', async () => {
    if (!selectedScannerDocumentId) return;
    try { await window.desktopBridge.printScannerDocument(selectedScannerDocumentId); }
    catch (error) { showToast(error.message || 'تعذر فتح الطباعة.', 'error'); }
  });
  document.querySelectorAll('[data-select-scan]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.selectScan !== selectedScannerDocumentId) openScannerDocument(button.dataset.selectScan);
  }));
  document.querySelector('#scannerExtractedText')?.addEventListener('input', (event) => {
    const record = scannerDocuments.find((item) => item.id === selectedScannerDocumentId);
    if (!record) return;
    record.text = event.currentTarget.value.slice(0, 100000);
    saveScannerDocuments();
    const status = document.querySelector('#scannerSaveStatus');
    if (status) status.textContent = 'تم الحفظ محليًا';
    const copyButton = document.querySelector('[data-copy-scan-text]');
    if (copyButton) copyButton.disabled = !record.text;
    const fieldsPanel = document.querySelector('[data-scanner-fields]');
    if (fieldsPanel) fieldsPanel.outerHTML = renderScannerFields(record.text);
  });
  document.querySelector('[data-copy-scan-text]')?.addEventListener('click', copyScannerText);
  document.querySelector('.scanner-text-card')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy-scanner-field]');
    if (!button) return;
    const record = scannerDocuments.find((item) => item.id === selectedScannerDocumentId);
    const fields = extractScannerFields(record?.text || '');
    const value = fields[button.dataset.copyScannerField];
    if (!value) return;
    try {
      if (window.desktopBridge?.copyText) await window.desktopBridge.copyText(value);
      else await navigator.clipboard.writeText(value);
      const labels = { identityNumber: 'رقم الهوية', birthDate: 'تاريخ الميلاد', serialNumber: 'الرقم التسلسلي' };
      showToast(`تم نسخ ${labels[button.dataset.copyScannerField] || 'القيمة'}.`);
    } catch { showToast('تعذر نسخ القيمة إلى الحافظة.', 'error'); }
  });
  document.querySelector('#scannerOcrLanguage')?.addEventListener('change', (event) => {
    scannerOcrLanguage = ['ara+eng', 'ara', 'eng'].includes(event.currentTarget.value) ? event.currentTarget.value : 'ara+eng';
  });
  document.querySelectorAll('[data-delete-scan]').forEach((button) => button.addEventListener('click', () => deleteScannerDocument(button.dataset.deleteScan)));
  document.querySelector('[data-rerun-ocr]')?.addEventListener('click', async () => {
    const record = scannerDocuments.find((item) => item.id === selectedScannerDocumentId);
    if (!record || !scannerPreviewUrl || scannerBusy) return;
    if (record.text && !window.confirm('سيتم استبدال النص الحالي بالنص المستخرج من جديد. هل تريد المتابعة؟')) return;
    record.text = '';
    saveScannerDocuments();
    await extractScannerText(record.id, scannerPreviewUrl);
  });
  document.querySelector('#debtForm')?.addEventListener('submit', handleDebtSubmit);
  document.querySelectorAll('[data-delete-debt]').forEach((button) => button.addEventListener('click', () => {
    const record = debtRecords.find((item) => item.id === button.dataset.deleteDebt);
    if (!record || !window.confirm(`هل تريد حذف مبلغ ${formatMoney(record.amount)} المسجل باسم ${record.person}؟`)) return;
    debtRecords = debtRecords.filter((item) => item.id !== record.id);
    saveDesktopCollection('debts', debtRecords);
    render();
  }));
  document.querySelector('#invoiceForm')?.addEventListener('submit', handleInvoiceSubmit);
  document.querySelector('#invoiceForm input[name="amount"]')?.addEventListener('input', (event) => {
    const preview = document.querySelector('#invoiceAmountPreview');
    preview.textContent = event.currentTarget.value ? `كتابةً: ${amountInArabic(event.currentTarget.value)} لا غير.` : 'سيظهر السعر كتابةً بالعربية بعد إدخاله.';
  });
  document.querySelectorAll('[data-print-invoice]').forEach((button) => button.addEventListener('click', () => {
    const invoice = invoices.find((item) => item.id === button.dataset.printInvoice);
    if (invoice) printInvoice(invoice);
  }));
  document.querySelectorAll('[data-delete-invoice]').forEach((button) => button.addEventListener('click', () => {
    if (!window.confirm('هل تريد حذف هذه الفاتورة من هذا الجهاز؟')) return;
    invoices = invoices.filter((item) => item.id !== button.dataset.deleteInvoice);
    saveDesktopCollection('invoices', invoices);
    render();
  }));
  document.querySelector('#clearNotepad')?.addEventListener('click', () => {
    if (!notepadText || !window.confirm('هل تريد مسح كل محتوى المفكرة من هذا الجهاز؟')) return;
    notepadText = '';
    localStorage.removeItem(notepadStorageKey());
    render();
    document.querySelector('#notepadText')?.focus();
  });
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
  if (search) {
    search.addEventListener('input', (event) => { searchTerm = event.target.value; render(); const next = document.querySelector('#siteSearch'); next?.focus(); next?.setSelectionRange(searchTerm.length, searchTerm.length); });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); openGoogleSearch(searchTerm); }
    });
  }
  document.querySelector('#googleSearchButton')?.addEventListener('click', () => openGoogleSearch(searchTerm));
  const salesDate = document.querySelector('#salesDate');
  if (salesDate) salesDate.addEventListener('change', (event) => { selectedSalesDate = event.target.value; render(); });
  const reportMonth = document.querySelector('#reportMonth');
  if (reportMonth) reportMonth.addEventListener('change', (event) => { selectedReportMonth = event.target.value || todayKey().slice(0, 7); });
  document.querySelector('#printDailyReport')?.addEventListener('click', () => openReportDialog('daily'));
  document.querySelector('#printMonthlyReport')?.addEventListener('click', () => openReportDialog('range'));
  document.querySelector('#reportDialogStart')?.addEventListener('change', (event) => {
    reportDialogStart = event.target.value || todayKey();
    if (reportDialogMode === 'range' && reportDialogEnd < reportDialogStart) reportDialogEnd = reportDialogStart;
    render();
  });
  document.querySelector('#reportDialogEnd')?.addEventListener('change', (event) => {
    reportDialogEnd = event.target.value || reportDialogStart;
    if (reportDialogEnd < reportDialogStart) reportDialogStart = reportDialogEnd;
    render();
  });
  document.querySelectorAll('[data-close-report]').forEach((button) => button.addEventListener('click', closeReportDialog));
  document.querySelector('[data-report-backdrop]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeReportDialog(); });
  document.querySelector('#confirmPrintReport')?.addEventListener('click', printSelectedReport);
  document.querySelector('#transactionSiteSelect')?.addEventListener('change', updateCustomServiceField);
  updateCustomServiceField();
  document.querySelector('#transactionForm')?.addEventListener('input', updateTransactionProfitPreview);
  document.querySelector('#transactionForm')?.addEventListener('change', updateTransactionProfitPreview);
  updateTransactionProfitPreview();
  document.querySelector('#transactionForm')?.addEventListener('submit', handleTransactionSubmit);
  document.querySelector('#expenseForm')?.addEventListener('submit', handleExpenseSubmit);
  document.querySelector('#bankCreateForm')?.addEventListener('submit', handleBankCreate);
  document.querySelector('#bankEditForm')?.addEventListener('submit', handleBankEdit);
  document.querySelector('#bankAdjustForm')?.addEventListener('submit', handleBankAdjust);
  document.querySelector('#bankOperationForm')?.addEventListener('submit', handleBankOperation);
  document.querySelector('#bankTransferForm')?.addEventListener('submit', handleBankTransfer);
  document.querySelector('#siteForm')?.addEventListener('submit', handleSiteSave);
  document.querySelector('#officeNameForm')?.addEventListener('submit', handleOfficeNameSave);
  document.querySelector('#officeLocationForm')?.addEventListener('submit', handleOfficeLocationSave);
  document.querySelector('[data-copy-public-page]')?.addEventListener('click', async () => {
    const pageUrl = officePublicPageUrl();
    try {
      if (!pageUrl || !navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(pageUrl);
      showToast('تم نسخ رابط الصفحة العامة.');
    } catch { showToast('تعذر نسخ الرابط تلقائيًا؛ افتح الرابط واضغط مطولًا لنسخه.', 'error'); }
  });
  document.querySelector('#passwordChangeRequestForm')?.addEventListener('submit', handlePasswordChangeRequest);
  document.querySelector('#recordDeletionPasswordForm')?.addEventListener('submit', handleRecordDeletionPasswordSave);
  document.querySelector('#recordDeleteForm')?.addEventListener('submit', handleRecordDeleteSubmit);
  document.querySelectorAll('[data-cancel-delete]').forEach((button) => button.addEventListener('click', closeRecordDeleteDialog));
  document.querySelector('[data-delete-backdrop]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeRecordDeleteDialog(); });
  document.querySelector('[data-cancel-edit]')?.addEventListener('click', () => { editingSiteId = null; render(); });
  document.querySelectorAll('[data-edit-site]').forEach((button) => button.addEventListener('click', () => { editingSiteId = button.dataset.editSite; settingsDialog = 'sites'; render(); }));
  document.querySelectorAll('[data-delete-site]').forEach((button) => button.addEventListener('click', () => deleteSite(button.dataset.deleteSite)));
  document.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', () => deleteRecord(button.dataset.deleteRecord)));
}

function handleDebtSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const person = String(form.get('person') || '').trim();
  const amount = Number(form.get('amount'));
  if (!person || !Number.isFinite(amount) || amount <= 0) return showToast('أدخل الاسم ومبلغًا أكبر من صفر.', 'error');
  debtRecords.unshift({ id: uid('debt'), person, amount: Math.round(amount * 100) / 100, direction: form.get('direction') === 'payable' ? 'payable' : 'receivable', note: String(form.get('note') || '').trim(), createdAt: new Date().toISOString() });
  saveDesktopCollection('debts', debtRecords);
  showToast('تم حفظ المبلغ محليًا على هذا الجهاز.');
  render();
}

function handleInvoiceSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const customerName = String(form.get('customerName') || '').trim();
  const serviceDescription = String(form.get('serviceDescription') || '').trim();
  const amount = Number(form.get('amount'));
  if (!customerName || !serviceDescription || !Number.isFinite(amount) || amount <= 0 || amount > 999999999) return showToast('تحقق من اسم العميل ووصف الخدمة والسعر.', 'error');
  const createdAt = new Date().toISOString();
  const invoice = { id: uid('invoice'), number: `INV-${todayKey().replaceAll('-', '')}-${Date.now()}`, customerName, serviceDescription, amount: Math.round(amount * 100) / 100, createdAt, officeName: authSession.account?.officeName || state.officeName || 'المكتب' };
  invoices.unshift(invoice);
  saveDesktopCollection('invoices', invoices);
  showToast('تم إنشاء الفاتورة وحفظها على هذا الجهاز.');
  render();
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

function isGoogleMapsLocation(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co'
      || host === 'google.com' || host.endsWith('.google.com');
    return url.protocol === 'https:' && allowed;
  } catch { return false; }
}

async function handleOfficeLocationSave(event) {
  event.preventDefault();
  const officeLocation = String(new FormData(event.currentTarget).get('officeLocation') || '').trim();
  if (officeLocation && !isGoogleMapsLocation(officeLocation)) return showToast('أدخل رابط مشاركة صالحًا من خرائط Google يبدأ بـ https://.', 'error');
  const previous = state.officeLocation || '';
  state.officeLocation = officeLocation;
  try {
    await saveState(undefined, true);
    showToast(officeLocation ? 'تم حفظ موقع المكتب وسيظهر في الصفحة العامة.' : 'تم حذف موقع المكتب من الصفحة العامة.');
    render();
  } catch (error) {
    state.officeLocation = previous;
    localStorage.setItem(userStateCacheKey(), JSON.stringify(state));
    showToast(error.message || 'تعذر حفظ موقع المكتب في Supabase.', 'error');
  }
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

const RECORD_DELETE_PBKDF2_ITERATIONS = 160000;

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveRecordDeletionHash(password, saltHex) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('المتصفح لا يدعم حماية رمز الحذف؛ حدّث التطبيق.');
  const salt = new Uint8Array((saltHex.match(/.{2}/g) || []).map((pair) => Number.parseInt(pair, 16)));
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: RECORD_DELETE_PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function createRecordDeletionProtection(password) {
  const salt = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await deriveRecordDeletionHash(password, salt), iterations: RECORD_DELETE_PBKDF2_ITERATIONS };
}

async function verifyRecordDeletionPassword(password, protection = state.recordDeletionProtection) {
  if (typeof password !== 'string' || password.length < 8 || !protection || protection.iterations !== RECORD_DELETE_PBKDF2_ITERATIONS || !/^[a-f0-9]{32}$/i.test(protection.salt || '') || !/^[a-f0-9]{64}$/i.test(protection.hash || '')) return false;
  return (await deriveRecordDeletionHash(password, protection.salt)) === protection.hash.toLowerCase();
}

async function handleRecordDeletionPasswordSave(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const currentPassword = String(data.get('currentPassword') || '');
  const newPassword = String(data.get('newPassword') || '');
  if (newPassword.length < 8 || newPassword.length > 128) return showToast('رمز الحذف يجب أن يكون بين 8 و128 خانة.', 'error');
  if (newPassword !== String(data.get('confirmPassword') || '')) return showToast('رمز الحذف وتأكيده غير متطابقين.', 'error');
  try {
    if (state.recordDeletionProtection && !await verifyRecordDeletionPassword(currentPassword)) return showToast('رمز الحذف الحالي غير صحيح.', 'error');
    const previousProtection = state.recordDeletionProtection;
    state.recordDeletionProtection = await createRecordDeletionProtection(newPassword);
    try { await saveState(undefined, true); }
    catch (error) { state.recordDeletionProtection = previousProtection; saveState(); throw error; }
    showToast('تم حفظ رمز حماية المعاملات.');
    render();
  } catch (error) { showToast(error.message || 'تعذر إنشاء رمز الحذف.', 'error'); }
}

function deleteRecord(value) {
  if (!state.recordDeletionProtection?.hash) {
    showToast('اضبط رمز حذف السجلات أولاً من الإعدادات.', 'error');
    navigate('settings');
    return;
  }
  const [type, id] = value.split(':');
  if (!['transaction', 'expense'].includes(type) || !id) return;
  recordToDelete = { type, id };
  render();
  setTimeout(() => document.querySelector('#recordDeleteForm input[name="deletionPassword"]')?.focus(), 0);
}

function closeRecordDeleteDialog() {
  recordToDelete = null;
  render();
}

async function handleRecordDeleteSubmit(event) {
  event.preventDefault();
  if (!recordToDelete) return;
  const form = event.currentTarget;
  const password = String(new FormData(form).get('deletionPassword') || '');
  if (!await verifyRecordDeletionPassword(password)) return showToast('رمز الحذف غير صحيح.', 'error');
  const key = recordToDelete.type === 'transaction' ? 'transactions' : 'expenses';
  const previous = state[key];
  state[key] = previous.filter((item) => item.id !== recordToDelete.id);
  try {
    await saveState(password);
    recordToDelete = null;
    showToast('تم حذف السجل بعد التحقق من الرمز.');
    render();
  } catch (error) {
    state[key] = previous;
    saveState();
    const message = error.code === 'invalid_record_deletion_password' ? 'الخادم رفض الرمز؛ تحقق من إعداد الحماية وأعد المحاولة.' : error.code === 'record_deletion_password_required' ? 'لا يوجد رمز حماية محفوظ لهذا الحساب. اضبطه من الإعدادات أولاً.' : error.message || 'تعذر حذف السجل؛ أُعيدت البيانات كما كانت.';
    showToast(message, 'error');
    render();
  }
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amount = Number(data.get('amount'));
  const costAmount = Number(data.get('costAmount') || 0);
  const siteId = String(data.get('siteId') || '');
  const site = state.sites.find((item) => item.id === siteId);
  const customName = String(data.get('customServiceName') || '').trim();
  const siteName = siteId === '__custom__' ? customName : site?.name;
  if (!siteName || siteId === '__custom__' && customName.length > 120 || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(costAmount) || costAmount < 0 || costAmount > 1_000_000_000) return showToast('أدخل نوع المعاملة وسعر البيع والتكلفة بشكل صحيح.', 'error');
  const desktop = Boolean(window.desktopBridge?.syncSiteTabs);
  const costPaymentMethod = desktop && data.get('costPaymentMethod') === 'bank' ? 'bank' : 'cash';
  const costBankAccountId = costPaymentMethod === 'bank' ? String(data.get('costBankAccountId') || '') : null;
  const receiptMethod = desktop && data.get('receiptMethod') === 'bank' ? 'bank' : 'cash';
  const receiptBankAccountId = receiptMethod === 'bank' ? String(data.get('receiptBankAccountId') || '') : null;
  if (costPaymentMethod === 'bank' && !state.bankAccounts.some((account) => account.id === costBankAccountId)) return showToast('اختر البنك الذي دُفعت منه تكلفة الخدمة.', 'error');
  if (receiptMethod === 'bank' && !state.bankAccounts.some((account) => account.id === receiptBankAccountId)) return showToast('اختر البنك الذي استلم قيمة العميل.', 'error');
  const createdAt = new Date().toISOString();
  state.transactions.push({ id: uid('txn'), siteId: site?.id || null, siteName, amount, costAmount, profitAmount: amount - costAmount, paymentMethod: costPaymentMethod, bankAccountId: costBankAccountId, costPaymentMethod, costBankAccountId, receiptMethod, receiptBankAccountId, createdAt, dateKey: todayKey() });
  saveState();
  showToast('تم تسجيل المعاملة');
  render();
}

function handleExpenseSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amount = Number(data.get('amount'));
  if (!String(data.get('description')).trim() || !amount || amount < 0) return showToast('أدخل وصف وقيمة المصروف', 'error');
  const paymentMethod = window.desktopBridge?.syncSiteTabs && data.get('paymentMethod') === 'bank' ? 'bank' : 'cash';
  const bankAccountId = paymentMethod === 'bank' ? String(data.get('bankAccountId') || '') : null;
  if (paymentMethod === 'bank' && !state.bankAccounts.some((account) => account.id === bankAccountId)) return showToast('اختر حسابًا بنكيًا صالحًا أو أضف حسابًا جديدًا من قسم الحسابات البنكية.', 'error');
  const createdAt = new Date().toISOString();
  state.expenses.push({ id: uid('exp'), description: String(data.get('description')).trim(), amount, paymentMethod, bankAccountId, createdAt, dateKey: todayKey() });
  saveState();
  showToast('تمت إضافة المصروف');
  render();
}

function bankImageInput(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try { const url = new URL(candidate); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

function addBankOperation(operation) {
  state.bankOperations.push({ id: uid('bank-op'), createdAt: new Date().toISOString(), dateKey: todayKey(), ...operation });
  bankActionModal = null;
  saveState();
  render();
}

function handleBankCreate(event) {
  event.preventDefault();
  if (!window.desktopBridge?.syncSiteTabs) return;
  if (state.bankAccounts.length >= 40) return showToast('وصلت إلى الحد الأقصى للحسابات البنكية (40).', 'error');
  const data = new FormData(event.currentTarget);
  const name = String(data.get('name') || '').trim();
  const openingBalance = Number(data.get('openingBalance'));
  const imageUrl = bankImageInput(data.get('imageUrl'));
  if (!name || name.length > 80 || !Number.isFinite(openingBalance) || openingBalance < 0 || imageUrl === null) return showToast('تحقق من اسم البنك والرصيد ورابط الصورة الآمن (HTTPS).', 'error');
  const createdAt = new Date().toISOString();
  const account = { id: uid('bank'), name, imageUrl, openingBalance: Math.round(openingBalance * 100) / 100, createdAt, dateKey: todayKey() };
  state.bankAccounts.push(account);
  selectedBankAccountId = account.id;
  bankActionModal = null;
  saveState();
  showToast('تمت إضافة الحساب البنكي.');
  render();
}

function handleBankEdit(event) {
  event.preventDefault();
  const account = state.bankAccounts.find((item) => item.id === selectedBankAccountId);
  if (!account) return;
  const data = new FormData(event.currentTarget);
  const name = String(data.get('name') || '').trim();
  const imageUrl = bankImageInput(data.get('imageUrl'));
  if (!name || name.length > 80 || imageUrl === null) return showToast('تحقق من اسم الحساب ورابط الصورة الآمن (HTTPS).', 'error');
  account.name = name;
  account.imageUrl = imageUrl;
  bankActionModal = null;
  saveState();
  showToast('تم تحديث بيانات الحساب.');
  render();
}

function handleBankOperation(event) {
  event.preventDefault();
  const account = state.bankAccounts.find((item) => item.id === selectedBankAccountId);
  if (!account) return;
  const data = new FormData(event.currentTarget);
  const type = String(data.get('type') || '');
  const amount = Number(data.get('amount'));
  const description = String(data.get('description') || '').trim();
  if (!['deposit', 'withdrawal'].includes(type) || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || !description) return showToast('أدخل نوع الحركة والمبلغ والبيان بشكل صحيح.', 'error');
  addBankOperation({ type, bankAccountId: account.id, amount: Math.round(amount * 100) / 100, description });
  showToast(type === 'deposit' ? 'تم تسجيل الإيداع.' : 'تم تسجيل السحب.');
}

function handleBankAdjust(event) {
  event.preventDefault();
  const account = state.bankAccounts.find((item) => item.id === selectedBankAccountId);
  if (!account) return;
  const data = new FormData(event.currentTarget);
  const targetBalance = Number(data.get('targetBalance'));
  const description = String(data.get('description') || '').trim();
  if (!Number.isFinite(targetBalance) || Math.abs(targetBalance) > 1_000_000_000 || !description) return showToast('أدخل الرصيد الفعلي وسبب التسوية.', 'error');
  const delta = Math.round((targetBalance - bankBalance(account, state.bankOperations, state.transactions, state.expenses)) * 100) / 100;
  if (!delta) return showToast('الرصيد المدخل مطابق للرصيد المسجل؛ لا توجد تسوية مطلوبة.', 'error');
  addBankOperation({ type: 'adjustment', bankAccountId: account.id, delta, amount: Math.abs(delta), description });
  showToast('تم تسجيل تسوية الرصيد وحفظ أثرها في الكشف.');
}

function handleBankTransfer(event) {
  event.preventDefault();
  const from = state.bankAccounts.find((item) => item.id === selectedBankAccountId);
  const data = new FormData(event.currentTarget);
  const toBankAccountId = String(data.get('toBankAccountId') || '');
  const to = state.bankAccounts.find((item) => item.id === toBankAccountId);
  const amount = Number(data.get('amount'));
  if (!from || !to || from.id === to.id || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return showToast('اختر حسابًا مستلمًا مختلفًا وأدخل مبلغًا صحيحًا.', 'error');
  addBankOperation({ type: 'transfer', bankAccountId: from.id, toBankAccountId: to.id, amount: Math.round(amount * 100) / 100, description: String(data.get('description') || '').trim() });
  showToast('تم تسجيل التحويل في كشف الحسابين.');
}

function deleteSite(id) {
  const site = state.sites.find((item) => item.id === id);
  if (!site || !window.confirm(`حذف موقع «${site.name}»؟`)) return;
  state.sites = state.sites.filter((item) => item.id !== id);
  saveState();
  showToast('تم حذف الموقع');
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
window.addEventListener('servicehub-toast', (event) => {
  const detail = event.detail || {};
  showToast(detail.message || '', detail.type || 'success');
});
window.addEventListener('hashchange', () => { currentView = getViewFromHash(); activeSiteTabId = null; render(); });
window.addEventListener('resize', () => syncDesktopSiteViews());
window.desktopBridge?.onSitePopup?.(({ url, title }) => {
  const safe = safeUrl(url);
  if (!safe) return;
  openSiteTab({ id: uid('popup'), name: String(title || 'صفحة خدمة').slice(0, 120), url: safe, image: '' });
});
trackPublicVisitor();
if (publicPageSlug) loadPublicOfficePage();
else restoreSession();
