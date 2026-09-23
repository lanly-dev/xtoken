/**
 * Configuration access for the `xtoken.*` settings namespace.
 */

import * as vscode from 'vscode'

import {
  CONFIG_SECTION,
  DEFAULT_KEYS_PER_PROVIDER,
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  LEGACY_SERVER_URL_SETTING,
  LM_CONFIG_SECTION,
  MAX_KEYS_PER_PROVIDER,
  MAX_REQUEST_TIMEOUT_SECONDS,
  MIN_REQUEST_TIMEOUT_SECONDS,
  PROVIDER_ORDER_KEY,
  ALLOWED_PROVIDERS_KEY
} from './constants'
import { defaultProviderId, isProviderId, PROVIDERS } from './providers'
import type { ProviderId } from './types'
import { isHttpUrl } from './utils'

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

const LOG_LEVELS: readonly LogLevel[] = ['off', 'error', 'warn', 'info', 'debug']

function readList(raw: unknown): ProviderId[] {
  if (!Array.isArray(raw))
    return []
  const ids: ProviderId[] = []
  for (const entry of raw as unknown[]) {
    if (isProviderId(entry) && !ids.includes(entry))
      ids.push(entry)
  }
  return ids
}

/** Ordered list of provider ids to prefer for LM requests; empty falls back to every
 * provider that has at least one stored key, in catalog order. */
function readProviderOrder(): ProviderId[] {
  return readList(vscode.workspace.getConfiguration(LM_CONFIG_SECTION).get<unknown[]>(PROVIDER_ORDER_KEY))
}

function readAllowedProviders(): ProviderId[] {
  return readList(vscode.workspace.getConfiguration(LM_CONFIG_SECTION).get<unknown[]>(ALLOWED_PROVIDERS_KEY))
}

function readMode(): xTokenConfig['mode'] {
  const raw = vscode.workspace.getConfiguration(LM_CONFIG_SECTION).get<string>('mode')
  return raw === 'combined' ? 'combined' : 'combined'
}

/** Read the whole `xtoken.*` surface in one pass. */
export function readConfig(): xTokenConfig {
  const section = vscode.workspace.getConfiguration(CONFIG_SECTION)
  const configuredProvider = section.get<string>('defaultProvider')
  const rawTimeout = section.get<number>('requestTimeout') ?? DEFAULT_REQUEST_TIMEOUT_SECONDS
  const rawLogLevel = section.get<string>('logLevel') ?? 'info'
  const serverUrl = resolveServerUrl()

  return {
    serverUrl: serverUrl.value,
    rawServerUrl: serverUrl.raw,
    serverUrlSource: serverUrl.source,
    defaultProvider: isProviderId(configuredProvider) ? configuredProvider : defaultProviderId(),
    requestTimeoutMs: clamp(rawTimeout, MIN_REQUEST_TIMEOUT_SECONDS, MAX_REQUEST_TIMEOUT_SECONDS) * 1000,
    maxKeysPerProvider: clamp(
      section.get<number>('maxKeysPerProvider') ?? DEFAULT_KEYS_PER_PROVIDER,
      1,
      MAX_KEYS_PER_PROVIDER
    ),
    autoRotateOnFailure: section.get<boolean>('autoRotateOnFailure') ?? true,
    dailyClaimReminder: section.get<boolean>('dailyClaimReminder') ?? true,
    verifyOnStartup: section.get<boolean>('verifyOnStartup') ?? false,
    logLevel: LOG_LEVELS.includes(rawLogLevel as LogLevel) ? (rawLogLevel as LogLevel) : 'info',
    providerOrder: readProviderOrder(),
    allowedProviders: readAllowedProviders(),
    mode: readMode()
  }
}

/**
 * The claim endpoint is read from `xtoken.serverUrl` and falls back to the
 * historical `xToken.serverUrl` setting so existing user configuration keeps
 * working after the namespace was unified.
 */
function resolveServerUrl(): {
  value: string | undefined
  raw: string
  source: xTokenConfig['serverUrlSource']
  } {
  const candidates: Array<{ raw: string | undefined, source: xTokenConfig['serverUrlSource'] }> = [
    { raw: vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('serverUrl'), source: 'xtoken.serverUrl' },
    { raw: vscode.workspace.getConfiguration().get<string>(LEGACY_SERVER_URL_SETTING), source: 'xToken.serverUrl' }
  ]

  for (const candidate of candidates) {
    const raw = (candidate.raw ?? '').trim()
    if (raw === '')
      continue
    return { value: isHttpUrl(raw) ? raw : undefined, raw, source: candidate.source }
  }
  return { value: undefined, raw: '', source: 'unset' }
}

/** True when a value was supplied but is not a usable URL. */
export function hasInvalidEndpoint(config: xTokenConfig): boolean {
  return config.rawServerUrl !== '' && config.serverUrl === undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value))
    return minimum
  return Math.min(Math.max(Math.round(value), minimum), maximum)
}
