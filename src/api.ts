/**
 * Network layer for xToken.
 *
 * Uses the native Node.js `fetch` (Node 18+/Electron) with explicit timeouts and
 * cancellation support, and classifies every failure into a `xTokenErrorCode`
 * so the UI can react appropriately.
 */
import type * as vscode from 'vscode'

import { EXTENSION_NAME } from './constants'
import type { Logger } from './logger'
import type {
  ClaimRequestPayload,
  ClaimResponse,
  ProviderPreset,
  ProviderQuota,
  xTokenErrorCode,
  VerificationResult
} from './types'
import { errorMessage, hostOf, readPath, toNumber, truncate } from './utils'

/** Error carrying a machine readable classification of the failure. */
export class xTokenError extends Error {
  constructor(
    message: string,
    readonly code: xTokenErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = 'xTokenError'
  }
}

export interface RequestContext {
  timeoutMs: number
  cancellationToken?: vscode.CancellationToken
  logger?: Logger
  /** Version string reported in the User-Agent header. */
  version?: string
}

interface RawResponse {
  status: number
  ok: boolean
  text: string
  json: unknown
}

interface RequestInitLike {
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

/**
 * Perform an HTTP request and decode the body defensively: a JSON body is
 * optional, and a non-JSON body is surfaced as text for error reporting.
 */
async function request(url: string, init: RequestInitLike, context: RequestContext): Promise<RawResponse> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, context.timeoutMs)
  const cancellationListener = context.cancellationToken?.onCancellationRequested(() => controller.abort())

  context.logger?.debug(`HTTP ${init.method} ${url}`)
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal
    })
    const text = await response.text()
    let json: unknown
    if (text !== '') {
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
    }
    context.logger?.debug(`HTTP ${response.status} ${init.method} ${url}`)
    return { status: response.status, ok: response.ok, text, json }
  } catch (error) {
    if (context.cancellationToken?.isCancellationRequested)
      throw new xTokenError('Request cancelled by the user.', 'cancelled')
    if (timedOut) {
      throw new xTokenError(
        `Request to ${hostOf(url)} timed out after ${Math.round(context.timeoutMs / 1000)}s.`,
        'timeout'
      )
    }
    throw new xTokenError(`Could not reach ${hostOf(url)}: ${errorMessage(error)}`, 'network')
  } finally {
    clearTimeout(timer)
    cancellationListener?.dispose()
  }
}

/** Map an HTTP status onto a xToken error code. */
function classifyStatus(status: number): xTokenErrorCode {
  if (status === 401 || status === 403)
    return 'unauthorized'
  if (status === 404 || status === 405 || status === 501)
    return 'endpoint-unsupported'
  if (status === 429)
    return 'rate-limited'
  if (status >= 500)
    return 'server'
  return 'unknown'
}

/** Short, human readable description of an error payload. */
function describePayload(response: RawResponse): string {
  const json = response.json
  if (json !== null && typeof json === 'object') {
    const record = json as Record<string, unknown>
    const errorField = record.error
    if (typeof errorField === 'string')
      return truncate(errorField, 160)
    if (errorField !== null && typeof errorField === 'object') {
      const nested = errorField as Record<string, unknown>
      const nestedMessage = nested.message ?? nested.detail ?? nested.code
      if (nestedMessage !== undefined)
        return truncate(String(nestedMessage), 160)
    }
    const direct = record.message ?? record.detail ?? record.error_description
    if (direct !== undefined)
      return truncate(String(direct), 160)
  }
  return truncate(response.text, 160)
}

/** Build the xTokenError that best describes a failed HTTP response. */
export function failureToError(response: RawResponse, action: string): xTokenError {
  const detail = describePayload(response)
  const suffix = detail === '' ? '' : ` - ${detail}`
  return new xTokenError(
    `${action} failed with HTTP ${response.status}${suffix}`,
    classifyStatus(response.status),
    response.status
  )
}

/** True when the failure means "this key is not usable any more". */
export function isCredentialFailure(error: unknown): boolean {
  return error instanceof xTokenError && (error.code === 'unauthorized' || error.code === 'rate-limited')
}

function buildUrl(preset: ProviderPreset, path: string, apiKey: string | undefined): string {
  const base = preset.baseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  const parameter = preset.auth.name
  if (preset.auth.scheme === 'query' && parameter && apiKey)
    url.searchParams.set(parameter, apiKey)
  return url.toString()
}

function buildHeaders(
  preset: ProviderPreset,
  apiKey: string | undefined,
  version?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': `${EXTENSION_NAME}/${version ?? '0.0.0'}`
  }
  const scheme = preset.auth.scheme
  if ((scheme === 'bearer' || scheme === 'header') && apiKey)
    headers[(preset.auth.name ?? 'authorization').toLowerCase()] = `${preset.auth.prefix ?? ''}${apiKey}`
  return headers
}

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
