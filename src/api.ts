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
import type { ProviderPreset, xTokenErrorCode } from './types'
import { errorMessage, hostOf, truncate } from './utils'

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
export async function request(url: string, init: RequestInitLike, context: RequestContext): Promise<RawResponse> {
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
export function describePayload(response: RawResponse): string {
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

export function buildUrl(preset: ProviderPreset, path: string, apiKey: string | undefined): string {
  const base = preset.baseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  const parameter = preset.auth.name
  if (preset.auth.scheme === 'query' && parameter && apiKey)
    url.searchParams.set(parameter, apiKey)
  return url.toString()
}

export function buildHeaders(
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
