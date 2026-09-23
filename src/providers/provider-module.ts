/**
 * Uniform contract implemented by every provider module in this folder.
 *
 * Each provider owns its catalog entry (the {@link ProviderPreset} data) and
 * the complete behavior set the extension relies on: key verification, live
 * quota reading and token claiming. Call sites pick a module through
 * `./index.ts` and can then rely on this identical method set everywhere.
 */
import type { RequestContext } from '../api'
import type * as vscode from 'vscode'
import type {
  ClaimRequestPayload,
  ClaimResponse,
  ProviderId,
  ProviderModelInfo,
  ProviderPreset,
  ProviderQuota,
  ProviderStatus,
  VerificationResult
} from '../types'

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
