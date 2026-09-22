/**
 * Uniform contract implemented by every provider module in this folder.
 *
 * Each provider owns its catalog entry (the {@link ProviderPreset} data) and
 * the complete behavior set the extension relies on: key verification, live
 * quota reading and token claiming. Call sites pick a module through
 * `./index.ts` and can then rely on this identical method set everywhere.
 */
import type { RequestContext } from '../api'
import type {
  ClaimRequestPayload,
  ClaimResponse,
  ProviderModelInfo,
  ProviderPreset,
  ProviderQuota,
  ProviderStatus,
  VerificationResult
} from '../types'

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
}
