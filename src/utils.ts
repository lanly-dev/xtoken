/**
 * Dependency free helpers shared by the rest of the extension.
 */

import type { ProviderPreset } from './types'

/** Local-time `YYYY-MM-DD` key. */
export function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
/** Today's local-time `YYYY-MM-DD` key. */
export function todayKey(): string {
  return dateKey(new Date())
}

/** Number of whole days between two `YYYY-MM-DD` keys (a - b). */
export function daysBetween(a: string, b: string): number {
  const first = Date.parse(`${a}T00:00:00`)
  const second = Date.parse(`${b}T00:00:00`)
  if (Number.isNaN(first) || Number.isNaN(second))
    return Number.NaN
  return Math.round((first - second) / 86_400_000)
}

/**
 * Redact the middle of a credential so it can be shown in a notification or a log
 * line without exposing the whole secret. Short values are fully masked.
 */
export function maskToken(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length <= 8)
    return '\u2022'.repeat(Math.max(trimmed.length, 4))
  return `${trimmed.slice(0, 4)}\u2026${trimmed.slice(-4)}`
}

/** Human readable integer with thousands separators. */
export function formatCount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value))
    return 'n/a'
  return value.toLocaleString('en-US')
}

/** Compact text summarising a quota object, used in tooltips and QuickPick rows. */
export function describeQuota(remaining: number | undefined, limit: number | undefined): string {
  if (remaining === undefined && limit === undefined)
    return 'quota unavailable'
  if (remaining === undefined)
    return `limit ${formatCount(limit)}`
  if (limit === undefined)
    return `${formatCount(remaining)} remaining`
  return `${formatCount(remaining)} of ${formatCount(limit)} left`
}

/** Short human label for a preset's published free ceiling. */
export function describeFreeTier(preset: ProviderPreset): string {
  const parts: string[] = []
  if (preset.freeRequestLimit !== undefined)
    parts.push(`${formatCount(preset.freeRequestLimit)} req/day`)
  if (preset.freeTokenLimit !== undefined)
    parts.push(`${formatCount(preset.freeTokenLimit)} tokens/day`)
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'no published daily ceiling'
}

/** Truncate long provider or HTTP payloads for log lines. */
export function truncate(text: string, maxLength = 240): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}\u2026`
}

/** Best effort message extraction from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return String(error)
}

/** Read a dotted path out of a decoded JSON payload. */
export function readPath(payload: unknown, path: string): unknown {
  let current: unknown = payload
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object')
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Coerce an unknown JSON value into a finite number when possible. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Accept only absolute http(s) endpoints. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Host name of a URL, or the raw string when it cannot be parsed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

