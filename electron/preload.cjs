const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  syncSiteTabs: (tabs, activeId, bounds) => ipcRenderer.send('sync-site-tabs', tabs, activeId, bounds),
  printActiveSite: () => ipcRenderer.invoke('print-active-site'),
  onSitePopup: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('site-popup-request', listener);
    return () => ipcRenderer.removeListener('site-popup-request', listener);
  }
});
