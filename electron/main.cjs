const { app, BrowserWindow, WebContentsView, ipcMain, session, safeStorage, Menu, clipboard, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { createWorker } = require('tesseract.js');
const { autoUpdater } = require('electron-updater');
const { exportScannerImage, prepareScannerOcrImage } = require('./scanner-formats.cjs');

let mainWindow;
const siteViews = new Map();
const siteSession = () => session.fromPartition('persist:servicehub-sites');
let downloadHandlerConfigured = false;
let updateCheckStarted = false;
let isQuitting = false;
function configureEditContextMenu(webContents) {
  webContents.on('context-menu', (_event, params = {}) => {
    const flags = params.editFlags || {};
    const template = [
      { label: 'قص', role: 'cut', enabled: Boolean(flags.canCut) },
      { label: 'نسخ', role: 'copy', enabled: Boolean(flags.canCopy) },
      { label: 'لصق', role: 'paste', enabled: Boolean(flags.canPaste) },
      { type: 'separator' },
      { label: 'تحديد الكل', role: 'selectAll', enabled: true }
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined });
  });
}

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

function rememberedLoginPath() {
  return path.join(app.getPath('userData'), 'remembered-login.json');
}

function readRememberedLogin() {
  try {
    const saved = JSON.parse(fs.readFileSync(rememberedLoginPath(), 'utf8'));
    if (!safeStorage.isEncryptionAvailable() || typeof saved.username !== 'string' || typeof saved.password !== 'string') return null;
    return { username: saved.username, password: safeStorage.decryptString(Buffer.from(saved.password, 'base64')) };
  } catch { return null; }
}

function saveRememberedLogin(credentials) {
  const username = String(credentials?.username || '').trim();
  const password = String(credentials?.password || '');
  if (!username || !password || username.length > 40 || password.length > 1024 || !safeStorage.isEncryptionAvailable()) return false;
  const file = rememberedLoginPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ username, password: safeStorage.encryptString(password).toString('base64') }), { mode: 0o600 });
  return true;
}

function clearRememberedLogin() {
  try { fs.unlinkSync(rememberedLoginPath()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return true;
}

function scannerDirectory() {
  return path.join(app.getPath('userData'), 'scans');
}

function scannerImagePath(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('معرّف ملف المسح غير صالح.');
  }
  return path.join(scannerDirectory(), `${id}.jpg`);
}

async function acquireScannerImage() {
  if (process.platform !== 'win32') throw new Error('المسح المباشر متاح في برنامج Windows فقط.');
  const id = crypto.randomUUID();
  const temporaryPath = path.join(app.getPath('temp'), `servicehub-scan-${id}.jpg`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$dialog = New-Object -ComObject WIA.CommonDialog",
    "$image = $dialog.ShowAcquireImage(1, 0, 0, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $false, $true, $false)",
    'if ($null -eq $image) { Write-Output "SCAN_CANCELLED"; exit 0 }',
    '$image.SaveFile($env:SERVICEHUB_SCAN_TEMP)',
    'Write-Output "SCAN_COMPLETE"'
  ].join('\n');
  try {
    await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: false,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, SERVICEHUB_SCAN_TEMP: temporaryPath }
    });
    if (!fs.existsSync(temporaryPath)) return { cancelled: true };
    const stats = fs.statSync(temporaryPath);
    if (!stats.isFile() || stats.size < 100 || stats.size > 35 * 1024 * 1024) throw new Error('حجم صورة المسح غير صالح أو يتجاوز 35 ميجابايت.');
    fs.mkdirSync(scannerDirectory(), { recursive: true });
    fs.copyFileSync(temporaryPath, scannerImagePath(id), fs.constants.COPYFILE_EXCL);
    return {
      id,
      filename: `مستند ممسوح ${new Date().toLocaleString('ar-SA').replace(/[/:]/g, '-')}.jpg`,
      createdAt: new Date().toISOString(),
      size: stats.size
    };
  } catch (error) {
    const details = String(error?.stderr || error?.message || '');
    if (/WIA|scanner|ماسح|device|جهاز/i.test(details)) throw new Error('لم يتم العثور على ماسح متوافق مع Windows WIA. تحقق من توصيل الماسح وتثبيت تعريفه.');
    throw new Error('تعذر المسح. تأكد من أن الماسح متصل ويعمل ثم حاول مرة أخرى.');
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch { /* temporary image may already have been moved */ }
  }
}

function readScannerImage(id) {
  const file = scannerImagePath(id);
  const stats = fs.statSync(file);
  if (!stats.isFile() || stats.size > 35 * 1024 * 1024) throw new Error('تعذر قراءة ملف المسح أو تجاوز حجمه الحد المسموح.');
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
}

async function recognizeScannerText(id, event) {
  const file = scannerImagePath(id);
  const stats = fs.statSync(file);
  if (!stats.isFile() || stats.size > 35 * 1024 * 1024) throw new Error('تعذر قراءة ملف المسح أو تجاوز حجمه الحد المسموح.');
  const imageData = await prepareScannerOcrImage(file);
  const imageBuffer = Buffer.from(imageData.slice(imageData.indexOf(',') + 1), 'base64');
  let worker;
  try {
    worker = await createWorker('ara+eng', 1, {
      langPath: path.join(__dirname, '..', 'dist', 'tesseract', 'tessdata'),
      gzip: true,
      cacheMethod: 'none',
      logger: (message) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send('scanner:ocr-progress', {
          id,
          status: String(message.status || ''),
          progress: Number.isFinite(message.progress) ? message.progress : null
        });
      }
    });
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    const result = await worker.recognize(imageBuffer);
    return { text: String(result.data?.text || '') };
  } catch (error) {
    console.error('[Service Hub OCR]', error);
    throw new Error(`تعذر تشغيل محرك OCR المحلي: ${String(error?.message || error).slice(0, 500)}`);
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}

function deleteScannerImage(id) {
  const file = scannerImagePath(id);
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return true;
}

async function exportScannerDocument(request) {
  const inputPath = scannerImagePath(request?.id);
  const formats = {
    jpeg: { extension: 'jpg', label: 'صورة JPEG' },
    png: { extension: 'png', label: 'صورة PNG' },
    bmp: { extension: 'bmp', label: 'صورة BMP' },
    tiff: { extension: 'tiff', label: 'صورة TIFF' },
    webp: { extension: 'webp', label: 'صورة WebP' },
    pdf: { extension: 'pdf', label: 'ملف PDF' }
  };
  const selected = formats[request?.format];
  if (!selected) throw new Error('صيغة الحفظ غير مدعومة.');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'حفظ المستند الممسوح',
    defaultPath: path.join(app.getPath('documents'), `مستند ممسوح.${selected.extension}`),
    filters: [{ name: selected.label, extensions: [selected.extension] }]
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  let outputPath = result.filePath;
  if (path.extname(outputPath).toLowerCase() !== `.${selected.extension}`) outputPath += `.${selected.extension}`;
  try {
    await exportScannerImage(inputPath, outputPath, request.format);
    return { cancelled: false, filename: path.basename(outputPath), format: request.format };
  } catch {
    try { fs.unlinkSync(outputPath); } catch { /* no output to remove */ }
    throw new Error(`تعذر حفظ الملف بصيغة ${selected.label}.`);
  }
}

async function printScannerDocument(id) {
  const image = fs.readFileSync(scannerImagePath(id)).toString('base64');
  const printWindow = new BrowserWindow({
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    width: 900,
    height: 900,
    show: true,
    title: 'معاينة وطباعة المستند',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة الطباعة</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#eef2f1}img{display:block;max-width:100%;max-height:calc(100vh - 40px);object-fit:contain;box-shadow:0 12px 40px #183c3c22}@page{size:A4;margin:10mm}@media print{body{display:block;min-height:0;padding:0;background:white}img{width:100%;height:100%;max-height:277mm;object-fit:contain;box-shadow:none}}</style><img src="data:image/jpeg;base64,${image}" alt="المستند الممسوح"></html>`;
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    printWindow.webContents.print({ silent: false, printBackground: true, pageSize: 'A4' }, () => {
      setTimeout(() => { if (!printWindow.isDestroyed()) printWindow.close(); }, 400);
    });
    return true;
  } catch {
    if (!printWindow.isDestroyed()) printWindow.close();
    throw new Error('تعذر فتح نافذة طباعة المستند.');
  }
}

function copyText(value) {
  const text = String(value || '');
  if (!text || text.length > 200000) return false;
  clipboard.writeText(text);
  return true;
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
      session: siteSession(),
      backgroundThrottling: false
    }
  });
  configureEditContextMenu(view.webContents);
  view.webContents.setAudioMuted(false);
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
  configureEditContextMenu(mainWindow.webContents);
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

function configureAutoUpdates() {
  if (updateCheckStarted || process.platform !== 'win32' || !app.isPackaged) return;
  updateCheckStarted = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('error', (error) => console.warn('Automatic update check failed:', error?.message || error));
  autoUpdater.on('update-downloaded', (info) => {
    const version = String(info?.version || 'الجديد');
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    dialog.showMessageBox(owner, {
      type: 'info',
      title: 'تحديث Service Hub جاهز',
      message: `تم تنزيل الإصدار ${version}. هل تريد إعادة تشغيل البرنامج وتثبيت التحديث الآن؟`,
      buttons: ['إعادة التشغيل والتحديث', 'لاحقًا'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch((error) => console.warn('Could not show update prompt:', error?.message || error));
  });
  setTimeout(() => {
    if (!isQuitting) autoUpdater.checkForUpdates().catch((error) => console.warn('Automatic update check failed:', error?.message || error));
  }, 10000).unref?.();
}

app.whenReady().then(() => {
  ipcMain.on('sync-site-tabs', (_event, tabs, activeId, bounds) => syncSiteTabs(tabs, activeId, bounds));
  ipcMain.handle('get-remembered-login', () => readRememberedLogin());
  ipcMain.handle('save-remembered-login', (_event, credentials) => saveRememberedLogin(credentials));
  ipcMain.handle('clear-remembered-login', () => clearRememberedLogin());
  ipcMain.handle('scanner:acquire', () => acquireScannerImage());
  ipcMain.handle('scanner:read-image', (_event, id) => readScannerImage(id));
  ipcMain.handle('scanner:recognize-text', (event, id) => recognizeScannerText(id, event));
  ipcMain.handle('scanner:delete-image', (_event, id) => deleteScannerImage(id));
  ipcMain.handle('scanner:copy-text', (_event, text) => copyText(text));
  ipcMain.handle('scanner:export', (_event, request) => exportScannerDocument(request));
  ipcMain.handle('scanner:print', (_event, id) => printScannerDocument(id));
  configureAutoUpdates();
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
app.on('before-quit', () => { isQuitting = true; });
