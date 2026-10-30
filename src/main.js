import './styles.css';

const STORAGE_KEY = 'servicehub-desktop-v1';
const DEVELOPER_PASSWORD = '171002';
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
let currentView = getViewFromHash();
let currentSite = null;
let settingsUnlocked = false;
let searchTerm = '';
let categoryFilter = 'الكل';
let selectedSalesDate = todayKey();
let editingSiteId = null;
let toastTimer;

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getViewFromHash() {
  const value = window.location.hash.replace('#', '');
  return ['sales', 'settings'].includes(value) ? value : 'home';
}

function navigate(view) {
  currentSite = null;
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
  if (currentSite) {
    root.innerHTML = renderViewer();
    return;
  }
  root.innerHTML = renderShell();
  bindViewEvents();
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
        <button class="nav-item ${currentView === 'settings' ? 'active' : ''}" data-nav="settings">${icon('settings')}<span>الإعدادات</span>${!settingsUnlocked ? '<small>مقفل</small>' : ''}</button>
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span> البيانات محفوظة على الجهاز</div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <div class="breadcrumb"><span>Service Hub</span><b>/</b><strong>${currentView === 'home' ? 'الرئيسية' : currentView === 'sales' ? 'المبيعات' : 'الإعدادات'}</strong></div>
        <div class="topbar-actions"><span class="live-badge"><i></i> يعمل محليًا</span><button class="icon-btn" data-nav="settings" aria-label="الإعدادات">${icon('settings', 18)}</button></div>
      </header>
      <div class="page-container">${currentView === 'home' ? renderHome() : currentView === 'sales' ? renderSales() : renderSettings()}</div>
    </main>
  </div>`;
}

function renderHome() {
  const filteredSites = state.sites.filter((site) => {
    const matchesSearch = `${site.name} ${site.category}`.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'الكل' || (categoryFilter === 'المفضلة' ? site.favorite : site.category === categoryFilter);
    return matchesSearch && matchesCategory;
  });
  const categories = ['الكل', 'المفضلة', ...new Set(state.sites.map((site) => site.category))];
  return `<section class="home-view">
    <div class="hero-line"><div><p class="eyebrow">مساحة العمل</p><h1>${escapeHtml(state.officeName)}</h1><p class="page-subtitle">كل مواقع الخدمات التي تحتاجها في مكان واحد.</p></div><div class="hero-stat"><span>${state.sites.length}</span><small>موقع محفوظ</small></div></div>
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
    <div class="summary-grid"><div class="summary-card sales"><span class="summary-icon">${icon('receipt')}</span><div><small>إجمالي المعاملات</small><strong>${formatMoney(salesTotal)}</strong></div></div><div class="summary-card expense"><span class="summary-icon">${icon('wallet')}</span><div><small>إجمالي المصروفات</small><strong>${formatMoney(expensesTotal)}</strong></div></div><div class="summary-card net"><span class="summary-icon">${icon('sales')}</span><div><small>صافي اليوم</small><strong>${formatMoney(net)}</strong></div></div></div>
    <div class="sales-layout"><div class="panel form-panel"><div class="panel-heading"><div><p class="eyebrow">إضافة جديدة</p><h2>تسجيل معاملة</h2></div><span class="panel-index">01</span></div><form id="transactionForm" class="form-grid"><label>اسم العميل<input name="customer" required placeholder="مثال: عبدالله محمد"></label><label>نوع الخدمة<select name="siteId" required>${state.sites.length ? state.sites.map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`).join('') : '<option value="">أضف خدمة من الإعدادات أولًا</option>'}</select></label><label>سعر المعاملة<input name="amount" required type="number" min="0" step="0.01" placeholder="0.00"></label><button class="primary-btn" type="submit">${icon('plus', 17)} تسجيل المعاملة</button></form></div><div class="panel form-panel expense-panel"><div class="panel-heading"><div><p class="eyebrow">إدارة المصاريف</p><h2>تسجيل مصروف</h2></div><span class="panel-index">02</span></div><form id="expenseForm" class="form-grid"><label>نوع المصروف<input name="description" required placeholder="مثال: طعام، وقود، شحن"></label><label>القيمة<input name="amount" required type="number" min="0" step="0.01" placeholder="0.00"></label><button class="secondary-btn" type="submit">${icon('plus', 17)} إضافة المصروف</button></form></div></div>
    <div class="records-layout"><div class="panel records-panel"><div class="panel-heading"><div><p class="eyebrow">الحركة المالية</p><h2>المعاملات</h2></div><span class="record-count">${transactions.length}</span></div>${transactions.length ? `<div class="records-list">${transactions.slice().reverse().map((item) => `<div class="record-row"><span class="record-avatar">${escapeHtml(item.customer.trim().slice(0, 1))}</span><div class="record-main"><strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.siteName)} · ${formatDateTime(item.createdAt)}</small></div><b class="amount-positive">+ ${formatMoney(item.amount)}</b><button class="row-delete" data-delete-record="transaction:${item.id}" aria-label="حذف المعاملة">${icon('trash', 17)}</button></div>`).join('')}</div>` : `<div class="small-empty">لا توجد معاملات في التاريخ المحدد.</div>`}</div><div class="panel records-panel"><div class="panel-heading"><div><p class="eyebrow">المصروفات</p><h2>المصاريف اليومية</h2></div><span class="record-count">${expenses.length}</span></div>${expenses.length ? `<div class="records-list">${expenses.slice().reverse().map((item) => `<div class="record-row"><span class="record-avatar expense-avatar">${icon('wallet', 17)}</span><div class="record-main"><strong>${escapeHtml(item.description)}</strong><small>${formatDateTime(item.createdAt)}</small></div><b class="amount-negative">- ${formatMoney(item.amount)}</b><button class="row-delete" data-delete-record="expense:${item.id}" aria-label="حذف المصروف">${icon('trash', 17)}</button></div>`).join('')}</div>` : `<div class="small-empty">لا توجد مصروفات في التاريخ المحدد.</div>`}</div></div>
  </section>`;
}

function renderSettings() {
  if (!settingsUnlocked) return `<section class="settings-lock"><div class="lock-card"><div class="lock-icon">${icon('lock', 30)}</div><p class="eyebrow">وصول المطور</p><h1>الإعدادات مقفلة</h1><p>أدخل كلمة المرور للوصول إلى إدارة المواقع واسم المكتب.</p><form id="unlockForm"><label>كلمة مرور المطور<input id="developerPassword" type="password" inputmode="numeric" autocomplete="off" required placeholder="••••••"></label><button class="primary-btn" type="submit">${icon('lock', 17)} فتح الإعدادات</button></form></div></section>`;
  const editingSite = state.sites.find((site) => site.id === editingSiteId);
  return `<section class="settings-view"><div class="view-title-row"><div><p class="eyebrow">التحكم في التطبيق</p><h1>الإعدادات</h1><p class="page-subtitle">أدر اسم المكتب ومواقع الخدمات من مكان واحد.</p></div><button class="ghost-btn" data-lock-settings>${icon('lock', 17)} قفل الإعدادات</button></div>
    <div class="settings-grid"><div class="panel office-panel"><div class="panel-heading"><div><p class="eyebrow">الهوية</p><h2>اسم المكتب أو المؤسسة</h2></div></div><form id="officeForm" class="inline-form"><input name="officeName" value="${escapeHtml(state.officeName)}" required><button class="primary-btn" type="submit">حفظ الاسم</button></form><p class="helper-text">سيظهر الاسم أعلى كروت المواقع في الواجهة الرئيسية فقط.</p></div><div class="panel add-site-panel"><div class="panel-heading"><div><p class="eyebrow">دليل المواقع</p><h2>${editingSite ? 'تعديل موقع' : 'إضافة موقع جديد'}</h2></div>${editingSite ? `<button class="text-btn" data-cancel-edit>إلغاء التعديل</button>` : ''}</div><form id="siteForm" class="form-grid site-form"><label>اسم الموقع<input name="name" required value="${editingSite ? escapeHtml(editingSite.name) : ''}" placeholder="مثال: تأميني"></label><label>التصنيف<input name="category" required value="${editingSite ? escapeHtml(editingSite.category) : ''}" placeholder="مثال: التأمين"></label><label class="full-span">رابط الموقع<input name="url" type="url" required value="${editingSite ? escapeHtml(editingSite.url) : ''}" placeholder="https://example.com"></label><label class="full-span">رابط الصورة <span class="label-hint">اختياري</span><input name="imageUrl" type="url" value="${editingSite && !editingSite.image?.startsWith('data:') ? escapeHtml(editingSite.image) : ''}" placeholder="https://example.com/logo.png"></label><label class="file-picker full-span">أو اختر صورة من الجهاز<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><span>${icon('image', 17)} اختيار ملف صورة</span></label><button class="primary-btn" type="submit">${icon(editingSite ? 'edit' : 'plus', 17)} ${editingSite ? 'حفظ التعديل' : 'إضافة الموقع'}</button></form></div></div>
    <div class="panel manage-panel"><div class="panel-heading"><div><p class="eyebrow">إدارة المحتوى</p><h2>المواقع المضافة</h2></div><span class="record-count">${state.sites.length}</span></div><div class="manage-list">${state.sites.map((site) => `<div class="manage-row">${imageMarkup(site, 'mini-image')}<div class="record-main"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.category)}</small></div><div class="manage-actions"><button class="icon-btn" data-edit-site="${escapeHtml(site.id)}" aria-label="تعديل ${escapeHtml(site.name)}">${icon('edit', 17)}</button><button class="icon-btn danger" data-delete-site="${escapeHtml(site.id)}" aria-label="حذف ${escapeHtml(site.name)}">${icon('trash', 17)}</button></div></div>`).join('')}</div></div>
  </section>`;
}

function renderViewer() {
  const url = safeUrl(currentSite.url);
  return `<div class="viewer-shell"><header class="viewer-bar"><button class="viewer-back" data-close-viewer>${icon('back', 20)}<span>العودة إلى الكروت</span></button><div class="viewer-title">${imageMarkup(currentSite, 'viewer-image')}<strong>${escapeHtml(currentSite.name)}</strong></div><div class="viewer-actions"><button class="icon-btn" data-external-viewer aria-label="فتح خارج التطبيق">${icon('external', 18)}</button><button class="icon-btn" data-close-viewer aria-label="إغلاق">${icon('close', 18)}</button></div></header><main class="embedded-site"><div class="viewer-loading">جارٍ فتح الموقع…</div>${url ? `<iframe src="${escapeHtml(url)}" title="${escapeHtml(currentSite.name)}" allow="clipboard-read; clipboard-write; camera; microphone"></iframe>` : `<div class="viewer-error"><h2>الرابط غير صالح</h2><p>عد إلى الإعدادات لتعديل رابط الموقع.</p></div>`}</main></div>`;
}

function bindViewEvents() {
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
  document.querySelectorAll('[data-open-site]').forEach((button) => button.addEventListener('click', () => {
    const site = state.sites.find((item) => item.id === button.dataset.openSite);
    if (site) {
      if (window.desktopBridge?.openSite) {
        window.desktopBridge.openSite(site.url, site.name);
      } else {
        // مواقع الخدمات الحكومية والتأمين تمنع التضمين داخل iframe عبر CSP/X-Frame-Options.
        // في المعاينة العادية نفتحها في تبويب مستقل، أما نسخة Electron فتفتح نافذة مستقلة بلا رابط.
        window.open(site.url, '_blank', 'noopener,noreferrer');
      }
    }
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
  document.querySelector('#transactionForm')?.addEventListener('submit', handleTransactionSubmit);
  document.querySelector('#expenseForm')?.addEventListener('submit', handleExpenseSubmit);
  document.querySelector('#unlockForm')?.addEventListener('submit', handleUnlock);
  document.querySelector('#officeForm')?.addEventListener('submit', handleOfficeSave);
  document.querySelector('#siteForm')?.addEventListener('submit', handleSiteSave);
  document.querySelector('[data-lock-settings]')?.addEventListener('click', () => { settingsUnlocked = false; editingSiteId = null; render(); });
  document.querySelector('[data-cancel-edit]')?.addEventListener('click', () => { editingSiteId = null; render(); });
  document.querySelectorAll('[data-edit-site]').forEach((button) => button.addEventListener('click', () => { editingSiteId = button.dataset.editSite; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelectorAll('[data-delete-site]').forEach((button) => button.addEventListener('click', () => deleteSite(button.dataset.deleteSite)));
  document.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', () => deleteRecord(button.dataset.deleteRecord)));
}

function handleUnlock(event) {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get('password') || document.querySelector('#developerPassword')?.value;
  if (password === DEVELOPER_PASSWORD) { settingsUnlocked = true; showToast('تم فتح الإعدادات'); render(); }
  else showToast('كلمة المرور غير صحيحة', 'error');
}

function handleOfficeSave(event) {
  event.preventDefault();
  const name = String(new FormData(event.currentTarget).get('officeName') || '').trim();
  if (!name) return;
  state.officeName = name;
  saveState();
  showToast('تم حفظ اسم المكتب');
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

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-viewer]');
  if (close) { currentSite = null; render(); return; }
  const external = event.target.closest('[data-external-viewer]');
  if (external && currentSite) window.open(currentSite.url, '_blank', 'noopener,noreferrer');
});

window.addEventListener('hashchange', () => { currentView = getViewFromHash(); currentSite = null; render(); });
render();
