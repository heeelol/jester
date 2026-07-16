// electron/preload.cjs — the safe bridge between the web UI (renderer) and the
// native shell (main). The renderer feature-detects `window.jester`: present in
// the desktop app, absent in a plain browser (where it degrades gracefully).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jester", {
  isElectron: true,
  enterMainframe: () => ipcRenderer.invoke("mainframe:set", true),
  exitMainframe: () => ipcRenderer.invoke("mainframe:set", false),
  launchApp: (name) => ipcRenderer.invoke("os:launch", name),
  closeApp: (name) => ipcRenderer.invoke("os:close", name),
  hideApp: (name) => ipcRenderer.invoke("os:hideApp", name),
  webSearch: (query, engine) => ipcRenderer.invoke("os:search", query, engine),
  openInBrowser: (url) => ipcRenderer.invoke("os:open", url),
  media: (action) => ipcRenderer.invoke("os:media", action),
  systemCommand: (command, arg) => ipcRenderer.invoke("os:command", command, arg),
  onVoiceListen: (cb) => ipcRenderer.on("voice:listen", () => cb()),
  onEnterMainframe: (cb) => ipcRenderer.on("mainframe:enter", () => cb()),
  onExitMainframe: (cb) => ipcRenderer.on("mainframe:exit", () => cb()),
});
