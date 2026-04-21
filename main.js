// main.js — AI Launcher (Foundry Local Phi + OpenAI) with working win:* IPC
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage
} = require("electron");

let win = null;
let tray = null;

/* -----------------------------
   Cache / Chromium permissions
------------------------------ */
const userCache = path.join(app.getPath("userData"), "Cache");
app.setPath("cache", userCache);
app.commandLine.appendSwitch("disk-cache-dir", userCache);
app.commandLine.appendSwitch("disable-gpu-cache");

// Combine disable-features (multiple calls can override)
const disableFeatures = [
  "CalculateNativeWinOcclusion",
  "AutofillEnableAccountWalletStorage",
  "AutofillServerCommunication"
].join(",");
app.commandLine.appendSwitch("disable-features", disableFeatures);

/* -----------------------------
   Settings (stored locally)
------------------------------ */
function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      return {
        provider: "ollama", // "ollama" | "foundry" | "openai"
        openai_api_key: "",
        local_prefer: "phi-3.5",
        foundry_prefer: "phi-3.5" // legacy compatibility
      };
    }
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return {
      provider: data.provider || "ollama",
      openai_api_key: data.openai_api_key || "",
      local_prefer: data.local_prefer || data.foundry_prefer || "phi-3.5",
      foundry_prefer: data.foundry_prefer || data.local_prefer || "phi-3.5"
    };
  } catch {
    return {
      provider: "ollama",
      openai_api_key: "",
      local_prefer: "phi-3.5",
      foundry_prefer: "phi-3.5"
    };
  }
}

function saveSettings(partial) {
  const current = loadSettings();
  const merged = { ...current, ...partial };
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

/* -----------------------------
   Window helpers
------------------------------ */
function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else {
    win.show();
    win.focus();
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 520,
    height: 640,
    x: Math.max(20, width - 560),
    y: Math.max(20, height - 700),
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile("index.html");

  // Renderer listeners expect win:shown + win:state
  win.on("show", () => {
    if (win?.webContents) win.webContents.send("win:shown");
  });

  win.on("maximize", () => {
    if (win?.webContents) win.webContents.send("win:state", { maximized: true });
  });

  win.on("unmaximize", () => {
    if (win?.webContents) win.webContents.send("win:state", { maximized: false });
  });

  // Hide on close (keep tray alive)
  win.on("close", (e) => {
    if (app.isQuiting) return;
    e.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    win = null;
  });
}

/* -----------------------------
   Tray
------------------------------ */
function createTray() {
  let icon = nativeImage.createEmpty();
  const iconPath = path.join(__dirname, "build", "icon.ico");
  if (fs.existsSync(iconPath)) icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip("AI Launcher");

  const menu = Menu.buildFromTemplate([
    { label: "Show / Hide", click: () => toggleWindow() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on("click", () => toggleWindow());
}

/* -----------------------------
   Global Shortcut
------------------------------ */
function registerShortcuts() {
  const primary = "Control+A+I";
  const fallback = "Control+Shift+I";

  const ok = globalShortcut.register(primary, toggleWindow);
  if (!ok) console.log("Shortcut failed:", primary);

  const ok2 = globalShortcut.register(fallback, toggleWindow);
  if (!ok2) console.log("Shortcut failed:", fallback);

  const active =
    (globalShortcut.isRegistered(primary) ? primary : "") ||
    (globalShortcut.isRegistered(fallback) ? fallback : "") ||
    "none";

  console.log("Shortcut active:", active);
}

/* -----------------------------
   Foundry Local helpers
------------------------------ */
async function runFoundry(args) {
  // Uses foundry.exe from PATH
  const { stdout } = await execFileAsync("foundry", args, { windowsHide: true });
  return String(stdout || "");
}

/* -----------------------------
   Ollama helpers
------------------------------ */
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";

async function ollamaListModels() {
  const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Ollama /api/tags failed: ${t || r.statusText}`);
  }

  return { base: OLLAMA_BASE_URL, json: await r.json() };
}

function pickOllamaModelId(modelsJson, prefer = "phi-3.5") {
  const arr = Array.isArray(modelsJson?.models) ? modelsJson.models : [];
  if (!arr.length) return "";

  const p = String(prefer || "").toLowerCase().trim();

  const exact = arr.find((m) => String(m?.name || "").toLowerCase() === p);
  if (exact?.name) return exact.name;

  const anyMatch = arr.find((m) => String(m?.name || "").toLowerCase().includes(p));
  if (anyMatch?.name) return anyMatch.name;

  const phi35 = arr.find((m) => /phi[- ]?3(\.5)?/i.test(String(m?.name || "")));
  if (phi35?.name) return phi35.name;

  const llama = arr.find((m) => /llama/i.test(String(m?.name || "")));
  if (llama?.name) return llama.name;

  return arr[0]?.name || "";
}

async function ollamaChat(messages) {
  const s = loadSettings();
  const prefer = s.local_prefer || s.foundry_prefer || "phi-3.5";

  const { json } = await ollamaListModels();
  const modelId = pickOllamaModelId(json, prefer);

  if (!modelId) throw new Error("No Ollama models found.");

  const payload = {
    model: modelId,
    messages,
    stream: false
  };

  const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Ollama chat failed: " + (t || r.statusText));
  }

  const data = await r.json();
  return data?.message?.content || "";
}

async function getFoundryV1Base() {
  // Example:
  // "🟢 Model management service is running on http://127.0.0.1:63171/openai/status"
  let out = "";
  try {
    out = await runFoundry(["service", "status"]);
  } catch {
    // Try to start once
    await runFoundry(["service", "start"]).catch(() => {});
    out = await runFoundry(["service", "status"]);
  }

  const m = out.match(/https?:\/\/127\.0\.0\.1:(\d+)/i);
  if (!m) throw new Error("Foundry service status did not include a localhost port.");
  const port = Number(m[1]);
  if (!port || port <= 0) throw new Error("Foundry returned invalid port (0).");

  // You verified /v1/models works:
  return `http://127.0.0.1:${port}/v1`;
}

async function foundryListModels() {
  const base = await getFoundryV1Base();
  const r = await fetch(`${base}/models`);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Foundry /v1/models failed: ${t}`);
  }
  return { base, json: await r.json() };
}

function pickFoundryModelId(modelsJson, prefer = "phi-3.5") {
  const arr = Array.isArray(modelsJson?.data) ? modelsJson.data : [];
  if (!arr.length) return "";

  const p = String(prefer || "").toLowerCase().trim();

  // If prefer matches an exact id, use it
  const exact = arr.find((m) => String(m?.id || "").toLowerCase() === p);
  if (exact?.id) return exact.id;

  // Prefer OpenVINO GPU variant if it matches
  const gpuPreferred = arr.find(
    (m) =>
      String(m?.id || "").toLowerCase().includes("openvino") &&
      String(m?.id || "").toLowerCase().includes(p)
  );
  if (gpuPreferred?.id) return gpuPreferred.id;

  // Any contains match
  const anyMatch = arr.find((m) => String(m?.id || "").toLowerCase().includes(p));
  if (anyMatch?.id) return anyMatch.id;

  // Fallback preferences
  const phi35 = arr.find((m) => /phi[- ]?3\.5/i.test(String(m?.id || "")));
  if (phi35?.id) return phi35.id;

  const phi4 = arr.find((m) => /phi[- ]?4/i.test(String(m?.id || "")));
  if (phi4?.id) return phi4.id;

  return arr[0]?.id || "";
}

async function foundryChat(messages) {
  const s = loadSettings();
  const prefer = s.local_prefer || s.foundry_prefer || "phi-3.5";

  const { base, json } = await foundryListModels();
  const modelId = pickFoundryModelId(json, prefer);

  if (!modelId) throw new Error("No Foundry models found.");

  const payload = {
    model: modelId, // MUST be exact id from /v1/models
    messages,
    stream: false
  };

  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Foundry Local chat failed: " + t);
  }

  const data = await r.json();
  return data?.choices?.[0]?.message?.content || "";
}

/* -----------------------------
   OpenAI helper
------------------------------ */
async function openaiChat(apiKey, messages) {
  const payload = { model: "gpt-4o-mini", messages };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("OpenAI request failed: " + t);
  }

  const data = await r.json();
  return data?.choices?.[0]?.message?.content || "";
}

/* -----------------------------
   IPC wiring (MUST match preload.js)
------------------------------ */
function wireIPC() {
  // ---- Window controls (your buttons call these) ----
  ipcMain.handle("win:hide", () => {
    if (win) win.hide();
    return true;
  });

  ipcMain.handle("win:minimize", () => {
    if (win) win.minimize();
    return true;
  });

  ipcMain.handle("win:toggleMaximize", () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return true;
  });

  ipcMain.handle("win:isMaximized", () => {
    if (!win) return false;
    return win.isMaximized();
  });

  ipcMain.handle("win:getBounds", () => {
    if (!win) return null;
    return win.getBounds();
  });

  ipcMain.handle("win:setBounds", (evt, b) => {
    if (!win) return false;
    if (!b || typeof b !== "object") return false;

    // only set allowed keys
    const next = {};
    for (const k of ["x", "y", "width", "height"]) {
      if (typeof b[k] === "number" && Number.isFinite(b[k])) next[k] = b[k];
    }
    if (!Object.keys(next).length) return false;

    win.setBounds(next, true);
    return true;
  });

  // ---- Settings (optional: only if your renderer uses them) ----
  ipcMain.handle("settings:get", () => {
    const s = loadSettings();
    return {
      provider: s.provider || "ollama",
      openaiKeySet: !!(s.openai_api_key && s.openai_api_key.trim().length > 0),
      foundryPrefer: s.local_prefer || s.foundry_prefer || "phi-3.5"
    };
  });

  ipcMain.handle("settings:setProvider", (evt, provider) => {
    const p = String(provider || "").trim();
    if (!["ollama", "foundry", "openai"].includes(p)) {
      return { ok: false, error: "Invalid provider" };
    }
    saveSettings({ provider: p });
    return { ok: true };
  });

  ipcMain.handle("settings:setOpenAIKey", (evt, key) => {
    const k = String(key || "").trim();
    if (!k) return { ok: false, error: "Empty key" };
    saveSettings({ openai_api_key: k });
    return { ok: true };
  });

  ipcMain.handle("settings:setFoundryPrefer", (evt, prefer) => {
    const v = String(prefer || "").trim();
    if (!v) return { ok: false, error: "Empty prefer" };
    saveSettings({ foundry_prefer: v, local_prefer: v });
    return { ok: true };
  });

  // ---- AI endpoints (your preload calls ai:ask and ai:health) ----
  ipcMain.handle("ai:health", async () => {
    const s = loadSettings();

    if (s.provider === "openai") {
      const hasKey = !!(s.openai_api_key && s.openai_api_key.trim().length > 0);
      return {
        provider: "openai",
        ok: hasKey,
        model: "gpt-4o-mini"
      };
    }

    if (s.provider === "ollama") {
      try {
        const { base, json } = await ollamaListModels();
        const picked = pickOllamaModelId(json, s.local_prefer || s.foundry_prefer || "phi-3.5");
        return {
          provider: "ollama",
          ok: true,
          baseUrl: base,
          model: picked
        };
      } catch (e) {
        return {
          provider: "ollama",
          ok: false,
          model: "",
          error: e?.message || String(e)
        };
      }
    }

    // Foundry
    try {
      const { base, json } = await foundryListModels();
      const picked = pickFoundryModelId(json, s.local_prefer || s.foundry_prefer || "phi-3.5");
      return {
        provider: "foundry",
        ok: true,
        baseUrl: base,
        model: picked
      };
    } catch (e) {
      return {
        provider: "foundry",
        ok: false,
        model: "",
        error: e?.message || String(e)
      };
    }
  });

  ipcMain.handle("ai:ask", async (evt, messages) => {
    const s = loadSettings();
    const safeMessages = Array.isArray(messages) ? messages : [];

    if (s.provider === "openai") {
      const key = (s.openai_api_key || "").trim();
      if (!key) throw new Error("OpenAI key not set");
      return await openaiChat(key, safeMessages);
    }

    if (s.provider === "ollama") {
      return await ollamaChat(safeMessages);
    }

    return await foundryChat(safeMessages);
  });
}

/* -----------------------------
   App lifecycle
------------------------------ */
app.whenReady().then(() => {
  createWindow();
  createTray();
  wireIPC();
  registerShortcuts();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Keep running in background with tray even if all windows are closed/hidden
app.on("window-all-closed", () => {
  // do nothing (tray keeps app alive)
});
