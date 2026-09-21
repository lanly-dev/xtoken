/**
 * Configuration access for the `xtoken.*` settings namespace.
 */

import * as vscode from 'vscode'

import {
  CONFIG_SECTION,
  DEFAULT_KEYS_PER_PROVIDER,
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  LEGACY_SERVER_URL_SETTING,
  MAX_KEYS_PER_PROVIDER,
  MAX_REQUEST_TIMEOUT_SECONDS,
  MIN_REQUEST_TIMEOUT_SECONDS
} from './constants'
import { defaultProviderId, isProviderId } from './providers'
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
  usageInStatusBar: boolean
  verifyOnStartup: boolean
  logLevel: LogLevel
}

const LOG_LEVELS: readonly LogLevel[] = ['off', 'error', 'warn', 'info', 'debug']

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
    usageInStatusBar: section.get<boolean>('usageInStatusBar') ?? true,
    verifyOnStartup: section.get<boolean>('verifyOnStartup') ?? false,
    logLevel: LOG_LEVELS.includes(rawLogLevel as LogLevel) ? (rawLogLevel as LogLevel) : 'info'
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

/** True when the user asked xToken to talk to a custom endpoint. */
export function hasCustomEndpoint(config: xTokenConfig): boolean {
  return config.serverUrl !== undefined
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
