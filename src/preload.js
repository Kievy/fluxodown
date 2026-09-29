const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('downloader', {
  init: () => ipcRenderer.invoke('app:init'),
  inspect: url => ipcRenderer.invoke('video:inspect', url),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  download: options => ipcRenderer.invoke('download:start', options),
  cancel: () => ipcRenderer.invoke('download:cancel'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  onProgress: callback => { ipcRenderer.on('download:event', (_event, data) => callback(data)); },
});
