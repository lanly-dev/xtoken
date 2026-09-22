/**
 * Public and internal type contracts for xToken.
 */
import type { ProviderUsage } from './types-usage'

export type { ProviderUsage, DayUsage, UsageHistory, UsageSnapshot } from './types-usage'

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
  getActiveToken(): Promise<string | undefined>
  getKeyCount(): Promise<number>
  recordUsage(providerId: ProviderId, tokens?: number): Promise<ProviderUsage>
  getTodayUsage(): Record<string, ProviderUsage>
  refreshUi(): Promise<void>
}
