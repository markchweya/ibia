# ibia (Windows)

ibia is a lightweight, system-wide desktop AI assistant for Windows that opens a floating chat window from a global keyboard shortcut. It’s designed for **fast, offline/local AI** first — using **Microsoft Phi-3.5-mini** as the default local model — with optional cloud providers when you add an API key in Settings.

---

## What it does

* Press a **global hotkey** → a **floating chat window** appears (press again to hide)
* Runs quietly in the background with a **tray icon** fallback
* Lets you chat with **Phi-3.5-mini locally/offline**
* Optionally switch to **OpenAI, Claude, Grok, or DeepSeek** if you add an API key

---

## Features

* **Global keyboard shortcut** to show/hide the window
* **Floating UI**: movable, resizable, frameless
* **Background mode** with **tray icon**
* **Pluggable AI providers**

  * **Local (Default): Phi-3.5-mini**
  * **Cloud providers (Optional):** OpenAI, Claude, Grok, and DeepSeek via API key in Settings
* **Simple packaging** with `electron-builder` (Windows installer)

---

## Requirements

* Windows 10/11
* Node.js (LTS recommended)
* **Phi-3.5-mini local runtime** (choose one):

  * **Option A (Recommended if your build uses it):** Microsoft Phi-3.5-mini via the *official Microsoft distribution/runtime* you installed
  * **Option B (If your build supports it):** an Ollama-based local runtime (only if your implementation actually uses Ollama)

> The app is built around **Phi-3.5-mini** as the local model. The exact setup depends on which local runtime your build is wired to.

---

## Install

```bash
npm install
```

---

## Run (Development)

```bash
npm start
```

---

## Build (Windows Installer)

```bash
npx electron-builder
```

Installer output is written to `dist/`.

---

## Local AI Setup (Phi-3.5-mini)

### Option A — Microsoft Phi-3.5-mini (Official)

Use this if your current build is connected to the official Microsoft Phi setup (as you installed it).

1. Install/prepare Phi-3.5-mini using your Microsoft method (weights/runtime)
2. Confirm the model is available locally (path or runtime service is working)
3. In **ibia → Settings**:

   * Select **Local (Phi-3.5-mini)**
   * Point the app to the **model path** (if your build requires a path), or confirm it can reach the local runtime

> If your implementation uses a local server endpoint or a local model directory, document that in your `Settings` UI and ensure it’s referenced here (e.g., “Model Path”, “Runtime URL”, etc.).

### Option B — Ollama (Only if your build supports it)

If your build can use Ollama and Phi-3.5-mini through it:

1. Install and run Ollama
2. Pull a Phi-3.5-mini model (name may vary depending on what’s available in your Ollama registry)
3. ibia will detect the local model if your implementation includes model discovery

Example (model tag may differ):

```bash
ollama pull phi3.5:mini
```

---

## Cloud API Setup (Optional)

1. Open **Settings** in the app
2. Paste an **OpenAI, Claude, Grok, or DeepSeek API key**
3. Choose **API Key (Auto Detect)** or a specific cloud provider

**Security note:** API keys are stored only on your machine and encrypted at rest with Electron safeStorage, which uses the operating system's credential protection. Keys are never bundled with the app or exposed back to the renderer after saving.

---

## Usage Tips

* Use the global hotkey for quick “overlay chat” workflows (copy/paste, rewrite, summarize, code snippets)
* Prefer **Local (Phi-3.5-mini)** for:

  * offline work
  * privacy-sensitive content
  * low-latency prompts (depending on your machine)
* Use **cloud providers** for:

  * higher accuracy needs
  * longer context (depending on model)
  * when local resources are limited

---

## Troubleshooting

* **Hotkey doesn’t work:** check if another app is using the same shortcut; change it in Settings (if supported).
* **Local model not responding:** confirm your Phi-3.5-mini runtime/model path is correctly set and accessible.
* **Cloud API errors:** verify the API key, selected provider, and that your network allows outbound requests.

---

## License

Refer to `LICENSE`.
