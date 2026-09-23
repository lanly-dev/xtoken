/**
 * Public and internal type contracts for xToken.
 *
 * Every `type`/`interface` declaration in the extension lives here so that
 * call sites import from a single module. Imports below are type-only and
 * therefore erased at compile time (no runtime import cycles).
 */

import type * as vscode from 'vscode'

import type { DashboardTree } from './treeview'
import type { KeyStore } from './secrets'
import type { Logger } from './logger'
import type { xTokenState } from './state'

/** Every provider xToken knows about. */
export type ProviderId =
  | 'gemini'
  | 'cerebras'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'cloudflare'
  | 'github-models'
  | 'kilo';

/**
 * `available`  - shipped and usable today.
 * `planned`    - preset is documented but fetching is not implemented yet.
 * `retired`    - provider decommissioned upstream; kept for reference.
 */
export type ProviderStatus = 'available' | 'planned' | 'retired';

/** How a credential is attached to an HTTP request. */
export type AuthScheme = 'bearer' | 'query' | 'header' | 'none';

export interface AuthShape {
  scheme: AuthScheme
  /** Header name, or query parameter name for `query`. */
  name?: string
  /** Prefix applied before the credential, e.g. `Bearer `. */
  prefix?: string
}

/** Endpoint used to prove that a stored key actually works. */
export interface VerifySpec {
  path: string
  method?: 'GET' | 'POST'
}

/** Endpoint that reports provider side quota counters. */
export interface QuotaSpec {
  path: string
  /** Dotted path into the JSON body, e.g. `data.free_model_daily_requests.remaining`. */
  remainingPath: string
  limitPath?: string
  usedPath?: string
}

/** Fully described free tier preset. */
export interface ProviderPreset {
  id: ProviderId
  name: string
  vendor: string
  status: ProviderStatus
  /** One line marketing-free summary shown in QuickPick rows. */
  summary: string
  /** Theme icon id used in QuickPick rows and dashboard labels. */
  icon: string
  baseUrl: string
  docsUrl: string
  keyUrl: string
  auth: AuthShape
  verify?: VerifySpec
  quota?: QuotaSpec
  /** Conventional environment variable name, shown as an input box hint. */
  envVar: string
  contextWindow: string
  freeRequestLimit?: number
  freeTokenLimit?: number
  rateLimit: string
  /** Caveats the user should read before trusting the headline numbers. */
  limitNote: string
  models: string[]
  /** Short "what do I do next" line for status/notification text. */
  setupHint: string
}

/** Per provider key ring persisted in Secret Storage. */
export interface KeyRing {
  [providerId: string]: string[]
}

export interface ProviderQuota {
  remaining?: number
  limit?: number
  used?: number
  /** Where the numbers came from, e.g. `live` or `estimated`. */
  source: 'live' | 'estimated'
  checkedAt: number
}

/** Result of rotating the active key for a provider. */
export interface RotationOutcome {
  /** The key that is active after rotation. */
  activeKey: string
  /** Previous active key, or `undefined` when there was no prior key. */
  previousKey?: string
  /** Human-readable note describing the rotation. */
  note: string
}

/** A single key-rotation event recorded for diagnostics. */
export interface RotationEvent {
  providerId: ProviderId
  from: string
  to: string
  reason: 'manual' | 'initial' | 'auto'
  timestamp: number
}

/** One entry from a provider's `GET /models` catalog. */
export interface ProviderModelInfo {
  /** Stable model id persisted and sent to claim endpoints, e.g. `deepseek/deepseek-r1:free`. */
  id: string
  /** Human readable name published by the provider, when it has one. */
  name?: string
  /** Context window in tokens, when the catalog reports one. */
  contextLength?: number
  /** True when the entry passes the free-tier heuristic (OpenRouter `:free` with zero pricing). */
  free: boolean
}

export interface VerificationResult {
  ok: boolean
  status?: number
  detail: string
  models?: string[]
  quota?: ProviderQuota
}

export interface ClaimResponse {
  token: string
  expiresAt?: string
  dailyLimit?: number
  message?: string
}

export interface ClaimRequestPayload {
  extension: string
  version: string
  provider: ProviderId
  providerName: string
  /** Preferred model id picked via `xToken.selectModel`, when one is set. */
  model?: string
  requestedDailyTokens?: number
  requestedDailyRequests?: number
  machineId: string
  sessionId: string
  platform: string
  locale: string
  reason: 'daily-claim' | 'manual-refresh'
  requestedAt: string
}

export type xTokenErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'rate-limited'
  | 'endpoint-unsupported'
  | 'invalid-config'
  | 'server'
  | 'unknown';

/** Shape returned from `activate()`, consumable by other extensions. */
export interface xTokenApi {
  readonly version: string
  readonly providers: ProviderPreset[]
  getActiveProvider(): ProviderId | undefined
  /** Preferred model picked via `xToken.selectModel` (defaults to the active provider). */
  getActiveModel(providerId?: ProviderId): ProviderModelInfo | undefined
  getActiveToken(): Promise<string | undefined>
  getKeyCount(): Promise<number>
  recordUsage(providerId: ProviderId, tokens?: number): Promise<ProviderUsage>
  getTodayUsage(): Record<string, ProviderUsage>
  refreshUi(): Promise<void>
}

/**
 * Usage ledger types.
 *
 * Kept type-only so every module (`state.ts`, `commands.ts`, `types.ts`
 * consumers) can import them without creating an import cycle.
 */

export interface ProviderUsage {
  requests: number
  tokens: number
}

/** Usage for a single day, keyed by provider id. */
export type DayUsage = Record<string, ProviderUsage>

/** Usage history keyed by `YYYY-MM-DD`. */
export type UsageHistory = Record<string, DayUsage>

export interface UsageSnapshot {
  date: string
  totals: ProviderUsage
  byProvider: Record<string, ProviderUsage>
  daysTracked: number
}

// ─── Configuration ────────────────────────────────────────────────────────────

export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug'

export interface xTokenConfig {
  /** Custom claim endpoint. `undefined` when unset or not a valid http(s) URL. */
  serverUrl: string | undefined
  /** Raw value as written by the user, useful for diagnostics. */
  rawServerUrl: string
  serverUrlSource: 'xtoken.serverUrl' | 'xToken.serverUrl' | 'unset'
  defaultProvider: ProviderId
  requestTimeoutMs: number
  maxKeysPerProvider: number
  autoRotateOnFailure: boolean
  dailyClaimReminder: boolean
  verifyOnStartup: boolean
  logLevel: LogLevel
  /** Ordered list of provider ids xToken should prefer when it serves requests as a
   * VS Code language model provider. Unknown or unavailable ids are ignored; an empty
   * list falls back to the catalog order of providers that have at least one stored key. */
  providerOrder: ProviderId[]
  /** Provider ids the combined LM provider is allowed to rotate among. When empty every
   * provider with a stored key is eligible. */
  allowedProviders: ProviderId[]
  /** When true the combined xToken provider describes itself with a single stable model
   * id (`xToken (rotating)`). The harness always sees the same model id; provider and key
   * rotation happen underneath. */
  mode: 'combined'
}

// ─── Activation runtime ───────────────────────────────────────────────────────

/** Collaborators built during activation and shared by every command handler. */
export interface Runtime {
  context: vscode.ExtensionContext
  logger: Logger
  state: xTokenState
  keys: KeyStore
  /** Activity-bar dashboard tree (mirrors state; refreshed on every repaint). */
  dashboard: DashboardTree
  version: string
  machineId: string
  sessionId: string
  /** Last provider reported quota counters, keyed by provider id. */
  quotaCache: Map<ProviderId, ProviderQuota>
}

export type AcquisitionSource =
  | { kind: 'claim-endpoint', host: string, expiresAt?: string, dailyLimit?: number }
  | { kind: 'provider-key', detail: string }

// ─── HTTP transport ───────────────────────────────────────────────────────────

/** Per-request options shared by every outbound HTTP call. */
export interface RequestContext {
  timeoutMs: number
  cancellationToken?: vscode.CancellationToken
  logger?: Logger
  /** Version string reported in the User-Agent header. */
  version?: string
}

/** Raw outcome of an HTTP request before it is classified into an error. */
export interface RawResponse {
  status: number
  ok: boolean
  text: string
  json: unknown
}

/** Minimal `fetch` init shape accepted by the network layer. */
export interface RequestInitLike {
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

// ─── Provider module contract ─────────────────────────────────────────────────

export interface ChatRequest {
  providerId: ProviderId
  modelId: string
  system: string[]
  user: Array<{ role: 'user', content: string }>
  temperature?: number
  maxTokens?: number
  stop?: string[] | undefined
  stream: boolean
  tools?: unknown[] | undefined
}

/**
 * Uniform contract implemented by every provider module in `src/providers`.
 *
 * Each provider owns its catalog entry (the {@link ProviderPreset} data) and
 * the complete behavior set the extension relies on: key verification, live
 * quota reading and token claiming. Call sites pick a module through
 * `src/providers/index.ts` and can then rely on this identical method set everywhere.
 */
export interface ProviderModule {
  /** Full catalog entry: URLs, auth shape, published limits and caveats. */
  readonly preset: ProviderPreset
  /** Return this provider's catalog entry. */
  getPreset(): ProviderPreset
  /** Lifecycle status of this provider's free tier. */
  getStatus(): ProviderStatus
  /** True when the fetch/verify flow ships in this release. */
  isAvailable(): boolean
  /** Prove that a stored key still works against this provider. */
  verifyKey(apiKey: string, context: RequestContext): Promise<VerificationResult>
  /** Read this provider's live quota counter, when it publishes one. */
  fetchQuota(apiKey: string, context: RequestContext): Promise<ProviderQuota | undefined>
  /** List the models this provider exposes on its `GET /models` catalog. */
  listModels(apiKey: string | undefined, context: RequestContext): Promise<ProviderModelInfo[]>
  /** Claim a fresh token for this provider from the configured xToken server. */
  claim(serverUrl: string, payload: ClaimRequestPayload, context: RequestContext): Promise<ClaimResponse>
  /** Combined model id this provider contributes when the xToken LM provider is in
   * combined mode, e.g. `"xToken (Gemini)"` or `"xToken (OpenRouter)"`. Return `undefined`
   * when the provider should not be surfaced as a distinct identity. */
  modelIdForCombinedMode?(): string
  /**
   * Send an outbound chat turn through this provider with a specific key.
   * Returning without resolving signals that the provider cannot or should not
   * handle the turn (no stored key, or the backend is not chat-capable yet);
   * the combined LM provider falls back to the next eligible provider.
   */
  chat?(
    request: ChatRequest,
    onPart: (part: vscode.LanguageModelResponsePart) => void,
    token: vscode.CancellationToken
  ): Promise<void>
}

// ─── Combined-model rotation cursor ───────────────────────────────────────────

/**
 * Shared rotation state for the combined xToken language model provider.
 *
 * Persisted in `globalState` under `rotationModel` so a restart does not reset
 * which key/provider was last used for the combined model. The rotation model
 * owns the cursor for every provider that participates in combined mode: when a
 * request fails with a credential/rate-limit error the cursor advances to the
 * next stored key for that provider, and when the provider's ring is exhausted
 * the combined model falls back to the next provider in the configured order.
 * Rotations are intentionally per-session; the harness owns session lifecycle
 * and xToken simply keeps a best-effort cursor across messages.
 */
export interface RotationModelStore {
  /** Provider id that was used for the most recent successful request. */
  lastProviderId: ProviderId | undefined
  /** Per-provider cursor: index into that provider's stored key ring. */
  cursors: Record<string, number>
}

// ─── Dashboard tree ───────────────────────────────────────────────────────────

/** Collaborators the dashboard needs to render itself. */
export interface DashboardDeps {
  state: xTokenState
  keys: KeyStore
  logger: Logger
  /** Cached live quota counters keyed by provider id (owned by extension.ts). */
  quotaCache: Map<ProviderId, ProviderQuota>
}

export type DashboardNode =
  | { kind: 'summary', label: string, detail: string }
  | { kind: 'providers' }
  | {
    kind: 'provider'
    preset: ProviderPreset
    active: boolean
    keyCount: number
    requests: number
    tokens: number
    quota: ProviderQuota | undefined
    /** Model preferred via `xToken.selectModel`, when one is set. */
    model: ProviderModelInfo | undefined
  }
  | {
    kind: 'key'
    providerId: ProviderId
    masked: string
    active: boolean
    /** Preferred model for this provider, if one was picked via `xToken.selectModel`. */
    model?: ProviderModelInfo
    providerName: string
  }

// ─── QuickPick row shapes ─────────────────────────────────────────────────────

export interface ProviderPickItem extends vscode.QuickPickItem {
  presetId?: ProviderId
}

export type ProviderAction = 'fetch' | 'paste' | 'details' | 'docs'

export interface ActionItem extends vscode.QuickPickItem {
  action: ProviderAction
}

export interface ModelPickItem extends vscode.QuickPickItem {
  /** Absent or `undefined` clears the stored preference (also used by separators). */
  model?: ProviderModelInfo
}

/** What the user chose in `ui.pickModel`; `undefined` means "dismissed". */
export interface ModelSelection {
  /** The chosen model, or `undefined` when the preference should be cleared. */
  model: ProviderModelInfo | undefined
}

export interface ErrorPresentation {
  message: string
  hint?: string
  /** True when simply retrying later is a reasonable user action. */
  retryable: boolean
  /** True when the failure was a deliberate cancellation and should stay quiet. */
  quiet: boolean
}

export interface ScopeItem extends vscode.QuickPickItem {
  scope: 'all' | 'active' | 'cancel'
}

export interface UsageItem extends vscode.QuickPickItem {
  action?: 'refresh' | 'reset' | 'copy' | 'log'
  providerId?: ProviderId
}
