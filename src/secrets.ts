/**
 * Key storage on top of `vscode.SecretStorage`.
 *
 * Two secrets are maintained:
 *  - `xToken_api_key`      the currently active token (plain and easy to consume)
 *  - `xToken_api_key_ring` JSON map of provider id to ordered key list, which
 *                             is what makes rotation across several free keys
 *                             from the same provider possible.
 */
import * as vscode from 'vscode'

import { MAX_KEYS_PER_PROVIDER, SECRET_ACTIVE_TOKEN, SECRET_KEY_RING } from './constants'
import type { Logger } from './logger'
import { isProviderId } from './providers'
import type { KeyRing, ProviderId } from './types'
import { maskToken } from './utils'

export interface RotationResult {
  providerId: ProviderId
  key: string
  index: number
  count: number
}

export class KeyStore {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly logger: Logger) {}

  /** The token exposed to consumers, mirrored in `xToken_api_key`. */
  async getActiveToken(): Promise<string | undefined> {
    return normalize(await this.secrets.get(SECRET_ACTIVE_TOKEN))
  }

  async getKeyRing(): Promise<KeyRing> {
    return this.readRing()
  }

  async listKeys(providerId: ProviderId): Promise<string[]> {
    return (await this.readRing())[providerId] ?? []
  }

  /** Total number of stored keys across every provider. */
  async getKeyCount(): Promise<number> {
    const ring = await this.readRing()
    return Object.values(ring).reduce((total, keys) => total + keys.length, 0)
  }

  /** Provider ids that currently have at least one stored key. */
  async providersWithKeys(): Promise<ProviderId[]> {
    const ring = await this.readRing()
    return Object.entries(ring)
      .filter(([, keys]) => keys.length > 0)
      .map(([providerId]) => providerId)
      .filter(isProviderId)
  }

  async hasAnyKey(): Promise<boolean> {
    return (await this.getKeyCount()) > 0
  }

  /**
   * Append a key to a provider's ring. Duplicates are ignored; once the ring is
   * full the oldest key is dropped so a rotation can always make progress.
   */
  async addKey(
    providerId: ProviderId,
    apiKey: string,
    maxKeys: number = MAX_KEYS_PER_PROVIDER
  ): Promise<{ added: boolean, count: number }> {
    const key = apiKey.trim()
    if (key === '')
      throw new Error('Refusing to store an empty API key.')
    const ring = await this.readRing()
    const existing = [...(ring[providerId] ?? [])]
    if (existing.includes(key)) {
      this.logger.debug(`Key ${maskToken(key)} is already stored for ${providerId}`)
      return { added: false, count: existing.length }
    }
    if (existing.length >= maxKeys) {
      const dropped = existing.shift()
      this.logger.warn(
        `Key ring for ${providerId} is full (${maxKeys}); dropped oldest key ${dropped ? maskToken(dropped) : '?'}`
      )
    }
    existing.push(key)
    ring[providerId] = existing
    await this.writeRing(ring)
    return { added: true, count: existing.length }
  }

  /** Remove one key from a provider's ring. Returns true when it existed. */
  async removeKey(providerId: ProviderId, apiKey: string): Promise<boolean> {
    const key = apiKey.trim()
    const ring = await this.readRing()
    const existing = ring[providerId] ?? []
    const next = existing.filter(candidate => candidate !== key)
    if (next.length === existing.length)
      return false
    if (next.length === 0)
      delete ring[providerId]
    else
      ring[providerId] = next
    await this.writeRing(ring)
    return true
  }

  /**
   * Make a key the active token. The key is added to the provider's ring when it
   * is not there yet, and the ring index is returned so the caller can persist the
   * rotation cursor.
   */
  async setActive(providerId: ProviderId, apiKey: string, maxKeys?: number): Promise<number> {
    const key = apiKey.trim()
    await this.addKey(providerId, key, maxKeys)
    await this.secrets.store(SECRET_ACTIVE_TOKEN, key)
    const index = (await this.listKeys(providerId)).indexOf(key)
    this.logger.info(`Active token set for ${providerId}: ${maskToken(key)}`)
    return index < 0 ? 0 : index
  }

  /** Activate the key at `index`, wrapping around the ring. */
  async activateIndex(providerId: ProviderId, index: number): Promise<RotationResult | undefined> {
    const keys = await this.listKeys(providerId)
    if (keys.length === 0)
      return undefined
    const normalized = ((index % keys.length) + keys.length) % keys.length
    const key = keys[normalized]
    await this.secrets.store(SECRET_ACTIVE_TOKEN, key)
    this.logger.info(`Rotated ${providerId} to key ${normalized + 1}/${keys.length} (${maskToken(key)})`)
    return { providerId, key, index: normalized, count: keys.length }
  }

  /** Advance to the next key in the ring, starting from `fromIndex`. */
  async rotate(providerId: ProviderId, fromIndex: number): Promise<RotationResult | undefined> {
    return this.activateIndex(providerId, fromIndex + 1)
  }

  /** Forget every key for one provider. Returns how many were removed. */
  async clearProvider(providerId: ProviderId): Promise<number> {
    const ring = await this.readRing()
    const removed = ring[providerId]?.length ?? 0
    delete ring[providerId]
    await this.writeRing(ring)
    if (removed > 0)
      await this.secrets.delete(SECRET_ACTIVE_TOKEN)
    this.logger.info(`Removed ${removed} key(s) for ${providerId}`)
    return removed
  }

  /** Forget every stored key, including the mirrored active token. */
  async clearAll(): Promise<number> {
    const ring = await this.readRing()
    const removed = Object.values(ring).reduce((total, keys) => total + keys.length, 0)
    await this.secrets.delete(SECRET_KEY_RING)
    await this.secrets.delete(SECRET_ACTIVE_TOKEN)
    this.logger.info(`Removed ${removed} stored key(s) from Secret Storage`)
    return removed
  }

  private async readRing(): Promise<KeyRing> {
    const raw = await this.secrets.get(SECRET_KEY_RING)
    if (!raw)
      return {}
    try {
      return sanitizeRing(JSON.parse(raw))
    } catch (error) {
      this.logger.warn('Stored key ring could not be parsed and was ignored', error)
      return {}
    }
  }

  private async writeRing(ring: KeyRing): Promise<void> {
    const sanitized = sanitizeRing(ring)
    if (Object.keys(sanitized).length === 0) {
      await this.secrets.delete(SECRET_KEY_RING)
      return
    }
    await this.secrets.store(SECRET_KEY_RING, JSON.stringify(sanitized))
  }
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Defensive parse: only keep known provider ids with non-empty string keys. */
function sanitizeRing(input: unknown): KeyRing {
  if (input === null || typeof input !== 'object')
    return {}
  const ring: KeyRing = {}
  for (const [providerId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isProviderId(providerId) || !Array.isArray(value))
      continue
    const keys = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(entry => entry !== '')
    if (keys.length > 0)
      ring[providerId] = Array.from(new Set(keys))
  }
  return ring
}
