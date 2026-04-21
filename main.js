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

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const ANTHROPIC_VERSION = "2023-06-01";

const LOCAL_PROVIDER_IDS = new Set(["local-auto", "ollama", "foundry"]);

const PROVIDER_LABELS = {
  "local-auto": "Local (Auto)",
  ollama: "Local (Ollama)",
  foundry: "Local (Foundry Local)",
  "auto-api": "API Key (Auto Detect)",
  openai: "OpenAI",
  anthropic: "Claude (Anthropic)",
  xai: "Grok (xAI)",
  deepseek: "DeepSeek"
};

const CLOUD_PROVIDERS = {
  openai: {
    label: PROVIDER_LABELS.openai,
    modelPatterns: [/gpt-4o-mini/i, /gpt-4\.1-mini/i, /gpt-4\.1/i, /gpt/i],
    async listModels(apiKey) {
      const json = await requestJson("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }, "OpenAI models request failed");

      return {
        models: Array.isArray(json?.data) ? json.data : [],
        picked: pickModelFromObjects(json?.data, "id", this.modelPatterns)
      };
    },
    async chat(apiKey, messages, model) {
      const payload = {
        model: model || "gpt-4o-mini",
        messages,
        stream: false
      };

      const json = await requestJson("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      }, "OpenAI request failed");

      return json?.choices?.[0]?.message?.content || "";
    }
  },
  anthropic: {
    label: PROVIDER_LABELS.anthropic,
    modelPatterns: [/claude-sonnet/i, /claude-3-7-sonnet/i, /claude/i],
    async listModels(apiKey) {
      const json = await requestJson("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        }
      }, "Anthropic models request failed");

      return {
        models: Array.isArray(json?.data) ? json.data : [],
        picked: pickModelFromObjects(json?.data, "id", this.modelPatterns)
      };
    },
    async chat(apiKey, messages, model) {
      const prepared = prepareAnthropicMessages(messages);
      const payload = {
        model: model || "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: prepared.messages
      };

      if (prepared.system) payload.system = prepared.system;

      const json = await requestJson("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify(payload)
      }, "Anthropic request failed");

      const blocks = Array.isArray(json?.content) ? json.content : [];
      return blocks
        .filter((block) => block?.type === "text")
        .map((block) => block?.text || "")
        .join("\n")
        .trim();
    }
  },
  xai: {
    label: PROVIDER_LABELS.xai,
    modelPatterns: [/grok/i],
    async listModels(apiKey) {
      const json = await requestJson("https://api.x.ai/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }, "xAI models request failed");

      return {
        models: Array.isArray(json?.data) ? json.data : [],
        picked: pickModelFromObjects(json?.data, "id", this.modelPatterns)
      };
    },
    async chat(apiKey, messages, model) {
      const payload = {
        model: model || "grok-4-fast-reasoning",
        messages,
        stream: false
      };

      const json = await requestJson("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      }, "xAI request failed");

      return json?.choices?.[0]?.message?.content || "";
    }
  },
  deepseek: {
    label: PROVIDER_LABELS.deepseek,
    modelPatterns: [/deepseek-chat/i, /deepseek-reasoner/i, /deepseek/i],
    async listModels(apiKey) {
      const json = await requestJson("https://api.deepseek.com/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }, "DeepSeek models request failed");

      return {
        models: Array.isArray(json?.data) ? json.data : [],
        picked: pickModelFromObjects(json?.data, "id", this.modelPatterns)
      };
    },
    async chat(apiKey, messages, model) {
      const payload = {
        model: model || "deepseek-chat",
        messages,
        stream: false
      };

      const json = await requestJson("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      }, "DeepSeek request failed");

      return json?.choices?.[0]?.message?.content || "";
    }
  }
};

let win = null;
let tray = null;

const userCache = path.join(app.getPath("userData"), "Cache");
app.setPath("cache", userCache);
app.commandLine.appendSwitch("disk-cache-dir", userCache);
app.commandLine.appendSwitch("disable-gpu-cache");
app.commandLine.appendSwitch("disable-features", [
  "CalculateNativeWinOcclusion",
  "AutofillEnableAccountWalletStorage",
  "AutofillServerCommunication"
].join(","));

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      return defaultSettings();
    }

    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);

    return {
      provider: data.provider || "local-auto",
      api_key: data.api_key || data.openai_api_key || "",
      detected_api_provider: data.detected_api_provider || "",
      cloud_model: data.cloud_model || "",
      local_prefer: data.local_prefer || data.foundry_prefer || "phi-3.5",
      foundry_prefer: data.foundry_prefer || data.local_prefer || "phi-3.5",
      openai_api_key: data.openai_api_key || "",
      last_api_detection_error: data.last_api_detection_error || ""
    };
  } catch {
    return defaultSettings();
  }
}

function defaultSettings() {
  return {
    provider: "local-auto",
    api_key: "",
    detected_api_provider: "",
    cloud_model: "",
    local_prefer: "phi-3.5",
    foundry_prefer: "phi-3.5",
    openai_api_key: "",
    last_api_detection_error: ""
  };
}

function saveSettings(partial) {
  const current = loadSettings();
  const merged = { ...current, ...partial };
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || "Unknown";
}

function normalizeMessages(messages) {
  const safe = Array.isArray(messages) ? messages : [];

  return safe
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user",
      content: String(message?.content || "").trim()
    }))
    .filter((message) => message.content.length > 0);
}

function prepareAnthropicMessages(messages) {
  const normalized = normalizeMessages(messages);
  const systemParts = [];
  const conversation = [];

  for (const message of normalized) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }

    conversation.push({
      role: message.role,
      content: [
        {
          type: "text",
          text: message.content
        }
      ]
    });
  }

  if (!conversation.length) {
    conversation.push({
      role: "user",
      content: [{ type: "text", text: "Hello" }]
    });
  }

  return {
    system: systemParts.join("\n\n").trim(),
    messages: conversation
  };
}

async function requestJson(url, options = {}, errorLabel = "Request failed") {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const details = text || response.statusText || `HTTP ${response.status}`;
    throw new Error(`${errorLabel}: ${details}`);
  }

  return await response.json();
}

function pickModelFromObjects(list, key, preferredPatterns) {
  const items = Array.isArray(list) ? list : [];
  const values = items
    .map((item) => String(item?.[key] || "").trim())
    .filter(Boolean);

  return pickModelFromNames(values, preferredPatterns);
}

function pickModelFromNames(names, preferredPatterns = []) {
  const items = Array.isArray(names) ? names : [];
  if (!items.length) return "";

  for (const pattern of preferredPatterns) {
    const match = items.find((name) => pattern.test(name));
    if (match) return match;
  }

  return items[0];
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 540,
    height: 690,
    x: Math.max(20, width - 580),
    y: Math.max(20, height - 740),
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

  win.on("show", () => {
    if (win?.webContents) win.webContents.send("win:shown");
  });

  win.on("maximize", () => {
    if (win?.webContents) win.webContents.send("win:state", { maximized: true });
  });

  win.on("unmaximize", () => {
    if (win?.webContents) win.webContents.send("win:state", { maximized: false });
  });

  win.on("close", (event) => {
    if (app.isQuiting) return;
    event.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    win = null;
  });
}

function toggleWindow() {
  if (!win) return;

  if (win.isVisible()) {
    win.hide();
    return;
  }

  win.show();
  win.focus();
}

function createTray() {
  let icon = nativeImage.createEmpty();
  const iconPath = path.join(__dirname, "build", "icon.ico");

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  }

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

function registerShortcuts() {
  const shortcuts = ["Control+Alt+I", "Control+Shift+I"];
  let active = "none";

  for (const accelerator of shortcuts) {
    const ok = globalShortcut.register(accelerator, toggleWindow);
    if (ok) {
      active = accelerator;
      break;
    }

    console.log("Shortcut failed:", accelerator);
  }

  console.log("Shortcut active:", active);
}

async function ollamaListModels() {
  const json = await requestJson(`${OLLAMA_BASE_URL}/api/tags`, {}, "Ollama models request failed");
  return { base: OLLAMA_BASE_URL, json };
}

function pickOllamaModelId(modelsJson, prefer = "phi-3.5") {
  const names = (Array.isArray(modelsJson?.models) ? modelsJson.models : [])
    .map((model) => String(model?.name || "").trim())
    .filter(Boolean);

  const normalizedPrefer = String(prefer || "").toLowerCase().trim();
  const exact = names.find((name) => name.toLowerCase() === normalizedPrefer);
  if (exact) return exact;

  const partial = names.find((name) => name.toLowerCase().includes(normalizedPrefer));
  if (partial) return partial;

  return pickModelFromNames(names, [/phi/i, /llama/i, /mistral/i, /.*/]);
}

async function ollamaChat(messages) {
  const settings = loadSettings();
  const { json } = await ollamaListModels();
  const model = pickOllamaModelId(json, settings.local_prefer || settings.foundry_prefer);

  if (!model) throw new Error("No Ollama models found.");

  const jsonReply = await requestJson(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  }, "Ollama chat failed");

  return {
    model,
    text: jsonReply?.message?.content || ""
  };
}

async function runFoundry(args) {
  try {
    const { stdout, stderr } = await execFileAsync("foundry", args, { windowsHide: true });
    return String(stdout || stderr || "").trim();
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Foundry Local CLI was not found. Install Microsoft Foundry Local or switch to Local (Ollama).");
    }

    const details = String(error?.stdout || error?.stderr || error?.message || "").trim();
    throw new Error(details || "Foundry Local command failed.");
  }
}

async function getFoundryV1Base() {
  let status = "";

  try {
    status = await runFoundry(["service", "status"]);
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.toLowerCase().includes("not found")) {
      await runFoundry(["service", "start"]).catch(() => {});
      status = await runFoundry(["service", "status"]);
    } else {
      throw error;
    }
  }

  if (/not running/i.test(status)) {
    await runFoundry(["service", "start"]).catch(() => {});
    status = await runFoundry(["service", "status"]);
  }

  if (/not running/i.test(status)) {
    throw new Error("Foundry Local service is not running. Start it with `foundry service start` or use Local (Ollama).");
  }

  const match = status.match(/https?:\/\/127\.0\.0\.1:(\d+)/i);
  if (!match) {
    throw new Error("Foundry Local did not report a localhost service URL.");
  }

  const port = Number(match[1]);
  if (!port || port <= 0) {
    throw new Error("Foundry Local returned an invalid port.");
  }

  return `http://127.0.0.1:${port}/v1`;
}

async function foundryListModels() {
  const base = await getFoundryV1Base();
  const json = await requestJson(`${base}/models`, {}, "Foundry Local models request failed");
  return { base, json };
}

function pickFoundryModelId(modelsJson, prefer = "phi-3.5") {
  const names = (Array.isArray(modelsJson?.data) ? modelsJson.data : [])
    .map((model) => String(model?.id || "").trim())
    .filter(Boolean);

  const normalizedPrefer = String(prefer || "").toLowerCase().trim();
  const exact = names.find((name) => name.toLowerCase() === normalizedPrefer);
  if (exact) return exact;

  const partial = names.find((name) => name.toLowerCase().includes(normalizedPrefer));
  if (partial) return partial;

  return pickModelFromNames(names, [/phi[- ]?3(\.5)?/i, /phi[- ]?4/i, /phi/i, /.*/]);
}

async function foundryChat(messages) {
  const settings = loadSettings();
  const { base, json } = await foundryListModels();
  const model = pickFoundryModelId(json, settings.local_prefer || settings.foundry_prefer);

  if (!model) throw new Error("No Foundry Local models found.");

  const jsonReply = await requestJson(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  }, "Foundry Local chat failed");

  return {
    model,
    text: jsonReply?.choices?.[0]?.message?.content || ""
  };
}

async function localAutoHealth() {
  try {
    const { json } = await ollamaListModels();
    return {
      provider: "ollama",
      mode: "local-auto",
      ok: true,
      label: "Local (Auto -> Ollama)",
      model: pickOllamaModelId(json, loadSettings().local_prefer),
      error: ""
    };
  } catch (ollamaError) {
    try {
      const { json } = await foundryListModels();
      return {
        provider: "foundry",
        mode: "local-auto",
        ok: true,
        label: "Local (Auto -> Foundry Local)",
        model: pickFoundryModelId(json, loadSettings().local_prefer),
        error: ""
      };
    } catch (foundryError) {
      return {
        provider: "local-auto",
        mode: "local-auto",
        ok: false,
        label: providerLabel("local-auto"),
        model: "",
        error: `Ollama: ${ollamaError.message} | Foundry Local: ${foundryError.message}`
      };
    }
  }
}

async function localAutoChat(messages) {
  try {
    const reply = await ollamaChat(messages);
    return {
      provider: "ollama",
      mode: "local-auto",
      label: "Local (Auto -> Ollama)",
      ...reply
    };
  } catch (ollamaError) {
    try {
      const reply = await foundryChat(messages);
      return {
        provider: "foundry",
        mode: "local-auto",
        label: "Local (Auto -> Foundry Local)",
        ...reply
      };
    } catch (foundryError) {
      throw new Error(`No local provider is available. Ollama: ${ollamaError.message} | Foundry Local: ${foundryError.message}`);
    }
  }
}

function getCloudProviderHint(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return [];

  const hints = [];

  if (/^sk-ant-/i.test(key)) hints.push("anthropic");
  if (/^xai-/i.test(key)) hints.push("xai");
  if (/^sk-proj-/i.test(key) || /^sk-svcacct-/i.test(key)) hints.push("openai");

  return hints;
}

async function detectCloudProvider(apiKey) {
  const preferred = getCloudProviderHint(apiKey);
  const order = [...new Set([...preferred, "openai", "anthropic", "xai", "deepseek"])];

  let lastError = null;

  for (const provider of order) {
    try {
      const info = await CLOUD_PROVIDERS[provider].listModels(apiKey);
      return {
        provider,
        model: info?.picked || "",
        label: CLOUD_PROVIDERS[provider].label
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Could not detect the provider for this API key.");
}

function resolveCloudProvider(settings) {
  if (LOCAL_PROVIDER_IDS.has(settings.provider)) return "";

  if (CLOUD_PROVIDERS[settings.provider]) return settings.provider;
  if (settings.provider === "auto-api" && CLOUD_PROVIDERS[settings.detected_api_provider]) {
    return settings.detected_api_provider;
  }

  if (CLOUD_PROVIDERS[settings.detected_api_provider]) {
    return settings.detected_api_provider;
  }

  return "";
}

async function cloudChat(provider, apiKey, messages, savedModel) {
  const config = CLOUD_PROVIDERS[provider];
  if (!config) throw new Error("Unsupported cloud provider.");

  let model = savedModel || "";

  if (!model) {
    const info = await config.listModels(apiKey);
    model = info?.picked || "";

    if (model) {
      saveSettings({
        detected_api_provider: provider,
        cloud_model: model,
        last_api_detection_error: ""
      });
    }
  }

  const text = await config.chat(apiKey, messages, model);

  return {
    provider,
    mode: "cloud",
    label: config.label,
    model,
    text
  };
}

async function getHealthStatus() {
  const settings = loadSettings();

  if (settings.provider === "local-auto") {
    return await localAutoHealth();
  }

  if (settings.provider === "ollama") {
    try {
      const { json } = await ollamaListModels();
      return {
        provider: "ollama",
        mode: "ollama",
        ok: true,
        label: providerLabel("ollama"),
        model: pickOllamaModelId(json, settings.local_prefer),
        error: ""
      };
    } catch (error) {
      return {
        provider: "ollama",
        mode: "ollama",
        ok: false,
        label: providerLabel("ollama"),
        model: "",
        error: error.message
      };
    }
  }

  if (settings.provider === "foundry") {
    try {
      const { json } = await foundryListModels();
      return {
        provider: "foundry",
        mode: "foundry",
        ok: true,
        label: providerLabel("foundry"),
        model: pickFoundryModelId(json, settings.local_prefer),
        error: ""
      };
    } catch (error) {
      return {
        provider: "foundry",
        mode: "foundry",
        ok: false,
        label: providerLabel("foundry"),
        model: "",
        error: error.message
      };
    }
  }

  const apiKey = String(settings.api_key || "").trim();
  const resolvedProvider = resolveCloudProvider(settings);

  if (!apiKey) {
    return {
      provider: resolvedProvider || settings.provider || "auto-api",
      mode: settings.provider,
      ok: false,
      label: providerLabel(settings.provider === "auto-api" ? "auto-api" : resolvedProvider || settings.provider),
      model: "",
      error: "API key not set."
    };
  }

  if (!resolvedProvider) {
    return {
      provider: settings.provider || "auto-api",
      mode: settings.provider,
      ok: false,
      label: providerLabel(settings.provider || "auto-api"),
      model: "",
      error: settings.last_api_detection_error || "API key provider has not been detected yet."
    };
  }

  return {
    provider: resolvedProvider,
    mode: settings.provider,
    ok: true,
    label: settings.provider === "auto-api"
      ? `API Key (${providerLabel(resolvedProvider)})`
      : providerLabel(resolvedProvider),
    model: settings.cloud_model || "",
    error: ""
  };
}

async function saveApiKeyWithDetection(key) {
  const value = String(key || "").trim();
  if (!value) return { ok: false, error: "Empty key" };

  try {
    const detected = await detectCloudProvider(value);
    const current = loadSettings();
    const nextProvider = LOCAL_PROVIDER_IDS.has(current.provider)
      ? current.provider
      : (current.provider === "auto-api" ? "auto-api" : detected.provider);

    saveSettings({
      api_key: value,
      openai_api_key: detected.provider === "openai" ? value : "",
      detected_api_provider: detected.provider,
      cloud_model: detected.model || "",
      provider: nextProvider,
      last_api_detection_error: ""
    });

    return {
      ok: true,
      detectedProvider: detected.provider,
      detectedProviderLabel: detected.label,
      model: detected.model || ""
    };
  } catch (error) {
    saveSettings({
      api_key: value,
      openai_api_key: "",
      detected_api_provider: "",
      cloud_model: "",
      last_api_detection_error: error.message || String(error)
    });

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

function wireIPC() {
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

  ipcMain.handle("win:setBounds", (event, bounds) => {
    if (!win || !bounds || typeof bounds !== "object") return false;

    const next = {};
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof bounds[key] === "number" && Number.isFinite(bounds[key])) {
        next[key] = bounds[key];
      }
    }

    if (!Object.keys(next).length) return false;

    win.setBounds(next, true);
    return true;
  });

  ipcMain.handle("settings:get", () => {
    const settings = loadSettings();
    return {
      provider: settings.provider || "local-auto",
      apiKeySet: !!String(settings.api_key || "").trim(),
      detectedProvider: settings.detected_api_provider || "",
      detectedProviderLabel: providerLabel(settings.detected_api_provider),
      cloudModel: settings.cloud_model || "",
      foundryPrefer: settings.local_prefer || settings.foundry_prefer || "phi-3.5"
    };
  });

  ipcMain.handle("settings:setProvider", (event, provider) => {
    const value = String(provider || "").trim();
    const valid = [
      "local-auto",
      "ollama",
      "foundry",
      "auto-api",
      "openai",
      "anthropic",
      "xai",
      "deepseek"
    ];

    if (!valid.includes(value)) {
      return { ok: false, error: "Invalid provider" };
    }

    saveSettings({ provider: value });
    return { ok: true };
  });

  ipcMain.handle("settings:setApiKey", async (event, key) => {
    return await saveApiKeyWithDetection(key);
  });

  ipcMain.handle("settings:setOpenAIKey", async (event, key) => {
    return await saveApiKeyWithDetection(key);
  });

  ipcMain.handle("settings:setFoundryPrefer", (event, prefer) => {
    const value = String(prefer || "").trim();
    if (!value) return { ok: false, error: "Empty prefer" };

    saveSettings({
      local_prefer: value,
      foundry_prefer: value
    });

    return { ok: true };
  });

  ipcMain.handle("ai:health", async () => {
    return await getHealthStatus();
  });

  ipcMain.handle("ai:ask", async (event, messages) => {
    const safeMessages = normalizeMessages(messages);
    const settings = loadSettings();

    if (settings.provider === "local-auto") {
      const reply = await localAutoChat(safeMessages);
      return reply.text;
    }

    if (settings.provider === "ollama") {
      const reply = await ollamaChat(safeMessages);
      return reply.text;
    }

    if (settings.provider === "foundry") {
      const reply = await foundryChat(safeMessages);
      return reply.text;
    }

    const apiKey = String(settings.api_key || "").trim();
    if (!apiKey) throw new Error("API key not set.");

    const cloudProvider = resolveCloudProvider(settings);
    if (!cloudProvider) {
      throw new Error(settings.last_api_detection_error || "Could not determine which cloud provider to use for this key.");
    }

    const reply = await cloudChat(cloudProvider, apiKey, safeMessages, settings.cloud_model);
    return reply.text;
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  wireIPC();
  registerShortcuts();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep the tray app alive.
});
