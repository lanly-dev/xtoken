/**
 * Provider catalog: one module per provider, aggregated into the lists and
 * lookups the rest of the extension consumes.
 *
 * The entries used to live inline in `src/providers.ts`; each one now sits in
 * its own sibling file and exposes the uniform {@link ProviderModule} method
 * set. The public surface below is unchanged, so importers keep using
 * `from './providers'`.
 */
import { cerebras } from './cerebras'
import { cloudflare } from './cloudflare'
import { gemini } from './gemini'
import { githubModels } from './github-models'
import { groq } from './groq'
import { kilo } from './kilo'
import { mistral } from './mistral'
import { openrouter } from './openrouter'
import type { ProviderId, ProviderModule, ProviderPreset } from '../types'

/**
 * Providers with a working fetch/verify path in this release (1-5), followed by
 * the presets that ship as documented metadata for the next iteration (6-8).
 * Order matters: it drives the dashboard and the usage report.
 */
const MODULES: readonly ProviderModule[] = [
  gemini,
  cerebras,
  openrouter,
  groq,
  mistral,
  cloudflare,
  githubModels,
  kilo
]

/** Every provider xToken knows about, in listing order. */
export const PROVIDERS: readonly ProviderPreset[] = MODULES.map(entry => entry.getPreset())

/** Providers whose fetch/verify flow is implemented in this release. */
export const AVAILABLE_PROVIDERS: readonly ProviderPreset[] = MODULES.filter(entry => entry.isAvailable()).map(
  entry => entry.getPreset()
)

/** Presets shipped as documentation only until the next iteration. */
export const UPCOMING_PROVIDERS: readonly ProviderPreset[] = MODULES.filter(entry => !entry.isAvailable()).map(
  entry => entry.getPreset()
)

const MODULE_INDEX = new Map<string, ProviderModule>(MODULES.map(entry => [entry.preset.id, entry]))

/** Look up a provider module by id. */
export function getModule(id: string | undefined): ProviderModule | undefined {
  return id ? MODULE_INDEX.get(id) : undefined
}

/** Module lookup for call sites where the id is known to be valid. */
export function requireModule(id: ProviderId): ProviderModule {
  const entry = MODULE_INDEX.get(id)
  if (!entry)
    throw new Error(`Unknown xToken provider: ${id}`)
  return entry
}

/** Look up a preset by id. */
export function getProvider(id: string | undefined): ProviderPreset | undefined {
  return getModule(id)?.preset
}

/** Lookup for call sites where the id is known to be valid. */
export function requireProvider(id: ProviderId): ProviderPreset {
  return requireModule(id).preset
}

/** True when `value` is a provider id known to this build. */
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && MODULE_INDEX.has(value)
}

/** Default provider used when nothing has been configured or selected yet. */
export function defaultProviderId(): ProviderId {
  return 'gemini'
}
