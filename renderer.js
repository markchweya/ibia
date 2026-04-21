const appEl = document.getElementById("app");
const messagesDiv = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const toast = document.getElementById("toast");
const statusText = document.getElementById("statusText");

const closeBtn = document.getElementById("closeBtn");
const minBtn = document.getElementById("minBtn");
const maxBtn = document.getElementById("maxBtn");

const historyBtn = document.getElementById("historyBtn");
const historyPanel = document.getElementById("historyPanel");
const historyCloseBtn = document.getElementById("historyCloseBtn");
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const providerSelect = document.getElementById("providerSelect");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");
const settingsHint = document.getElementById("settingsHint");
const libraryUploadBtn = document.getElementById("libraryUploadBtn");
const libraryList = document.getElementById("libraryList");

const themeBtn = document.getElementById("themeBtn");
const themeIconMoon = document.getElementById("themeIconMoon");
const themeIconSun = document.getElementById("themeIconSun");

const uploadBtn = document.getElementById("uploadBtn");
const saveReplyBtn = document.getElementById("saveReplyBtn");
const fileMemory = document.getElementById("fileMemory");

const DEFAULT_SYSTEM_PROMPT = "You are a helpful desktop assistant. Be friendly, practical, and concise.";
const MAX_CONTEXT_CHARS = 7200;
const MAX_MSG_CHARS = 1200;
const KEEP_LAST_MESSAGES = 10;
const MAX_FILE_EXCERPT_CHARS = 1500;

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

let chatHistory = createInitialChatHistory();
let busy = false;
let queue = [];
let uploadedFiles = [];
let lastAssistantReply = "";
let currentConversationId = "";
let currentConversationCreatedAt = "";
let historySummaries = [];
let historyScrollTop = 0;
let libraryDocs = [];
let currentHealth = null;
let persistTimer = null;

function createInitialChatHistory() {
  return [
    {
      role: "system",
      content: DEFAULT_SYSTEM_PROMPT
    }
  ];
}

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
    const token = `\uE000${codeTokens.length}\uE001`;
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
    html = html.replace(`\uE000${index}\uE001`, codeTokens[index]);
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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || "Unknown";
}

function formatDateLabel(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function clipText(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}... [clipped]` : value;
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

function scoreFileAgainstQuery(file, queryTokens, rawQuery) {
  if (!queryTokens.length && !rawQuery.trim()) return 1;

  const haystack = `${file.name} ${file.path}`.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (file.name.toLowerCase().includes(token)) score += 8;
    if (file.path.toLowerCase().includes(token)) score += 5;
    if (haystack.includes(token)) score += 1;
  }

  if (rawQuery && haystack.includes(rawQuery.toLowerCase())) score += 6;
  return score;
}

function scoreChunkAgainstQuery(file, chunk, queryTokens, rawQuery) {
  const chunkText = String(chunk || "");
  const haystack = `${file.name} ${file.path} ${chunkText}`.toLowerCase();
  let score = scoreFileAgainstQuery(file, queryTokens, rawQuery);

  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 4;
  }

  if (rawQuery && haystack.includes(rawQuery.toLowerCase())) score += 8;
  return score;
}

function renderFileMemory() {
  if (!uploadedFiles.length) {
    fileMemory.hidden = true;
    fileMemory.innerHTML = "";
    return;
  }

  fileMemory.hidden = false;
  fileMemory.innerHTML = uploadedFiles.map((file, index) => `
    <div class="fileChip">
      <div class="fileChipMeta">
        <div class="fileChipName">${escapeHtml(file.name)}</div>
        <div class="fileChipInfo">${escapeHtml(formatBytes(file.size))}${file.truncated ? " - clipped for preview" : ""}</div>
      </div>
      <button class="fileChipRemove" type="button" data-file-index="${index}" aria-label="Remove ${escapeHtml(file.name)}">x</button>
    </div>
  `).join("");
}

function findRelevantUploadedChunks(queryText) {
  if (!uploadedFiles.length) return [];

  const query = String(queryText || "").trim();
  const queryTokens = tokenizeSearchText(query);
  const matches = [];

  for (const file of uploadedFiles) {
    const chunks = Array.isArray(file.chunks) && file.chunks.length ? file.chunks : [file.content];

    chunks.forEach((chunk, index) => {
      const score = scoreChunkAgainstQuery(file, chunk, queryTokens, query);
      if (!score && query) return;

      matches.push({
        source: "chat",
        name: file.name,
        path: file.path,
        chunkIndex: index,
        score,
        excerpt: clipText(chunk, MAX_FILE_EXCERPT_CHARS)
      });
    });
  }

  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chunkIndex - b.chunkIndex;
    })
    .slice(0, 4);
}

function deriveConversationTitle(messages, files) {
  const firstUser = (messages || []).find((message) => message?.role === "user" && String(message?.content || "").trim());
  if (firstUser) {
    return clipText(firstUser.content.replace(/\s+/g, " ").trim(), 48);
  }

  if (files?.length) {
    return `Files: ${files[0].name}`;
  }

  return "Untitled chat";
}

function buildConversationPayload() {
  return {
    id: currentConversationId,
    title: deriveConversationTitle(chatHistory, uploadedFiles),
    createdAt: currentConversationCreatedAt || new Date().toISOString(),
    messages: chatHistory,
    uploadedFiles,
    lastAssistantReply
  };
}

async function saveCurrentConversation() {
  if (!window.api?.historySave || !currentConversationId) return;

  const nonSystemMessages = chatHistory.filter((message) => message.role !== "system" && String(message.content || "").trim());
  if (!nonSystemMessages.length && !uploadedFiles.length) return;

  await window.api.historySave(buildConversationPayload());
  await loadHistoryList();
}

function scheduleConversationSave() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    saveCurrentConversation().catch(() => {});
  }, 220);
}

async function loadHistoryList() {
  if (!window.api?.historyList) return;
  historyScrollTop = historyList.scrollTop;
  historySummaries = await window.api.historyList();
  renderHistoryList();
  historyList.scrollTop = historyScrollTop;
}

function renderHistoryList() {
  if (!historySummaries.length) {
    historyList.innerHTML = `
      <div class="historyEmpty">
        <div class="historyEmptyTitle">No saved chats yet</div>
        <div class="historyEmptyText">Start a conversation and it will appear here automatically.</div>
      </div>
    `;
    return;
  }

  historyList.innerHTML = historySummaries.map((item) => `
    <div class="historyItem${item.id === currentConversationId ? " active" : ""}" data-history-id="${escapeHtml(item.id)}">
      <div class="historyItemMain">
        <div class="historyItemTitle">${escapeHtml(item.title || "Untitled chat")}</div>
        <div class="historyItemMeta">
          ${escapeHtml(formatDateLabel(item.updatedAt))}
          ${item.fileCount ? ` - ${item.fileCount} file${item.fileCount === 1 ? "" : "s"}` : ""}
        </div>
        <div class="historyItemPreview">${escapeHtml(item.preview || "Open this chat to continue it.")}</div>
      </div>
      <button class="historyDeleteBtn" type="button" data-history-delete="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.title || "chat")}">x</button>
    </div>
  `).join("");
}

async function loadLibraryList() {
  if (!window.api?.libraryList) return;
  libraryDocs = await window.api.libraryList();
  renderLibraryList();
}

function renderLibraryList() {
  if (!libraryDocs.length) {
    libraryList.innerHTML = `
      <div class="libraryEmpty">
        <div class="historyEmptyTitle">No study files yet</div>
        <div class="historyEmptyText">Add notes, source files, revision guides, or datasets here. The AI will search them by relevance.</div>
      </div>
    `;
    return;
  }

  libraryList.innerHTML = libraryDocs.map((doc) => `
    <div class="libraryItem">
      <div class="libraryItemMeta">
        <div class="libraryItemName">${escapeHtml(doc.name)}</div>
        <div class="libraryItemInfo">${escapeHtml(formatBytes(doc.size))} - ${doc.chunkCount} chunks</div>
      </div>
      <button class="historyDeleteBtn" type="button" data-library-delete="${escapeHtml(doc.id)}" aria-label="Remove ${escapeHtml(doc.name)}">x</button>
    </div>
  `).join("");
}

function openHistory() {
  historyPanel.classList.add("open");
  historyPanel.setAttribute("aria-hidden", "false");
}

function closeHistory() {
  historyPanel.classList.remove("open");
  historyPanel.setAttribute("aria-hidden", "true");
}

function openSettings() {
  settingsPanel.classList.add("open");
  settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
}

function greet() {
  addBubble("Hello. Local mode uses Ollama first, then Foundry Local. The study library can hold many text/code files, and the AI will pull the most relevant chunks into each answer.", "ai");
}

function renderChatHistory() {
  messagesDiv.innerHTML = "";

  const visibleMessages = chatHistory.filter((message) => message.role !== "system" && String(message.content || "").trim());
  if (!visibleMessages.length) {
    greet();
    return;
  }

  for (const message of visibleMessages) {
    addBubble(message.content, message.role === "assistant" ? "ai" : "you");
  }
}

async function createNewConversation() {
  const now = new Date().toISOString();
  chatHistory = createInitialChatHistory();
  uploadedFiles = [];
  lastAssistantReply = "";
  busy = false;
  queue = [];
  currentConversationCreatedAt = now;
  currentConversationId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  renderFileMemory();
  renderChatHistory();
  scheduleConversationSave();
  await loadHistoryList();
  closeHistory();
  input.focus();
}

async function openConversation(id) {
  if (!window.api?.historyGet) return;

  const conversation = await window.api.historyGet(id);
  if (!conversation) {
    showToast("That chat could not be found");
    await loadHistoryList();
    return;
  }

  currentConversationId = conversation.id;
  currentConversationCreatedAt = conversation.createdAt || conversation.updatedAt || new Date().toISOString();
  chatHistory = Array.isArray(conversation.messages) && conversation.messages.length
    ? conversation.messages
    : createInitialChatHistory();
  uploadedFiles = Array.isArray(conversation.uploadedFiles) ? conversation.uploadedFiles : [];
  lastAssistantReply = String(conversation.lastAssistantReply || "");
  busy = false;
  queue = [];
  renderFileMemory();
  renderChatHistory();
  await loadHistoryList();
  closeHistory();
  input.focus();
}

async function deleteConversation(id) {
  if (!window.api?.historyDelete) return;

  await window.api.historyDelete(id);
  if (id === currentConversationId) {
    await createNewConversation();
    return;
  }

  await loadHistoryList();
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

async function refreshHealth() {
  try {
    currentHealth = await window.api.health();
    const modelText = currentHealth.model ? ` - ${currentHealth.model}` : "";

    statusText.textContent = currentHealth.ok
      ? `Provider: ${currentHealth.label}${modelText}`
      : `Provider: ${currentHealth.label} - ${currentHealth.error || "Not ready"}`;
  } catch (error) {
    currentHealth = null;
    statusText.textContent = `Provider: Unknown - ${error.message || error}`;
  }
}

async function buildDocumentContext(queryText) {
  const uploadedMatches = findRelevantUploadedChunks(queryText);
  const libraryMatches = window.api?.librarySearch ? await window.api.librarySearch(queryText) : [];
  const sections = [];

  if (uploadedMatches.length) {
    sections.push(
      "Conversation file matches:\n" +
      uploadedMatches.map((match) =>
        `FILE: ${match.name}\nPATH: ${match.path}\nEXCERPT:\n${match.excerpt}`
      ).join("\n---\n")
    );
  }

  if (libraryMatches?.length) {
    sections.push(
      "Study library matches:\n" +
      libraryMatches.map((match) =>
        `FILE: ${match.name}\nPATH: ${match.path}\nEXCERPT:\n${clipText(match.excerpt, MAX_FILE_EXCERPT_CHARS)}`
      ).join("\n---\n")
    );
  }

  if (!sections.length) return null;

  return {
    role: "system",
    content:
      "Relevant document context for this question. Prefer these excerpts when answering. " +
      "If the user asks for revision help, explain clearly and in depth.\n\n" +
      sections.join("\n\n")
  };
}

async function prepareHistoryForSend(history, latestQuery) {
  const all = Array.isArray(history) ? history : [];
  const systemMessages = [];

  if (all[0]?.role === "system") {
    systemMessages.push({ ...all[0], content: clipText(all[0].content, 420) });
  }

  const documentContext = await buildDocumentContext(latestQuery);
  if (documentContext) {
    systemMessages.push(documentContext);
  }

  const tail = all.slice(all[0]?.role === "system" ? 1 : 0);
  const recent = tail.slice(Math.max(0, tail.length - KEEP_LAST_MESSAGES)).map((message) => ({
    role: message.role,
    content: clipText(message.content, MAX_MSG_CHARS)
  }));

  const out = [...systemMessages, ...recent];
  const totalChars = () => out.reduce((sum, message) => sum + String(message.content || "").length, 0);

  while (out.length > systemMessages.length + 1 && totalChars() > MAX_CONTEXT_CHARS) {
    out.splice(systemMessages.length, 1);
  }

  if (totalChars() > MAX_CONTEXT_CHARS && out.length) {
    const last = out[out.length - 1];
    last.content = clipText(last.content, Math.max(280, MAX_CONTEXT_CHARS - 320));
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
  scheduleConversationSave();

  const typing = addBubble("_Thinking..._", "ai");

  try {
    const payloadHistory = await prepareHistoryForSend(chatHistory, message);
    const reply = await window.api.ask(payloadHistory);
    typing.innerHTML = renderMessage(reply);
    chatHistory.push({ role: "assistant", content: reply });
    lastAssistantReply = reply;
    scheduleConversationSave();

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

historyBtn.addEventListener("click", async () => {
  if (historyPanel.classList.contains("open")) {
    closeHistory();
    return;
  }

  await loadHistoryList();
  openHistory();
});

historyCloseBtn.addEventListener("click", closeHistory);

settingsBtn.addEventListener("click", () => {
  if (settingsPanel.classList.contains("open")) closeSettings();
  else openSettings();
});

settingsCloseBtn.addEventListener("click", closeSettings);

document.addEventListener("mousedown", (event) => {
  if (settingsPanel.classList.contains("open")) {
    const insideSettings = settingsPanel.contains(event.target) || settingsBtn.contains(event.target);
    if (!insideSettings) closeSettings();
  }

  if (historyPanel.classList.contains("open")) {
    const insideHistory = historyPanel.contains(event.target) || historyBtn.contains(event.target);
    if (!insideHistory) closeHistory();
  }
});

newChatBtn.addEventListener("click", async () => {
  await createNewConversation();
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

libraryUploadBtn.addEventListener("click", async () => {
  if (!window.api?.libraryImport) {
    showToast("Library API not wired");
    return;
  }

  const result = await window.api.libraryImport();
  if (!result || result.canceled) return;

  if ((result.added || []).length) {
    showToast(`${result.added.length} library file${result.added.length === 1 ? "" : "s"} added`);
  }

  for (const rejected of result.rejected || []) {
    addBubble(`**Could not add ${rejected.name} to the library**\n\n${rejected.error}`, "ai");
  }

  await loadLibraryList();
});

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

uploadBtn.addEventListener("click", async () => {
  if (!window.api?.pickFiles) {
    showToast("File API not wired");
    return;
  }

  const result = await window.api.pickFiles();
  if (!result || result.canceled) return;

  for (const file of result.files || []) {
    const existing = uploadedFiles.findIndex((item) => item.path === file.path);
    if (existing >= 0) uploadedFiles.splice(existing, 1);
    uploadedFiles.unshift(file);

    addBubble(
      `Loaded file: **${file.name}**\n\n` +
      `Path: \`${file.path}\`\n` +
      `Size: ${formatBytes(file.size)}${file.truncated ? "\nNote: preview was clipped, but chunk retrieval will still use the imported chunks." : ""}`,
      "ai"
    );
  }

  for (const rejected of result.rejected || []) {
    addBubble(`**Could not load ${rejected.name}**\n\n${rejected.error}`, "ai");
  }

  renderFileMemory();
  scheduleConversationSave();

  const loadedCount = (result.files || []).length;
  if (loadedCount) {
    showToast(`${loadedCount} file${loadedCount === 1 ? "" : "s"} added to this chat`);
  }
});

fileMemory.addEventListener("click", (event) => {
  const button = event.target.closest("[data-file-index]");
  if (!button) return;

  const index = Number(button.getAttribute("data-file-index"));
  if (!Number.isInteger(index) || index < 0 || index >= uploadedFiles.length) return;

  const removed = uploadedFiles.splice(index, 1)[0];
  renderFileMemory();
  scheduleConversationSave();
  showToast(`Removed ${removed.name} from this chat`);
});

historyList.addEventListener("click", async (event) => {
  historyScrollTop = historyList.scrollTop;

  const deleteButton = event.target.closest("[data-history-delete]");
  if (deleteButton) {
    await deleteConversation(deleteButton.getAttribute("data-history-delete"));
    return;
  }

  const item = event.target.closest("[data-history-id]");
  if (!item) return;
  await openConversation(item.getAttribute("data-history-id"));
});

libraryList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-library-delete]");
  if (!deleteButton || !window.api?.libraryRemove) return;

  await window.api.libraryRemove(deleteButton.getAttribute("data-library-delete"));
  await loadLibraryList();
});

saveReplyBtn.addEventListener("click", async () => {
  if (!lastAssistantReply.trim()) {
    showToast("No AI reply to save yet");
    return;
  }

  if (!window.api?.saveTextFile) {
    showToast("Save API not wired");
    return;
  }

  const result = await window.api.saveTextFile({
    content: lastAssistantReply,
    defaultPath: "ai-rewrite.md"
  });

  if (!result || result.canceled) return;
  showToast("Reply saved");
});

function playEntrance() {
  appEl.classList.remove("enter");
  void appEl.offsetWidth;
  appEl.classList.add("enter");
}

window.api.onShown(() => playEntrance());

async function boot() {
  setTheme(localStorage.getItem("theme") || "dark");
  await loadSettingsUI();
  await refreshHealth();
  await loadHistoryList();
  await loadLibraryList();

  if (historySummaries.length) {
    await openConversation(historySummaries[0].id);
  } else {
    await createNewConversation();
  }

  setInterval(refreshHealth, 20000);
  autoGrow();
  input.focus();
  playEntrance();
  syncMaxState();
  renderFileMemory();
}

boot();
