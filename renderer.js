const appEl = document.getElementById("app");
const messagesDiv = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const toast = document.getElementById("toast");
const statusText = document.getElementById("statusText");

const closeBtn = document.getElementById("closeBtn");
const minBtn = document.getElementById("minBtn");
const maxBtn = document.getElementById("maxBtn");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const providerSelect = document.getElementById("providerSelect");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");
const settingsHint = document.getElementById("settingsHint");

const themeBtn = document.getElementById("themeBtn");
const themeIconMoon = document.getElementById("themeIconMoon");
const themeIconSun = document.getElementById("themeIconSun");

const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");

const MAX_CONTEXT_CHARS = 1100;
const MAX_MSG_CHARS = 650;
const KEEP_LAST_MESSAGES = 8;

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

let chatHistory = [
  {
    role: "system",
    content: "You are a helpful desktop assistant. Be friendly, practical, and concise."
  }
];

let busy = false;
let queue = [];

function showToast(message, ms = 1500) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("show"), ms);
}

function applyThemeIcon(theme) {
  const isDark = theme === "dark";
  themeIconMoon.style.display = isDark ? "block" : "none";
  themeIconSun.style.display = isDark ? "none" : "block";
}

function setTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  applyThemeIcon(theme);
}

function toggleTheme() {
  const current = document.body.getAttribute("data-theme") || "dark";
  setTheme(current === "dark" ? "light" : "dark");
}

function autoGrow() {
  input.style.height = "0px";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(text) {
  let html = escapeHtml(text);
  const codeTokens = [];

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@INLINE_CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code class="inlineCode">${code}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  html = html.replace(/\*\*([^*][\s\S]*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_][\s\S]*?)__/g, '<span class="underline">$1</span>');
  html = html.replace(/\*([^*\n][\s\S]*?)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_\n][\s\S]*?)_/g, "<em>$1</em>");
  html = html.replace(/~~([^~][\s\S]*?)~~/g, "<del>$1</del>");

  for (let index = 0; index < codeTokens.length; index += 1) {
    html = html.replace(`@@INLINE_CODE_${index}@@`, codeTokens[index]);
  }

  return html;
}

function renderTextBlock(block) {
  const lines = String(block || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = "";

  function closeList() {
    if (!listType) return;
    html.push(listType === "ol" ? "</ol>" : "</ul>");
    listType = "";
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    closeList();

    if (line.startsWith("### ")) {
      html.push(`<h3>${renderInline(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("> ")) {
      html.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
      continue;
    }

    html.push(`<p>${renderInline(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function renderCodeBlock(block) {
  const trimmed = String(block || "").replace(/^\n+|\n+$/g, "");
  const lines = trimmed.split("\n");
  const first = lines[0]?.trim() || "";
  const hasLanguage = /^[a-z0-9_+#.-]{1,24}$/i.test(first);
  const language = hasLanguage ? first : "";
  const code = hasLanguage ? lines.slice(1).join("\n") : trimmed;

  return `
    <pre class="codeBlock">
      ${language ? `<div class="codeLabel">${escapeHtml(language)}</div>` : ""}
      <code>${escapeHtml(code)}</code>
    </pre>
  `;
}

function renderMessage(text) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const segments = source.split(/```/);

  if (segments.length === 1) {
    return renderTextBlock(source);
  }

  let html = "";
  for (let index = 0; index < segments.length; index += 1) {
    html += index % 2 === 0 ? renderTextBlock(segments[index]) : renderCodeBlock(segments[index]);
  }

  return html;
}

function isNearBottom(element, threshold = 140) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function addBubble(text, kind) {
  const stick = isNearBottom(messagesDiv);
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.innerHTML = renderMessage(text);
  messagesDiv.appendChild(div);

  if (stick) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  return div;
}

function greet() {
  addBubble("Hello. Local mode uses Ollama first, then Foundry Local. Paste a cloud API key in Settings if you want OpenAI, Claude, Grok, or DeepSeek.", "ai");
}

function openSettings() {
  settingsPanel.classList.add("open");
  settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || "Unknown";
}

function updateKeyStatus(settings) {
  if (!settings.apiKeySet) {
    keyStatus.textContent = "Key: not set";
    settingsHint.textContent = "Local (Auto) tries Ollama first, then Foundry Local. Paste any supported cloud API key and the app will detect the provider for you.";
    return;
  }

  if (settings.detectedProvider) {
    keyStatus.textContent = `Key: set - ${providerLabel(settings.detectedProvider)}`;
    settingsHint.textContent = settings.cloudModel
      ? `Detected ${providerLabel(settings.detectedProvider)} and saved model ${settings.cloudModel}.`
      : `Detected ${providerLabel(settings.detectedProvider)} for this key.`;
    return;
  }

  keyStatus.textContent = "Key: saved";
  settingsHint.textContent = "The key is stored locally on this PC. If detection fails, switch to the exact provider and try saving again.";
}

async function loadSettingsUI() {
  if (!window.api?.settingsGet) {
    keyStatus.textContent = "Key: settings API unavailable";
    return;
  }

  const settings = await window.api.settingsGet();
  providerSelect.value = settings.provider || "local-auto";
  updateKeyStatus(settings);
}

settingsBtn.addEventListener("click", () => {
  if (settingsPanel.classList.contains("open")) closeSettings();
  else openSettings();
});

settingsCloseBtn.addEventListener("click", closeSettings);

document.addEventListener("mousedown", (event) => {
  if (!settingsPanel.classList.contains("open")) return;

  const inside = settingsPanel.contains(event.target) || settingsBtn.contains(event.target);
  if (!inside) closeSettings();
});

providerSelect.addEventListener("change", async () => {
  if (!window.api?.settingsSetProvider) {
    showToast("Settings API not wired");
    return;
  }

  const result = await window.api.settingsSetProvider(providerSelect.value);
  if (!result?.ok) {
    showToast(result?.error || "Could not update provider");
    return;
  }

  showToast("Provider updated");
  await loadSettingsUI();
  await refreshHealth();
});

saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showToast("Paste your key first");
    return;
  }

  const saveApiKey = window.api?.settingsSetApiKey || window.api?.settingsSetOpenAIKey;
  if (!saveApiKey) {
    showToast("Settings API not wired");
    return;
  }

  const result = await saveApiKey(key);
  if (!result?.ok) {
    showToast(result?.error || "Could not save key", 2200);
    return;
  }

  apiKeyInput.value = "";
  showToast(result.detectedProviderLabel ? `Detected ${result.detectedProviderLabel}` : "Key saved");
  await loadSettingsUI();
  await refreshHealth();
});

async function refreshHealth() {
  try {
    const health = await window.api.health();
    const modelText = health.model ? ` - ${health.model}` : "";

    statusText.textContent = health.ok
      ? `Provider: ${health.label}${modelText}`
      : `Provider: ${health.label} - ${health.error || "Not ready"}`;
  } catch (error) {
    statusText.textContent = `Provider: Unknown - ${error.message || error}`;
  }
}

function clipText(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}... [clipped]` : value;
}

function prepareHistoryForSend(history) {
  const all = Array.isArray(history) ? history : [];
  if (!all.length) return [];

  const first = all[0]?.role === "system"
    ? { ...all[0], content: clipText(all[0].content, 380) }
    : null;

  const tail = all.slice(first ? 1 : 0);
  const recent = tail.slice(Math.max(0, tail.length - KEEP_LAST_MESSAGES)).map((message) => ({
    role: message.role,
    content: clipText(message.content, MAX_MSG_CHARS)
  }));

  const out = first ? [first, ...recent] : [...recent];
  const totalChars = () => out.reduce((sum, message) => sum + String(message.content || "").length, 0);

  while (out.length > 2 && totalChars() > MAX_CONTEXT_CHARS) {
    if (out[0]?.role === "system") out.splice(1, 1);
    else out.splice(0, 1);
  }

  if (totalChars() > MAX_CONTEXT_CHARS && out.length) {
    const last = out[out.length - 1];
    last.content = clipText(last.content, Math.max(200, MAX_CONTEXT_CHARS - 200));
  }

  return out;
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message) return;

  if (busy) {
    queue.push(message);
    showToast(`Queued (${queue.length})`);
    return;
  }

  busy = true;
  addBubble(message, "you");
  chatHistory.push({ role: "user", content: message });

  const typing = addBubble("_Thinking..._", "ai");

  try {
    const payloadHistory = prepareHistoryForSend(chatHistory);
    const reply = await window.api.ask(payloadHistory);
    typing.innerHTML = renderMessage(reply);
    chatHistory.push({ role: "assistant", content: reply });

    if (isNearBottom(messagesDiv)) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  } catch (error) {
    const textValue = `**Error**\n\n${error.message || error}`;
    typing.innerHTML = renderMessage(textValue);
    showToast("AI error");
  } finally {
    busy = false;
    if (queue.length) setTimeout(() => sendMessage(queue.shift()), 120);
    input.focus();
  }
}

closeBtn.addEventListener("click", async () => window.api.hide());
minBtn.addEventListener("click", async () => window.api.minimize());
maxBtn.addEventListener("click", async () => window.api.toggleMaximize());
themeBtn.addEventListener("click", toggleTheme);

async function syncMaxState() {
  const maximized = await window.api.isMaximized();
  appEl.classList.toggle("maxed", !!maximized);
}

window.api.onState(({ maximized }) => {
  appEl.classList.toggle("maxed", !!maximized);
});

sendBtn.addEventListener("click", () => {
  const text = input.value;
  input.value = "";
  autoGrow();
  sendMessage(text);
});

input.addEventListener("input", autoGrow);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = input.value;
    input.value = "";
    autoGrow();
    sendMessage(text);
  }
});

uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;

  for (const file of files) {
    const text = await readFileAsText(file);
    const clipped = clipText(text, 1200);

    addBubble(`Loaded file: **${file.name}**`, "ai");

    chatHistory.push({
      role: "system",
      content: `User uploaded file "${file.name}". Content (truncated):\n---BEGIN FILE---\n${clipped}\n---END FILE---`
    });
  }

  fileInput.value = "";
});

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

function playEntrance() {
  appEl.classList.remove("enter");
  void appEl.offsetWidth;
  appEl.classList.add("enter");
}

window.api.onShown(() => playEntrance());

setTheme(localStorage.getItem("theme") || "dark");
greet();
loadSettingsUI();
refreshHealth();
setInterval(refreshHealth, 20000);
autoGrow();
input.focus();
playEntrance();
syncMaxState();
