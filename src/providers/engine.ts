/**
 * Provider behavior engine: verify, quota and claim.
 *
 * These flows used to live in `api.ts`. They are provider-facing behavior
 * rather than transport, so they now sit next to the provider modules that
 * consume them. Each module binds them to its own preset, which keeps the HTTP
 * plumbing shared while every provider exposes the identical method set from
 * `./provider-module`.
 */
import {
  buildHeaders,
  buildUrl,
  describePayload,
  failureToError,
  request,
  xTokenError,
  type RequestContext
} from '../api'
import { EXTENSION_NAME } from '../constants'
import type {
  ClaimRequestPayload,
  ClaimResponse,
  ProviderPreset,
  ProviderQuota,
  VerificationResult
} from '../types'
import { hostOf, readPath, toNumber } from '../utils'

/**
 * Prove that a key works by calling the provider's model listing (or key info)
 * endpoint. Providers without a verification endpoint are accepted as-is.
 */
export async function verifyProviderKey(
  preset: ProviderPreset,
  apiKey: string,
  context: RequestContext
): Promise<VerificationResult> {
  if (preset.auth.scheme === 'none')
    return { ok: true, detail: `${preset.name} does not require a credential.` }
  if (!preset.verify)
    return { ok: true, detail: `No verification endpoint for ${preset.name}; the key was stored as-is.` }

  const url = buildUrl(preset, preset.verify.path, apiKey)
  const response = await request(
    url,
    { method: preset.verify.method ?? 'GET', headers: buildHeaders(preset, apiKey, context.version) },
    context
  )
  if (!response.ok)
    return { ok: false, status: response.status, detail: describePayload(response) || `HTTP ${response.status}` }

  const models = extractModelIds(response.json)
  const quota = extractQuota(preset, response.json)
  const detail = models.length > 0
    ? `${preset.name} accepted the key (${models.length} model(s) visible).`
    : `${preset.name} accepted the key.`
  return { ok: true, status: response.status, detail, models, quota }
}

/**
 * Read a provider reported quota counter. Returns `undefined` for providers that
 * do not expose a machine readable counter (most of them), in which case callers
 * fall back to locally tracked usage.
 */
export async function fetchProviderQuota(
  preset: ProviderPreset,
  apiKey: string,
  context: RequestContext
): Promise<ProviderQuota | undefined> {
  if (!preset.quota)
    return undefined

  const url = buildUrl(preset, preset.quota.path, apiKey)
  const response = await request(
    url,
    { method: 'GET', headers: buildHeaders(preset, apiKey, context.version) },
    context
  )
  if (!response.ok)
    throw failureToError(response, `Reading the quota counter for ${preset.name}`)

  return extractQuota(preset, response.json)
}

/**
 * Ask a user supplied endpoint for a daily token. The contract is intentionally
 * forgiving: any of `token`, `key`, `apiKey`, `access_token` (optionally nested
 * under `data`) is accepted as the credential.
 */
export async function claimFromServer(
  serverUrl: string,
  payload: ClaimRequestPayload,
  context: RequestContext
): Promise<ClaimResponse> {
  const response = await request(
    serverUrl,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': `${EXTENSION_NAME}/${context.version ?? '0.0.0'}`
      },
      body: JSON.stringify(payload)
    },
    context
  )

  if (response.status === 404 || response.status === 405 || response.status === 501) {
    throw new xTokenError(
      `${hostOf(serverUrl)} does not expose a POST claim endpoint (HTTP ${response.status}).`,
      'endpoint-unsupported',
      response.status
    )
  }
  if (!response.ok)
    throw failureToError(response, `Claiming a token from ${hostOf(serverUrl)}`)

  const token = pickToken(response.json)
  if (!token)
    throw new xTokenError('The claim endpoint responded without a token field.', 'unknown', response.status)

  return {
    token,
    expiresAt: pickString(response.json, ['expiresAt', 'expires_at', 'expiry']),
    dailyLimit: toNumber(readPath(response.json, 'dailyLimit')) ?? toNumber(readPath(response.json, 'daily_limit')),
    message: pickString(response.json, ['message', 'detail'])
  }
}

/** Extract model ids from the shapes used by OpenAI/Gemini compatible APIs. */
function extractModelIds(payload: unknown): string[] {
  const containers: unknown[] = [
    readPath(payload, 'data'),
    readPath(payload, 'models'),
    readPath(payload, 'data.models')
  ]
  for (const container of containers) {
    if (!Array.isArray(container))
      continue
    const ids = container
      .map(entry => {
        if (typeof entry === 'string')
          return entry
        if (entry !== null && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          const candidate = record.id ?? record.name ?? record.slug
          return typeof candidate === 'string' ? candidate : undefined
        }
        return undefined
      })
      .filter((id): id is string => typeof id === 'string')
    if (ids.length > 0)
      return ids
  }
  return []
}

/** Build a quota object from a preset's declared JSON paths. */
function extractQuota(preset: ProviderPreset, payload: unknown): ProviderQuota | undefined {
  const spec = preset.quota
  if (!spec)
    return undefined
  const remaining = toNumber(readPath(payload, spec.remainingPath))
  const limit = spec.limitPath ? toNumber(readPath(payload, spec.limitPath)) : undefined
  const used = spec.usedPath ? toNumber(readPath(payload, spec.usedPath)) : undefined
  if (remaining === undefined && limit === undefined && used === undefined)
    return undefined
  return { remaining, limit, used, source: 'live', checkedAt: Date.now() }
}

/** Accept the several common field names used for credentials. */
function pickToken(payload: unknown): string | undefined {
  const direct = pickString(payload, ['token', 'key', 'apiKey', 'api_key', 'access_token'])
  if (direct)
    return direct
  return pickString(readPath(payload, 'data'), ['token', 'key', 'apiKey', 'api_key', 'access_token'])
}

function pickString(payload: unknown, keys: readonly string[]): string | undefined {
  if (payload === null || typeof payload !== 'object')
    return undefined
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '')
      return value.trim()
  }
  return undefined
}
