const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow;
const siteViews = new Map();
const siteSession = () => session.fromPartition('persist:servicehub-sites');
let downloadHandlerConfigured = false;

function configureDownloads() {
  if (downloadHandlerConfigured) return;
  downloadHandlerConfigured = true;
  siteSession().on('will-download', (_event, item) => {
    const baseName = path.basename(item.getFilename() || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'download';
    const directory = app.getPath('downloads');
    const extension = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - extension.length);
    let candidate = path.join(directory, baseName);
    let counter = 1;
    while (fs.existsSync(candidate)) candidate = path.join(directory, `${stem} (${counter++})${extension}`);
    item.setSavePath(candidate);
  });
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function closeSiteView(id) {
  const item = siteViews.get(id);
  if (!item) return;
  try { mainWindow?.contentView.removeChildView(item.view); } catch { /* the window may already be closing */ }
  try { item.view.webContents.close(); } catch { /* already destroyed */ }
  siteViews.delete(id);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function loadConnectionError(view, url, errorCode, description) {
  if (errorCode === -3 || view.webContents.isDestroyed()) return;
  const safeUrl = safeHttpUrl(url);
  const message = escapeHtml(description || `رمز الخطأ ${errorCode}`);
  const retry = safeUrl ? `<a href="${escapeHtml(safeUrl)}">إعادة المحاولة داخل التطبيق</a>` : '';
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تعذر تحميل الخدمة</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f8f7;color:#173b3b;font:16px Tahoma,Arial,sans-serif}.card{max-width:560px;margin:24px;padding:32px;background:#fff;border:1px solid #dce8e5;border-radius:18px;box-shadow:0 16px 40px #183c3c18;text-align:center}h1{font-size:24px}p{line-height:1.8;color:#58716d}.code{font:12px monospace;color:#849590}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:9px;background:#087f68;color:#fff;text-decoration:none}</style><main class="card"><h1>تعذر الاتصال بموقع الخدمة</h1><p>تحقق من اتصال الإنترنت أو جرّب إعادة التحميل. إذا استمرت المشكلة، فقد يمنع الموقع عرضه داخل التطبيق بسبب سياسة الأمان الخاصة به.</p><p class="code">${message}</p>${retry}</main></html>`;
  view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
}

function createSiteView(tab) {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      session: siteSession()
    }
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = safeHttpUrl(url);
    if (safeUrl && mainWindow && !mainWindow.isDestroyed()) {
      let title = 'صفحة خدمة';
      try { title = new URL(safeUrl).hostname; } catch { /* safe fallback */ }
      mainWindow.webContents.send('site-popup-request', { url: safeUrl, title });
    }
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    if (!safeHttpUrl(url)) event.preventDefault();
  });
  view.webContents.on('did-fail-load', (_event, errorCode, description, validatedUrl, isMainFrame) => {
    if (isMainFrame) loadConnectionError(view, validatedUrl || tab.url, errorCode, description);
  });
  configureDownloads();
  mainWindow.contentView.addChildView(view);
  siteViews.set(tab.id, { view, url: tab.url });
  view.webContents.loadURL(tab.url).catch(() => {});
  return view;
}

function syncSiteTabs(tabs, activeId, bounds) {
  if (!mainWindow || mainWindow.isDestroyed() || !Array.isArray(tabs)) return;
  const cleanTabs = tabs.slice(0, 40).map((tab) => ({
    id: typeof tab?.id === 'string' ? tab.id.slice(0, 120) : '',
    name: typeof tab?.name === 'string' ? tab.name.slice(0, 120) : 'خدمة',
    url: safeHttpUrl(tab?.url)
  })).filter((tab) => tab.id && tab.url);
  const wanted = new Set(cleanTabs.map((tab) => tab.id));
  for (const id of siteViews.keys()) if (!wanted.has(id)) closeSiteView(id);
  for (const tab of cleanTabs) {
    let item = siteViews.get(tab.id);
    if (!item) {
      const view = createSiteView(tab);
      item = { view, url: tab.url };
    } else if (item.url !== tab.url) {
      item.url = tab.url;
      item.view.webContents.loadURL(tab.url).catch(() => {});
    }
    if (tab.id === activeId && bounds && bounds.width > 0 && bounds.height > 0) {
      item.view.setBounds({
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height))
      });
      item.view.setVisible(true);
    } else {
      item.view.setVisible(false);
      item.view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'Service Hub Desktop',
    autoHideMenuBar: true,
    backgroundColor: '#071f23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'p') {
      const active = [...siteViews.values()].find(({ view }) => view.getVisible());
      if (active) { event.preventDefault(); active.view.webContents.print({ printBackground: true }); }
    }
  });
  mainWindow.on('closed', () => {
    for (const id of [...siteViews.keys()]) closeSiteView(id);
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.on('sync-site-tabs', (_event, tabs, activeId, bounds) => syncSiteTabs(tabs, activeId, bounds));
  ipcMain.handle('print-active-site', () => {
    const active = [...siteViews.values()].find(({ view }) => view.getVisible());
    if (!active) return false;
    active.view.webContents.print({ printBackground: true });
    return true;
  });
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
