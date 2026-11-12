const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  syncSiteTabs: (tabs, activeId, bounds) => ipcRenderer.send('sync-site-tabs', tabs, activeId, bounds),
  printActiveSite: () => ipcRenderer.invoke('print-active-site'),
  getRememberedLogin: () => ipcRenderer.invoke('get-remembered-login'),
  saveRememberedLogin: (credentials) => ipcRenderer.invoke('save-remembered-login', credentials),
  clearRememberedLogin: () => ipcRenderer.invoke('clear-remembered-login'),
  backupLocalData: (localStorageData) => ipcRenderer.invoke('backup-local-data', localStorageData),
  restoreLocalData: () => ipcRenderer.invoke('restore-local-data'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  acquireScannerImage: () => ipcRenderer.invoke('scanner:acquire'),
  readScannerImage: (id) => ipcRenderer.invoke('scanner:read-image', id),
  recognizeScannerText: (id, language) => ipcRenderer.invoke('scanner:recognize-text', id, language),
  deleteScannerImage: (id) => ipcRenderer.invoke('scanner:delete-image', id),
  copyText: (text) => ipcRenderer.invoke('scanner:copy-text', text),
  exportScannerDocument: (request) => ipcRenderer.invoke('scanner:export', request),
  printScannerDocument: (id) => ipcRenderer.invoke('scanner:print', id),
  onScannerOcrProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('scanner:ocr-progress', listener);
    return () => ipcRenderer.removeListener('scanner:ocr-progress', listener);
  },
  onSitePopup: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('site-popup-request', listener);
    return () => ipcRenderer.removeListener('site-popup-request', listener);
  },
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  }
});
