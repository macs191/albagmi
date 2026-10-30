const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');

let mainWindow;
const siteSession = () => session.fromPartition('persist:servicehub-sites');

function createSiteWindow(url, title) {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: title || 'Service Hub',
    autoHideMenuBar: true,
    backgroundColor: '#f7fbfa',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      session: siteSession()
    }
  });
  window.loadURL(url);
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
  });
  return window;
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
}

app.whenReady().then(() => {
  ipcMain.handle('open-service-site', (_event, { url, title }) => {
    if (!/^https?:\/\//i.test(url)) return false;
    createSiteWindow(url, title);
    return true;
  });
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
