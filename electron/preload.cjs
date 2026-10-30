const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  openSite: (url, title) => ipcRenderer.invoke('open-service-site', { url, title })
});
