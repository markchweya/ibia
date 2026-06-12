# ibia App Overview

**ibia** is a lightweight Windows desktop AI assistant built for fast, everyday help without needing to keep a browser tab open. It runs quietly in the background, opens as a floating chat window from a keyboard shortcut, and lets users choose between local AI models and cloud AI providers.

The app is designed around a local-first workflow. Users can connect ibia to local AI runtimes such as Ollama or Foundry Local for private, offline-friendly conversations. When they need stronger cloud models, they can add their own API key for supported providers such as OpenAI, Claude, Grok, or DeepSeek.

ibia is useful for quick writing help, summarizing notes, asking coding questions, studying documents, rewriting text, brainstorming ideas, and getting AI assistance while working in other apps. Because it behaves like a small desktop companion, users can bring it up when needed, hide it when done, and continue working without switching contexts.

## Key Features

- **Floating desktop chat:** Open or hide the assistant quickly with a global hotkey.
- **Tray background mode:** Keep ibia running quietly and accessible from the Windows tray.
- **Local AI support:** Use local models through supported runtimes for privacy-sensitive or offline work.
- **Cloud provider support:** Use OpenAI, Claude, Grok, or DeepSeek with the user's own API key.
- **Document context:** Add notes, code files, study materials, or text documents so ibia can search and use relevant context.
- **Chat history:** Continue previous conversations instead of starting from scratch each time.
- **Secure key storage:** API keys are stored locally and encrypted at rest using the operating system's secure storage through Electron safeStorage.

## Who It Is For

ibia is for Windows users who want AI assistance available at the system level. It is especially useful for students, developers, writers, researchers, and productivity-focused users who want a fast assistant that can work with both private local models and powerful cloud models.

## Privacy Model

ibia does not ship with built-in API keys. Users bring their own keys if they want cloud AI access. Local AI requests stay on the user's machine when using a local provider. Cloud requests are sent only to the provider selected by the user, using the API key they saved in the app.

## Simple Description

**ibia is a privacy-friendly Windows AI launcher that gives users a fast floating assistant powered by local or cloud AI.**
