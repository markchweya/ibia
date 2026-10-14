# ibia (Desktop)

ibia is a desktop AI assistant that gives users instant access to AI from anywhere on their computer. Launch it with a keyboard shortcut, chat using local or cloud models, work with documents, and continue conversations without leaving your workflow.

Built around a local-first philosophy, ibia supports private, offline-friendly experiences through local AI runtimes such as Ollama and Foundry Local, while also allowing users to connect their own API keys for providers including OpenAI, Claude, Grok, and DeepSeek.

---

## What it does

* Press a **global hotkey** → a **floating chat window** appears (press again to hide)
* Runs quietly in the background with a **tray/menu bar icon** fallback
* Lets you chat with **Phi-3.5-mini locally/offline**
* Optionally switch to **OpenAI, Claude, Grok, or DeepSeek** if you add an API key

---

## Features

* **Global keyboard shortcut** to show/hide the window — rebindable in Settings
* **Breathe**: ibia fades itself in right beside your cursor — on whichever monitor, app, Space or fullscreen window you're in — waits, then fades out again, so it can appear without any keypress. Hover it and it stays put; click away after using it and it goes back to breathing. The fade timings are yours to set
* **Floating UI**: movable, resizable, frameless
* **Background mode** with **tray/menu bar icon**
* **Pluggable AI providers**

  * **Local (Default): Phi-3.5-mini**
  * **Cloud providers (Optional):** OpenAI, Claude, Grok, and DeepSeek via API key in Settings
* **Simple packaging** with `electron-builder` (Windows installer and macOS app/DMG targets)

---

## Requirements

* Windows 10/11 or macOS
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

## Build (macOS App/DMG)

macOS artifacts must be built on macOS:

```bash
npm install
node scripts/generate_icon.js
npm run dist:mac
```

This produces `.dmg` and `.zip` for both **Apple Silicon (arm64)** and **Intel (x64)** in `dist/`. The macOS build is feature-identical to Windows: same chat, providers, library, history, tray/menu-bar icon, global shortcut, and Breathe. Two mac-specific details: the window uses the inset traffic-light title bar, and it is set to appear on every Space including over fullscreen apps, so Breathe can still reach you.

Document extraction shells out to `python3` (`brew install python`, or the python.org installer). Without it, ibia still chats — only PDF/Office extraction is unavailable.

See `MACOS_BUILD.md` for local testing, signing, and notarization notes.

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

## How ibia Appears

Open **Settings → How ibia appears** and pick one of three:

| Mode | Behaviour |
| --- | --- |
| **Shortcut keys only** | Classic launcher. Press the hotkey to show or hide ibia. |
| **Breathe only** | No global hotkey at all. ibia fades in on its own, stays for a while, fades out, and repeats. |
| **Shortcut keys + Breathe** | Both, and the default. |

* **Shortcut keys** — click the shortcut field and press the combination you want (at least one of Ctrl / Alt / Shift / Cmd plus a key). If another app already owns it, ibia says so and keeps the previous one. **Reset** restores the default (`Ctrl+Alt+I` on Windows, `Cmd+Shift+I` on macOS).
* **Stays visible for** — how long ibia holds at full opacity before fading out (default 5 seconds).
* **Stays away for** — how long it waits, hidden, before fading back in (default 5 seconds).

While ibia is breathing it stays out of your way: the window is click-through and never steals focus. Put the cursor over it and it fades straight back to full and holds there until you move away. Click or type in it and breathing stops entirely until you hide the window again. The same choices are on the tray/menu-bar icon's right-click menu.

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

* **Hotkey doesn’t work:** another app is probably holding it. Rebind it in **Settings → How ibia appears → Shortcut keys**, or switch to Breathe.
* **ibia keeps appearing on its own:** that's Breathe. Set **Appear with** to *Shortcut keys only* in Settings, or from the tray icon menu.
* **ibia appeared but won't fade out:** it holds while the cursor is over it, and stops breathing once you click or type in it. Hide the window and the cycle resumes.
* **Local model not responding:** confirm your Phi-3.5-mini runtime/model path is correctly set and accessible.
* **Cloud API errors:** verify the API key, selected provider, and that your network allows outbound requests.

---

## Contact
chweyahub@gmail.com

## License

Refer to `LICENSE`.
