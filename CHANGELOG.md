# Change Log

All notable changes to the **xToken** extension are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Inline `$(add)` button on every provider row of the dashboard; it runs
  `xToken.setKey` for that provider directly, no picker needed. Keyless
  providers render as leaf rows and expand into one child per stored key
  (masked, marked active) once a key has been added.

### Removed

- The right-aligned status bar item (`$(key) xToken: Active` /
  `$(warning) xToken: No Key`) together with its tooltip and busy spinner.
- The `xtoken.usageInStatusBar` setting, which only fed the status bar label.
- Manual key rotation: the `xToken.rotateKey` command, its inline `$(refresh)`
  button on active provider rows, and the **Rotate Key** actions in the
  store-key toast and startup-verification dialog. Rotation is automated only,
  driven by `xtoken.autoRotateOnFailure` (default on).
- The exported API method `rotateKey()` from `xTokenApi`.
- The `xtoken.keyCount` context key, which only gated `xToken.rotateKey`.
- The per-provider `keyRotationIndex` rotation cursor from `globalState`
  (existing values are still cleared by `xToken.clearToken`) and the
  `KeyStore.rotate`/`activateIndex` helpers behind it.

### Changed

- The exported API method `refreshStatusBar` was renamed to `refreshUi`; it
  still refreshes live quotas on demand, publishes the `xtoken.*` context keys
  and repaints the dashboard.
- Startup verification (`xtoken.verifyOnStartup`) now runs through the same
  automated failover as key storage: other stored keys are tried before it
  warns, and the warning offers **Replace Key** / **Select Provider** only.
- The dashboard marks the active key child by comparing it against the stored
  active token instead of assuming the first ring entry.

## [1.0.0] - 2026-09-21

### Added

- Free-tier provider catalog with pre-configured presets, documentation links and
  base URLs for Google Gemini API, Cerebras Inference, OpenRouter (`:free` models),
  Groq Cloud and Mistral AI (Experiment plan).
- Documented presets for the next iteration: Cloudflare Workers AI (10,000 free
  Neurons/day), GitHub Models (retired upstream, kept for migration reference) and
  the Kilo Code Gateway (no key required for `:free` models).
- `xToken.fetchToken`: claims a token from the custom endpoint in
  `xtoken.serverUrl`/`xToken.serverUrl`, or runs the provider guided setup
  (open console, paste key, verify over HTTPS) inside
  `vscode.window.withProgress` with cancellation support.
- `xToken.selectProvider`: QuickPick listing daily limits, base URL, docs link,
  a *Get a free key* button per row and a follow-up action menu.
- `xToken.showToken`: masked active token with **Copy to Clipboard** and a
  transient *Reveal Full Token* QuickPick.
- `xToken.clearToken`: removes keys from Secret Storage (all providers or just
  the active one), clears workspace state, the daily claim guard and usage history.
- `xToken.setKey`, `xToken.rotateKey`, `xToken.showUsage` and
  `xToken.refreshStatus` for manual key entry, key rotation across a per-provider
  ring, the daily usage ledger and on-demand quota refreshes.
- Right-aligned status bar item: `$(key) xToken: Active` /
  `$(warning) xToken: No Key`, with a rich tooltip and click-through to the
  provider QuickPick.
- Key storage in `vscode.SecretStorage` (`xToken_api_key`,
  `xToken_api_key_ring`) plus daily state in `globalState` (`lastClaimDate`,
  `activeProvider`, `keyRotationIndex`, `usageByDate`, 30 day retention).
- Live quota counters for providers that expose one (OpenRouter `free_model_daily_requests`)
  with local tracking as the fallback.
- Configuration surface under `xtoken.*`: `serverUrl`, `defaultProvider`,
  `requestTimeout`, `maxKeysPerProvider`, `autoRotateOnFailure`,
  `dailyClaimReminder`, `usageInStatusBar`, `verifyOnStartup`, `logLevel`.
- Output channel logging with masked credentials and `xToken` level gating.
- Exported API for other extensions: `recordUsage`, `getTodayUsage`,
  `getActiveToken`, `getActiveProvider`, `getKeyCount`, `rotateKey`,
  `refreshStatusBar`.
