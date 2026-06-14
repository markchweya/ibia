const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  screen,
  shell,
  Tray,
  Menu,
  nativeImage
} = require("electron");

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_UPLOAD_CHARS = 24000;
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 240;
const EXTRACTION_TIMEOUT_MS = 60000;
const LOCAL_SPEED_MODES = new Set(["fast", "balanced", "deep"]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".c", ".cc", ".conf", ".cpp", ".cs", ".css", ".csv", ".env", ".gitignore",
  ".go", ".html", ".htm", ".ini", ".java", ".js", ".json", ".jsx", ".log",
  ".md", ".mjs", ".ps1", ".psd1", ".psm1", ".php", ".py", ".rb", ".rs", ".sh",
  ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
  ".bat", ".cmd", ".tsx", ".vue"
]);

const LOCAL_PROVIDER_IDS = new Set(["local-auto", "ollama", "foundry"]);
const WINDOWS_APP_ID = "com.markchweya.ibia";
const APP_ICON_PATH = path.join(__dirname, "build", "icon.ico");
const SECRET_ENCODING_PREFIX = "safeStorage:v1:";

if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_APP_ID);
}

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

const gotSingleInstanceLock = app.requestSingleInstanceLock();
const userCache = path.join(app.getPath("userData"), "Cache");
fs.mkdirSync(userCache, { recursive: true });
app.setPath("cache", userCache);
app.commandLine.appendSwitch("disk-cache-dir", userCache);
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-gpu-cache");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-features", [
  "CalculateNativeWinOcclusion",
  "AutofillEnableAccountWalletStorage",
  "AutofillServerCommunication"
].join(","));

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function historyPath() {
  return path.join(app.getPath("userData"), "chat-history.json");
}

function libraryPath() {
  return path.join(app.getPath("userData"), "document-library.json");
}

function encryptSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is not available on this device.");
  }

  return `${SECRET_ENCODING_PREFIX}${safeStorage.encryptString(text).toString("base64")}`;
}

function decryptSecret(value) {
  const text = String(value || "");
  if (!text.startsWith(SECRET_ENCODING_PREFIX)) return "";

  if (!safeStorage.isEncryptionAvailable()) {
    return "";
  }

  try {
    const payload = text.slice(SECRET_ENCODING_PREFIX.length);
    return safeStorage.decryptString(Buffer.from(payload, "base64"));
  } catch {
    return "";
  }
}

function readStoredApiKey(data = {}) {
  return decryptSecret(data.api_key_encrypted)
    || decryptSecret(data.openai_api_key_encrypted)
    || String(data.api_key || data.openai_api_key || "").trim();
}

function extractorScriptPath() {
  return path.join(__dirname, "scripts", "extract_assets.py");
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
      api_key: readStoredApiKey(data),
      detected_api_provider: data.detected_api_provider || "",
      cloud_model: data.cloud_model || "",
      display_name: data.display_name || "",
      local_speed_mode: LOCAL_SPEED_MODES.has(data.local_speed_mode) ? data.local_speed_mode : "fast",
      local_prefer: data.local_prefer || data.foundry_prefer || "phi-3.5",
      foundry_prefer: data.foundry_prefer || data.local_prefer || "phi-3.5",
      openai_api_key: "",
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
    display_name: "",
    local_speed_mode: "fast",
    local_prefer: "phi-3.5",
    foundry_prefer: "phi-3.5",
    openai_api_key: "",
    last_api_detection_error: ""
  };
}

function saveSettings(partial) {
  const current = loadSettings();
  const merged = { ...current, ...partial };

  const apiKey = String(merged.api_key || merged.openai_api_key || "").trim();
  const data = {
    provider: merged.provider || "local-auto",
    api_key_encrypted: apiKey ? encryptSecret(apiKey) : "",
    detected_api_provider: merged.detected_api_provider || "",
    cloud_model: merged.cloud_model || "",
    display_name: merged.display_name || "",
    local_speed_mode: LOCAL_SPEED_MODES.has(merged.local_speed_mode) ? merged.local_speed_mode : "fast",
    local_prefer: merged.local_prefer || merged.foundry_prefer || "phi-3.5",
    foundry_prefer: merged.foundry_prefer || merged.local_prefer || "phi-3.5",
    last_api_detection_error: merged.last_api_detection_error || ""
  };

  fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2), "utf-8");
  return merged;
}

function loadConversationStore() {
  try {
    const p = historyPath();
    if (!fs.existsSync(p)) {
      return { conversations: [] };
    }

    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return {
      conversations: Array.isArray(data?.conversations) ? data.conversations : []
    };
  } catch {
    return { conversations: [] };
  }
}

function saveConversationStore(store) {
  fs.writeFileSync(historyPath(), JSON.stringify(store, null, 2), "utf-8");
  return store;
}

function loadLibraryStore() {
  try {
    const p = libraryPath();
    if (!fs.existsSync(p)) {
      return { documents: [] };
    }

    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return {
      documents: Array.isArray(data?.documents) ? data.documents : []
    };
  } catch {
    return { documents: [] };
  }
}

function saveLibraryStore(store) {
  fs.writeFileSync(libraryPath(), JSON.stringify(store, null, 2), "utf-8");
  return store;
}

function resolvePythonExecutable() {
  const bundled = path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe"
  );

  if (fs.existsSync(bundled)) return bundled;
  return "python";
}

function createConversationId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDocumentId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeConversation(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const uploadedFiles = Array.isArray(conversation?.uploadedFiles) ? conversation.uploadedFiles : [];
  const lastContent = [...messages]
    .reverse()
    .find((message) => message?.role !== "system" && String(message?.content || "").trim())
    ?.content || "";

  return {
    id: conversation.id,
    title: conversation.title || "Untitled chat",
    updatedAt: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
    createdAt: conversation.createdAt || conversation.updatedAt || new Date().toISOString(),
    messageCount: messages.filter((message) => message?.role !== "system").length,
    fileCount: uploadedFiles.length,
    preview: String(lastContent).slice(0, 140)
  };
}

function summarizeDocument(document) {
  return {
    id: document.id,
    name: document.name,
    path: document.path,
    size: document.size,
    charCount: document.charCount,
    chunkCount: Array.isArray(document.chunks) ? document.chunks.length : 0,
    importedAt: document.importedAt || document.updatedAt || new Date().toISOString()
  };
}

function sanitizeConversationPayload(payload = {}) {
  const now = new Date().toISOString();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const uploadedFiles = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];

  return {
    id: String(payload.id || createConversationId()),
    title: String(payload.title || "Untitled chat").trim() || "Untitled chat",
    createdAt: payload.createdAt || now,
    updatedAt: now,
    messages: messages.map((message) => ({
      role: message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user",
      content: String(message?.content || "")
    })),
    uploadedFiles: uploadedFiles.map((file) => ({
      name: String(file?.name || ""),
      path: String(file?.path || ""),
      size: Number(file?.size || 0),
      mimeType: String(file?.mimeType || ""),
      mediaKind: String(file?.mediaKind || "text"),
      content: String(file?.content || ""),
      chunks: Array.isArray(file?.chunks) ? file.chunks.map((chunk) => String(chunk || "")) : [],
      imageBase64: file?.imageBase64 ? String(file.imageBase64) : "",
      videoFramesBase64: Array.isArray(file?.videoFramesBase64) ? file.videoFramesBase64.map((frame) => String(frame || "")) : [],
      width: Number(file?.width || 0),
      height: Number(file?.height || 0),
      duration: Number(file?.duration || 0),
      truncated: !!file?.truncated,
      charCount: Number(file?.charCount || String(file?.content || "").length)
    })),
    lastAssistantReply: String(payload.lastAssistantReply || "")
  };
}

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const source = String(text || "");
  if (!source) return [];

  const chunks = [];
  let start = 0;

  while (start < source.length) {
    const end = Math.min(source.length, start + chunkSize);
    chunks.push(source.slice(start, end));
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function tokenizeSearchText(text) {
  return [...new Set(
    String(text || "")
      .toLowerCase()
      .match(/[a-z0-9_./-]{2,}/g) || []
  )];
}

function scoreTextAgainstTokens(text, tokens) {
  if (!tokens.length) return 0;
  const haystack = String(text || "").toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    score += 2;
    if (haystack.startsWith(token)) score += 1;
  }

  return score;
}

function getLocalSpeedMode(settings = loadSettings()) {
  const mode = String(settings?.local_speed_mode || "").trim().toLowerCase();
  return LOCAL_SPEED_MODES.has(mode) ? mode : "fast";
}

function getOllamaRuntimeOptions(speedMode) {
  if (speedMode === "deep") {
    return {
      num_ctx: 8192,
      num_predict: 900
    };
  }

  if (speedMode === "balanced") {
    return {
      num_ctx: 6144,
      num_predict: 650
    };
  }

  return {
    num_ctx: 4096,
    num_predict: 420
  };
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
    if (response.status === 401 || response.status === 403) {
      throw new Error("API key is invalid.");
    }

    const text = await response.text().catch(() => "");
    const details = text || response.statusText || `HTTP ${response.status}`;
    throw new Error(`${errorLabel}: ${details}`);
  }

  return await response.json();
}

function cleanErrorMessage(error) {
  let message = String(error?.message || error || "Something went wrong.").trim();

  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  message = extractProviderErrorMessage(message);

  if (/api key is invalid|invalid api key|incorrect api key|unauthorized|forbidden|401|403/i.test(message)) {
    return "API key is invalid.";
  }

  if (/api key not set|empty key/i.test(message)) {
    return "API key is missing.";
  }

  if (/insufficient[_\s-]*(quota|funds|balance)|exceeded your current quota|billing details|check your plan|balance/i.test(message)) {
    return "Your API key does not have enough funds or quota. Please add credit or check your billing plan.";
  }

  if (/rate[_\s-]*limit|too many requests|429/i.test(message)) {
    return "The AI provider is receiving too many requests right now. Please wait a moment and try again.";
  }

  if (/model.*(not found|does not exist|invalid)|invalid.*model/i.test(message)) {
    return "The selected AI model is not available. Choose another model in settings and try again.";
  }

  if (/fetch failed|network|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(message) && !/ollama|foundry/i.test(message)) {
    return "Could not reach the AI provider. Please check your internet connection and try again.";
  }

  if (/service unavailable|server error|bad gateway|gateway timeout|HTTP 5\d\d|500|502|503|504/i.test(message)) {
    return "The AI provider is having trouble right now. Please try again in a few minutes.";
  }

  if (/ollama/i.test(message) && /fetch failed|ECONNREFUSED|not running|connect/i.test(message)) {
    return "Ollama is not running.";
  }

  if (/no ollama models found/i.test(message)) {
    return "No Ollama models found.";
  }

  if (/foundry local cli was not found|foundry.*not found/i.test(message)) {
    return "Foundry Local is not installed.";
  }

  if (/foundry local service is not running|foundry.*not running/i.test(message)) {
    return "Foundry Local is not running.";
  }

  if (/no foundry local models found/i.test(message)) {
    return "No Foundry Local models found.";
  }

  if (/no local provider is available|no local ai provider/i.test(message)) {
    return "No local AI provider is available. Start Ollama or Foundry Local.";
  }

  return message || "Something went wrong.";
}

function extractProviderErrorMessage(message) {
  const text = String(message || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) return text;

  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const providerMessage = parsed?.error?.message || parsed?.message || parsed?.detail || "";
    const providerCode = parsed?.error?.code || parsed?.code || "";
    const providerType = parsed?.error?.type || parsed?.type || "";
    const parts = [providerMessage, providerCode, providerType].filter(Boolean);
    if (parts.length) return parts.join(" ");
  } catch {
    // Keep the original message when a provider returns plain text.
  }

  return text;
}

function localAutoErrorMessage(ollamaError, foundryError) {
  const ollama = cleanErrorMessage(ollamaError);
  const foundry = cleanErrorMessage(foundryError);
  const messages = [...new Set([ollama, foundry].filter(Boolean))];

  if (!messages.length) {
    return "No local AI provider is available. Start Ollama or Foundry Local.";
  }

  return messages.join(" ");
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

function isVisionModelName(name) {
  return /llava|vision|gemma3|qwen2\.?5.?vl|minicpm|moondream|bakllava|llama3\.2-vision/i.test(String(name || ""));
}

function isLikelyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(ext)) return true;

  const base = path.basename(filePath).toLowerCase();
  return base === "readme" || base === "license" || base === ".env";
}

function readUploadedFile(filePath) {
  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    throw new Error("Only files can be uploaded.");
  }

  if (!isLikelyTextFile(filePath)) {
    throw new Error("This file does not look like a supported text/code document.");
  }

  const raw = fs.readFileSync(filePath, "utf-8");

  if (raw.includes("\u0000")) {
    throw new Error("Binary files are not supported yet.");
  }

  const content = raw.length > MAX_UPLOAD_CHARS ? raw.slice(0, MAX_UPLOAD_CHARS) : raw;
  const chunks = chunkText(raw);

  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    content,
    chunks,
    truncated: raw.length > MAX_UPLOAD_CHARS,
    charCount: raw.length
  };
}

async function pickFilesForUpload() {
  const result = await dialog.showOpenDialog(win, {
    title: "Open files for ibia",
    defaultPath: app.getPath("downloads"),
    properties: ["openFile", "multiSelections"]
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true, files: [], rejected: [] };
  }

  const extracted = await extractFilesFromPaths(result.filePaths);

  return {
    canceled: false,
    files: extracted.files,
    rejected: extracted.errors
  };
}

async function importLibraryDocuments() {
  const result = await dialog.showOpenDialog(win, {
    title: "Add study files to the library",
    defaultPath: app.getPath("downloads"),
    properties: ["openFile", "multiSelections"]
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true, added: [], rejected: [] };
  }

  return await importLibraryDocumentsFromPaths(result.filePaths);
}

async function importLibraryDocumentsFromPaths(filePaths) {
  const safePaths = Array.isArray(filePaths)
    ? filePaths.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!safePaths.length) {
    return { canceled: true, added: [], rejected: [] };
  }

  const store = loadLibraryStore();
  const added = [];
  const extracted = await extractFilesFromPaths(safePaths);

  for (const parsed of extracted.files) {
    const doc = {
      id: createDocumentId(),
      name: parsed.name,
      path: parsed.path,
      size: parsed.size,
      charCount: parsed.charCount,
      importedAt: new Date().toISOString(),
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [String(parsed.content || "")]
    };

    const existingIndex = store.documents.findIndex((item) => item.path === doc.path);
    if (existingIndex >= 0) store.documents.splice(existingIndex, 1);
    store.documents.unshift(doc);
    added.push(summarizeDocument(doc));
  }

  store.documents = store.documents.slice(0, 500);
  saveLibraryStore(store);

  return {
    canceled: false,
    added,
    rejected: extracted.errors
  };
}

function searchLibraryDocuments(payload) {
  const store = loadLibraryStore();
  const query = typeof payload === "string"
    ? String(payload || "").trim()
    : String(payload?.queryText || "").trim();
  const limit = Math.max(1, Math.min(12, Number(payload?.limit || (query ? 6 : 3))));
  const perDocumentLimit = Math.max(1, Math.min(4, Number(payload?.perDocumentLimit || 2)));
  const tokens = tokenizeSearchText(query);
  const results = [];

  for (const document of store.documents) {
    const docScore = scoreTextAgainstTokens(`${document.name} ${document.path}`, tokens);
    const chunks = Array.isArray(document.chunks) ? document.chunks : [];
    let hitsForDocument = 0;

    chunks.forEach((chunk, index) => {
      const score = docScore + scoreTextAgainstTokens(chunk, tokens);
      if (!score && query) return;
      if (hitsForDocument >= perDocumentLimit) return;

      results.push({
        id: document.id,
        name: document.name,
        path: document.path,
        chunkIndex: index,
        score,
        excerpt: chunk
      });
      hitsForDocument += 1;
    });
  }

  return results
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chunkIndex - b.chunkIndex;
    })
    .slice(0, limit);
}

async function extractFilesFromPaths(filePaths) {
  const script = extractorScriptPath();
  if (!fs.existsSync(script)) {
    throw new Error("The extraction script is missing.");
  }

  const safePaths = Array.isArray(filePaths)
    ? filePaths.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const combined = {
    files: [],
    errors: []
  };

  for (const filePath of safePaths) {
    const result = await extractSingleFileFromPath(script, filePath);
    combined.files.push(...result.files);
    combined.errors.push(...result.errors);
  }

  return combined;
}

async function extractSingleFileFromPath(script, filePath) {
  const python = resolvePythonExecutable();

  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = execFile(python, ["-X", "utf8", script, filePath], {
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024,
        timeout: EXTRACTION_TIMEOUT_MS,
        env: {
          ...process.env,
          PYTHONUTF8: "1"
        }
      }, (error, out, errOut) => {
        if (error) {
          reject(new Error(String(errOut || error.message || "Extraction failed.")));
          return;
        }
        resolve(String(out || ""));
      });
    });

    const parsed = JSON.parse(String(stdout || "{}"));
    return {
      files: Array.isArray(parsed?.files) ? parsed.files : [],
      errors: Array.isArray(parsed?.errors) ? parsed.errors : []
    };
  } catch (error) {
    return {
      files: [],
      errors: [
        {
          path: filePath,
          name: path.basename(filePath),
          error: describeExtractionError(error)
        }
      ]
    };
  }
}

function describeExtractionError(error) {
  const message = String(error?.message || error || "Extraction failed.");

  if (/timed out|SIGTERM|killed/i.test(message)) {
    return "This file took too long to process. Try a smaller export, split it into parts, or add a lighter version.";
  }

  if (/maxBuffer/i.test(message)) {
    return "This file produced too much extracted content in one pass. Try splitting it into smaller files.";
  }

  return message;
}

async function saveTextToFile(content, defaultPath = "") {
  const result = await dialog.showSaveDialog(win, {
    title: "Save AI output",
    defaultPath: defaultPath || "ibia-output.txt",
    filters: [
      { name: "Text files", extensions: ["txt", "md"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(result.filePath, String(content || ""), "utf-8");
  return { canceled: false, path: result.filePath };
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    title: "ibia",
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
    icon: APP_ICON_PATH,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }

    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const appUrl = pathToFileURL(path.join(__dirname, "index.html")).href;
    if (url === appUrl) return;

    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
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

  if (fs.existsSync(APP_ICON_PATH)) {
    icon = nativeImage.createFromPath(APP_ICON_PATH);
  }

  tray = new Tray(icon);
  tray.setToolTip("ibia");

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

  for (const accelerator of shortcuts) {
    const ok = globalShortcut.register(accelerator, toggleWindow);
    if (ok) {
      break;
    }
  }
}

async function ollamaListModels() {
  try {
    const json = await requestJson(`${OLLAMA_BASE_URL}/api/tags`, {}, "Ollama models request failed");
    return { base: OLLAMA_BASE_URL, json };
  } catch (error) {
    throw new Error(cleanErrorMessage(error));
  }
}

function pickOllamaModelId(modelsJson, prefer = "phi-3.5", wantVision = false, speedMode = "fast") {
  const names = (Array.isArray(modelsJson?.models) ? modelsJson.models : [])
    .map((model) => String(model?.name || "").trim())
    .filter(Boolean);

  const pool = wantVision ? names.filter((name) => isVisionModelName(name)) : names;
  const candidates = pool.length ? pool : names;

  const normalizedPrefer = String(prefer || "").toLowerCase().trim();
  const exact = candidates.find((name) => name.toLowerCase() === normalizedPrefer);
  if (exact) return exact;

  const partial = candidates.find((name) => name.toLowerCase().includes(normalizedPrefer));
  if (partial) return partial;

  if (wantVision) {
    return pickModelFromNames(candidates, [/gemma3/i, /llava/i, /vision/i, /.*/]);
  }

  if (speedMode === "deep") {
    return pickModelFromNames(candidates, [/14b/i, /8b/i, /7b/i, /qwen/i, /llama/i, /mistral/i, /.*/]);
  }

  if (speedMode === "balanced") {
    return pickModelFromNames(candidates, [/7b/i, /8b/i, /3b/i, /phi/i, /llama/i, /mistral/i, /.*/]);
  }

  return pickModelFromNames(candidates, [/3b/i, /1\.5b/i, /mini/i, /phi/i, /llama3\.2:3b/i, /qwen/i, /.*/]);
}

function buildOllamaMessages(messages, media) {
  const out = messages.map((message) => ({ ...message }));
  if (!Array.isArray(media) || !media.length) return out;

  const images = [];
  for (const item of media) {
    if (item?.mediaKind === "image" && item.imageBase64) {
      images.push(item.imageBase64);
    }
    if (item?.mediaKind === "video" && Array.isArray(item.videoFramesBase64)) {
      images.push(...item.videoFramesBase64.filter(Boolean));
    }
  }

  if (!images.length) return out;

  let targetIndex = -1;
  for (let index = out.length - 1; index >= 0; index -= 1) {
    if (out[index]?.role === "user") {
      targetIndex = index;
      break;
    }
  }

  if (targetIndex < 0) {
    out.push({ role: "user", content: "Please analyze the attached media.", images });
    return out;
  }

  out[targetIndex] = {
    ...out[targetIndex],
    images
  };

  return out;
}

async function ollamaChat(messages, media = []) {
  const settings = loadSettings();
  const speedMode = getLocalSpeedMode(settings);
  const { json } = await ollamaListModels();
  const wantVision = Array.isArray(media) && media.length > 0;
  const model = pickOllamaModelId(json, settings.local_prefer || settings.foundry_prefer, wantVision, speedMode);
  const runtimeOptions = getOllamaRuntimeOptions(speedMode);

  if (!model) throw new Error("No Ollama models found.");
  if (wantVision && !isVisionModelName(model)) {
    throw new Error("No Ollama vision model is available. Install a vision-capable model such as Gemma 3 or LLaVA.");
  }

  const jsonReply = await requestJson(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: buildOllamaMessages(messages, media),
      stream: false,
      options: runtimeOptions
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
      throw new Error("Foundry Local is not installed.");
    }

    const details = String(error?.stdout || error?.stderr || error?.message || "").trim();
    throw new Error(cleanErrorMessage(details || "Foundry Local command failed."));
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
    throw new Error("Foundry Local is not running.");
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
        error: localAutoErrorMessage(ollamaError, foundryError)
      };
    }
  }
}

async function localAutoChat(messages, media = []) {
  if (Array.isArray(media) && media.length) {
    const reply = await ollamaChat(messages, media);
    return {
      provider: "ollama",
      mode: "local-auto",
      label: "Local (Auto -> Ollama)",
      ...reply
    };
  }

  try {
    const reply = await ollamaChat(messages, []);
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
      throw new Error(localAutoErrorMessage(ollamaError, foundryError));
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

  throw new Error(cleanErrorMessage(lastError) || "API key is invalid.");
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
        error: cleanErrorMessage(error)
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
        error: cleanErrorMessage(error)
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
      error: cleanErrorMessage(settings.last_api_detection_error || "API key provider has not been detected yet.")
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

  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "Secure credential storage is not available on this device." };
  }

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
      last_api_detection_error: cleanErrorMessage(error)
    });

    return {
      ok: false,
      error: cleanErrorMessage(error)
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
      displayName: settings.display_name || "",
      localSpeedMode: getLocalSpeedMode(settings),
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

  ipcMain.handle("settings:setDisplayName", (event, name) => {
    const value = String(name || "").trim().slice(0, 48);
    saveSettings({ display_name: value });
    return { ok: true, displayName: value };
  });

  ipcMain.handle("settings:setLocalSpeedMode", (event, mode) => {
    const value = String(mode || "").trim().toLowerCase();
    if (!LOCAL_SPEED_MODES.has(value)) {
      return { ok: false, error: "Invalid speed mode" };
    }

    saveSettings({
      local_speed_mode: value
    });

    return { ok: true };
  });

  ipcMain.handle("ai:health", async () => {
    return await getHealthStatus();
  });

  ipcMain.handle("files:pick", async () => {
    return await pickFilesForUpload();
  });

  ipcMain.handle("files:loadPaths", async (event, paths) => {
    const safePaths = Array.isArray(paths) ? paths.map((item) => String(item || "")).filter(Boolean) : [];
    const extracted = await extractFilesFromPaths(safePaths);
    return {
      canceled: false,
      files: extracted.files,
      rejected: extracted.errors
    };
  });

  ipcMain.handle("files:saveText", async (event, payload) => {
    const content = String(payload?.content || "");
    const defaultPath = String(payload?.defaultPath || "");
    return await saveTextToFile(content, defaultPath);
  });

  ipcMain.handle("history:list", () => {
    const store = loadConversationStore();
    return store.conversations
      .map(summarizeConversation)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  });

  ipcMain.handle("history:get", (event, id) => {
    const targetId = String(id || "").trim();
    const store = loadConversationStore();
    return store.conversations.find((conversation) => conversation.id === targetId) || null;
  });

  ipcMain.handle("history:create", (event, payload) => {
    const store = loadConversationStore();
    const conversation = sanitizeConversationPayload(payload);
    store.conversations = [conversation, ...store.conversations.filter((item) => item.id !== conversation.id)];
    saveConversationStore(store);
    return conversation;
  });

  ipcMain.handle("history:save", (event, payload) => {
    const store = loadConversationStore();
    const conversation = sanitizeConversationPayload(payload);
    const next = store.conversations.filter((item) => item.id !== conversation.id);
    next.unshift(conversation);
    store.conversations = next.slice(0, 100);
    saveConversationStore(store);
    return summarizeConversation(conversation);
  });

  ipcMain.handle("history:delete", (event, id) => {
    const targetId = String(id || "").trim();
    const store = loadConversationStore();
    const before = store.conversations.length;
    store.conversations = store.conversations.filter((conversation) => conversation.id !== targetId);
    saveConversationStore(store);
    return { ok: store.conversations.length !== before };
  });

  ipcMain.handle("library:list", () => {
    const store = loadLibraryStore();
    return store.documents
      .map(summarizeDocument)
      .sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)));
  });

  ipcMain.handle("library:import", async () => {
    return await importLibraryDocuments();
  });

  ipcMain.handle("library:importPaths", async (event, paths) => {
    return await importLibraryDocumentsFromPaths(paths);
  });

  ipcMain.handle("library:remove", (event, id) => {
    const targetId = String(id || "").trim();
    const store = loadLibraryStore();
    const before = store.documents.length;
    store.documents = store.documents.filter((document) => document.id !== targetId);
    saveLibraryStore(store);
    return { ok: store.documents.length !== before };
  });

  ipcMain.handle("library:search", (event, queryText) => {
    return searchLibraryDocuments(queryText);
  });

  ipcMain.handle("ai:ask", async (event, payload) => {
    try {
      const input = Array.isArray(payload) ? { messages: payload, media: [] } : (payload || {});
      const safeMessages = normalizeMessages(input.messages);
      const media = Array.isArray(input.media) ? input.media : [];
      const settings = loadSettings();

      if (settings.provider === "local-auto") {
        const reply = await localAutoChat(safeMessages, media);
        return reply.text;
      }

      if (settings.provider === "ollama") {
        const reply = await ollamaChat(safeMessages, media);
        return reply.text;
      }

      if (settings.provider === "foundry") {
        if (media.length) {
          throw new Error("Foundry Local cannot read images or videos yet. Use Ollama with a vision model.");
        }
        const reply = await foundryChat(safeMessages);
        return reply.text;
      }

      const apiKey = String(settings.api_key || "").trim();
      if (!apiKey) throw new Error("API key is missing.");

      const cloudProvider = resolveCloudProvider(settings);
      if (!cloudProvider) {
        throw new Error(settings.last_api_detection_error || "API key is invalid.");
      }

      if (media.length) {
        throw new Error("Cloud media analysis is not available yet. Use Ollama with a vision model.");
      }

      const reply = await cloudChat(cloudProvider, apiKey, safeMessages, settings.cloud_model);
      return reply.text;
    } catch (error) {
      throw new Error(cleanErrorMessage(error));
    }
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    wireIPC();
    registerShortcuts();
  });
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep the tray app alive.
});
