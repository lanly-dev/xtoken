# xToken agent instructions — combined VS Code LM provider with key rotation

This doc is the working plan and reference for the combined language-model-provider feature.

## 1. Feature summary

xToken can serve as a **single combined VS Code language model** (manifest-declared,
`xToken (rotating)`) that routes chat/tool requests across multiple free-tier
provider backends and rotates keys automatically when a backend refuses a request
(HTTP 401/403/429) or exhausts its stored keys.

Goal:
- One model id exposed to VS Code's chat/agent harness (`xToken (rotating)`).
- Requests are fulfilled by trying providers in a user-configurable order.
- Within a provider, keys rotate across the stored ring on credential/rate-limit failures.
- When a provider's ring is exhausted, the request falls back to the next provider in
  the configured order.
- The preferred model picked via `xToken.selectModel` is forwarded per provider when
  that provider is used for a combined request.

Current state bucketed:
- Already in place:
  - `RotationModelStore` + `RotationModel` in `src/constants.ts`
  - `STATE_ROTATION_MODEL` global-state key
  - `xTokenState.getRotationModel()` / `writeRotationModel()`
  - Config fields `providerOrder`, `allowedProviders`, `mode: 'combined'` in `src/config.ts`
  - `ProviderModule.chat?(...)` and `modelIdForCombinedMode?()` in `src/providers/provider-module.ts`
  - `src/lm-chat.ts` exists with `translateChatRequest(...)` helpers only
- Not yet implemented:
  - No `ChatProvider` class implementing `LanguageModelChatProvider`
  - No `contributes.languageModelChatProviders` entry in `package.json`
  - No provider `chat()` implementations
  - `extension.ts` references `onConfigChange`, `onSecretsChange`, `dashboardView`,
    and `ch` without defining them

---

## 2. Not-yet-implemented work, in dependency order

These steps must be done in roughly this order because each depends on the previous
types/runtime existing.

### Step A — Fix the broken extension wiring in `src/extension.ts`

The file imports and uses several symbols that do not exist in it yet:
- `onConfigChange`
- `onSecretsChange`
- `dashboardView`
- `ch` (the LM provider registration disposable)

Before writing the LM provider, make the extension compile and activate cleanly.

Concrete actions:
- Define or import the missing disposables/event listeners, or remove references if they
  are placeholders from an unfinished session.
- Ensure `lm.registerLanguageModelProvider(...)` is only called when a real
  `ChatProvider` class exists.
- Keep the existing command registrations (`d1`..`d9`) intact.

Acceptance:
- `npm run check-types` passes
- `npm run lint` passes
- The extension can activate without throwing during startup

### Step B — Decide the exact `LanguageModelChatRequest` / `LanguageModelChatResponsePart`
shapes used by the combined provider

The combined provider must accept the VS Code LM chat request types and forward them to
provider backends. Read the real VS Code types instead of guessing:
- `LanguageModelChatProvider`
- `LanguageModelChatRequestMessage` union
- `LanguageModelChatRequestOptions`
- `LanguageModelChatResponsePart` union
- `LanguageModelChatInformation`
- `lm.registerLanguageModelProvider(...)`
