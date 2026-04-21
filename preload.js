const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  ask: (history) => ipcRenderer.invoke("ai:ask", history),
  health: () => ipcRenderer.invoke("ai:health"),

  hide: () => ipcRenderer.invoke("win:hide"),
  minimize: () => ipcRenderer.invoke("win:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("win:toggleMaximize"),
  isMaximized: () => ipcRenderer.invoke("win:isMaximized"),

  getBounds: () => ipcRenderer.invoke("win:getBounds"),
  setBounds: (bounds) => ipcRenderer.invoke("win:setBounds", bounds),

  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsSetProvider: (provider) => ipcRenderer.invoke("settings:setProvider", provider),
  settingsSetApiKey: (key) => ipcRenderer.invoke("settings:setApiKey", key),
  settingsSetOpenAIKey: (key) => ipcRenderer.invoke("settings:setApiKey", key),
  settingsSetFoundryPrefer: (value) => ipcRenderer.invoke("settings:setFoundryPrefer", value),

  onShown: (callback) => ipcRenderer.on("win:shown", () => callback && callback()),
  onState: (callback) => ipcRenderer.on("win:state", (event, data) => callback && callback(data))
});
