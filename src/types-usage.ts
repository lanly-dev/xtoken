/**
 * Usage ledger types. Kept in a leaf module so that both `types.ts` and
 * `state.ts` can depend on them without creating an import cycle.
 */

export interface ProviderUsage {
  requests: number
  tokens: number
}

/** Usage for a single day, keyed by provider id. */
export type DayUsage = Record<string, ProviderUsage>

/** Usage history keyed by `YYYY-MM-DD`. */
export type UsageHistory = Record<string, DayUsage>

export interface UsageSnapshot {
  date: string
  totals: ProviderUsage
  byProvider: Record<string, ProviderUsage>
  daysTracked: number
}
