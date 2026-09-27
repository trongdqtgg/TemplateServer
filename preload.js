// Cầu nối an toàn giữa cửa sổ Cài đặt và app (không cho trang dùng Node trực tiếp)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  get: () => ipcRenderer.invoke('cfg:get'),
  save: cfg => ipcRenderer.invoke('cfg:save', cfg),
  open: what => ipcRenderer.invoke('app:open', what),
  copy: text => ipcRenderer.invoke('app:copy', text),
  checkUpdate: () => ipcRenderer.invoke('upd:check'),
  onStatus: fn => ipcRenderer.on('status', (_e, s) => fn(s)),
});
