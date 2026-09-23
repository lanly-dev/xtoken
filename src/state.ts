/**
 * Daily claim guard and usage ledger, persisted in `globalState`.
 *
 * Storage keys are stable: `lastClaimDate`, `activeProvider`, `usageByDate`
 * and `preferredModels`.
 * The legacy `keyRotationIndex` cursor (manual rotation) is only cleared on
 * reset. Usage is pruned to the most recent `USAGE_HISTORY_DAYS` days
 * on every write so the memento cannot grow without bound.
 */
import * as vscode from 'vscode'

import {
  STATE_ACTIVE_PROVIDER,
  STATE_LAST_CLAIM_DATE,
  STATE_PREFERRED_MODELS,
  STATE_ROTATION_INDEX,
  STATE_ROTATION_MODEL,
  STATE_USAGE,
  USAGE_HISTORY_DAYS
} from './constants'
import type { Logger } from './logger'
import { isProviderId } from './providers'
import type { ProviderId, ProviderModelInfo, ProviderUsage, UsageHistory, UsageSnapshot } from './types'
import { daysBetween, todayKey } from './utils'

const EMPTY_USAGE: ProviderUsage = { requests: 0, tokens: 0 }

export class xTokenState {
  constructor(private readonly memento: vscode.Memento, private readonly logger: Logger) {}

  /** `YYYY-MM-DD` of the last successful claim, if any. */
  get lastClaimDate(): string | undefined {
    const value = this.memento.get<string>(STATE_LAST_CLAIM_DATE)
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /** True when a claim was already recorded for `date` (defaults to today). */
  isClaimedToday(date: string = todayKey()): boolean {
    return this.lastClaimDate === date
  }

  /** Whole days since the previous claim, `undefined` when never claimed. */
  daysSinceLastClaim(): number | undefined {
    const last = this.lastClaimDate
    if (!last)
      return undefined
    const difference = daysBetween(todayKey(), last)
    return Number.isNaN(difference) ? undefined : difference
  }

  async markClaimed(date: string = todayKey()): Promise<void> {
    await this.memento.update(STATE_LAST_CLAIM_DATE, date)
    this.logger.debug(`Recorded daily claim for ${date}`)
  }

  get activeProvider(): ProviderId | undefined {
    return isProviderId(this.memento.get<string>(STATE_ACTIVE_PROVIDER))
      ? (this.memento.get<string>(STATE_ACTIVE_PROVIDER) as ProviderId)
      : undefined
  }

  async setActiveProvider(providerId: ProviderId | undefined): Promise<void> {
    await this.memento.update(STATE_ACTIVE_PROVIDER, providerId)
  }

  /** Preferred model stored for a provider via `xToken.selectModel`. */
  preferredModel(providerId: ProviderId | undefined): ProviderModelInfo | undefined {
    if (!providerId)
      return undefined
    const stored = this.memento.get<Record<string, ProviderModelInfo>>(STATE_PREFERRED_MODELS)
    const model = stored?.[providerId]
    return model && typeof model.id === 'string' && model.id !== '' ? model : undefined
  }

  /** Persist (or, with `undefined`, clear) the preferred model of a provider. */
  async setPreferredModel(providerId: ProviderId, model: ProviderModelInfo | undefined): Promise<void> {
    const stored = { ...(this.memento.get<Record<string, ProviderModelInfo>>(STATE_PREFERRED_MODELS) ?? {}) }
    if (model)
      stored[providerId] = model
    else
      delete stored[providerId]
    const remaining = Object.keys(stored).length > 0 ? stored : undefined
    await this.memento.update(STATE_PREFERRED_MODELS, remaining)
    this.logger.debug(
      model
        ? `Preferred model for ${providerId} set to ${model.id}`
        : `Preferred model for ${providerId} cleared`
    )
  }

  /**
   * Combined LM provider rotation cursor persisted under {@link STATE_ROTATION_MODEL}.
   */
  getRotationModel(): Promise<RotationModelStore | undefined> {
    return Promise.resolve(this.memento.get<RotationModelStore | undefined>(STATE_ROTATION_MODEL))
  }

  async writeRotationModel(store: RotationModelStore): Promise<void> {
    await this.memento.update(STATE_ROTATION_MODEL, store)
  }

  /**
   * Usage recorded for a single day.
   */
  getUsage(date: string = todayKey()): Record<ProviderId, ProviderUsage> {
    return this.usageHistory()[date] ?? {}
  }

  usageHistory(): UsageHistory {
    return this.memento.get<UsageHistory>(STATE_USAGE) ?? {}
  }

  /** Increment today's counters for a provider and return the new totals. */
  async recordRequest(providerId: ProviderId, tokens = 0): Promise<ProviderUsage> {
    const date = todayKey()
    const history = { ...this.usageHistory() }
    const day = { ...(history[date] ?? {}) }
    const previous = day[providerId] ?? EMPTY_USAGE
    const updated: ProviderUsage = {
      requests: previous.requests + 1,
      tokens: previous.tokens + Math.max(0, Math.round(tokens))
    }
    day[providerId] = updated
    history[date] = day
    await this.memento.update(STATE_USAGE, prune(history, date))
    return updated
  }

  requestsToday(providerId: ProviderId): number {
    return this.getUsage()[providerId]?.requests ?? 0
  }

  tokensToday(providerId: ProviderId): number {
    return this.getUsage()[providerId]?.tokens ?? 0
  }

  /** Aggregated view of today's usage across all providers. */
  snapshot(): UsageSnapshot {
    const history = this.usageHistory()
    const date = todayKey()
    const byProvider: Record<string, ProviderUsage> = {}
    const totals: ProviderUsage = { ...EMPTY_USAGE }
    for (const [providerId, usage] of Object.entries(history[date] ?? {})) {
      byProvider[providerId] = { ...usage }
      totals.requests += usage.requests
      totals.tokens += usage.tokens
    }
    return { date, totals, byProvider, daysTracked: Object.keys(history).length }
  }

  async resetUsage(): Promise<void> {
    await this.memento.update(STATE_USAGE, undefined)
    this.logger.info('Usage history cleared')
  }

  /** Forget the daily claim guard, the active provider and the legacy rotation cursor. */
  async resetSession(): Promise<void> {
    await this.memento.update(STATE_LAST_CLAIM_DATE, undefined)
    await this.memento.update(STATE_ACTIVE_PROVIDER, undefined)
    await this.memento.update(STATE_ROTATION_INDEX, undefined)
    await this.memento.update(STATE_ROTATION_MODEL, undefined)
    this.logger.info('Claim guard, active provider and legacy rotation cursor cleared')
  }
}

/** Drop entries older than the retention window, and any future dated junk. */
function prune(history: UsageHistory, reference: string): UsageHistory {
  const kept = Object.entries(history).filter(([date]) => {
    const age = daysBetween(reference, date)
    return !Number.isNaN(age) && age >= 0 && age < USAGE_HISTORY_DAYS
  })
  if (kept.length === Object.keys(history).length)
    return history
  return Object.fromEntries(kept)
}
