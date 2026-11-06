const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  syncSiteTabs: (tabs, activeId, bounds) => ipcRenderer.send('sync-site-tabs', tabs, activeId, bounds),
  printActiveSite: () => ipcRenderer.invoke('print-active-site'),
  getRememberedLogin: () => ipcRenderer.invoke('get-remembered-login'),
  saveRememberedLogin: (credentials) => ipcRenderer.invoke('save-remembered-login', credentials),
  clearRememberedLogin: () => ipcRenderer.invoke('clear-remembered-login'),
  acquireScannerImage: () => ipcRenderer.invoke('scanner:acquire'),
  readScannerImage: (id) => ipcRenderer.invoke('scanner:read-image', id),
  deleteScannerImage: (id) => ipcRenderer.invoke('scanner:delete-image', id),
  copyText: (text) => ipcRenderer.invoke('scanner:copy-text', text),
  exportScannerDocument: (request) => ipcRenderer.invoke('scanner:export', request),
  printScannerDocument: (id) => ipcRenderer.invoke('scanner:print', id),
  onSitePopup: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('site-popup-request', listener);
    return () => ipcRenderer.removeListener('site-popup-request', listener);
  }
});
