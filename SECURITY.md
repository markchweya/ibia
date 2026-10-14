# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub's [**Report a vulnerability**](https://github.com/markchweya/ibia/security/advisories/new) form (Security tab → Advisories). Include what you found, how to reproduce it, and the ibia version and OS.

What to expect:

| Step | Target |
| --- | --- |
| Acknowledgement | within 3 days |
| Initial assessment | within 7 days |
| Fix for critical/high issues | as soon as possible, normally within 30 days |

You will be credited in the release notes unless you would rather not be.

## Supported versions

Only the latest release receives security fixes. ibia has no auto-updater yet, so please update from the [Releases page](https://github.com/markchweya/ibia/releases/latest).

## How ibia protects you

**Your keys and data**
- API keys are encrypted at rest with the operating system's secure storage (Electron `safeStorage`: Keychain, DPAPI or libsecret) and are never written in plain text.
- ibia ships with no API keys, no telemetry and no analytics. Local providers (Ollama, Foundry Local) never leave your machine. Cloud requests go only to the provider you chose, with your own key.

**The app**
- The renderer runs with `contextIsolation`, the Chromium `sandbox` and no Node.js integration. It reaches the system only through a small, explicit preload API.
- A strict Content Security Policy allows only ibia's own scripts and styles and blocks all network access from the page.
- Every permission request (camera, microphone, location, notifications, USB/HID/serial devices, …) is denied, `<webview>` is blocked, and navigation away from the app or opening new windows is refused. External links open in your browser.
- ibia is kept on a supported Electron release so it gets Chromium security fixes.

**The build and release pipeline**
- Every installer is built by GitHub Actions from a tagged commit, never on a personal machine.
- Each release file carries a signed [SLSA build provenance attestation](https://github.com/markchweya/ibia/attestations), and the release notes list SHA-256 checksums.
- Every GitHub Action is pinned to a full commit SHA, workflow tokens are least-privilege, and release builds skip dependency caches.
- CodeQL, gitleaks secret scanning, dependency review, Trivy container scanning, OpenSSF Scorecard and Dependabot run continuously.

## Verifying a download

With the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify ibia-1.0.4-macOS.dmg --repo markchweya/ibia
```

A passing check proves the file was built by this repository's release workflow and has not been modified. You can also compare its SHA-256 against the checksums in the release notes:

```bash
shasum -a 256 ibia-1.0.4-macOS.dmg          # macOS / Linux
certutil -hashfile ibia-1.0.4-Windows-Setup.exe SHA256   # Windows
```
