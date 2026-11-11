// Nur die Einrichtungsseite (lokale Datei) bekommt Zugriff auf die Einstellungen.
// Seiten aus Home Assistant erhalten nichts.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('musikSetup', {
    get: () => ipcRenderer.invoke('setup:get'),
    save: (data) => ipcRenderer.invoke('setup:save', data),
  });
}
