/**
 * Shared identifiers, storage keys and tunables for the xToken extension.
 *
 * Everything that has to stay stable across releases (command ids, storage keys)
 * lives here so that a rename in one place cannot silently orphan user data.
 */

import type { ProviderId } from './types'

export const EXTENSION_NAME = 'xToken'
export const OUTPUT_CHANNEL_NAME = 'xToken'

/**
 * SecretStorage key that always holds the *active* token, regardless of which
 * provider it belongs to.
 */
export const SECRET_ACTIVE_TOKEN = 'xToken_api_key'

/** SecretStorage key holding the per-provider key ring (JSON encoded). */
export const SECRET_KEY_RING = 'xToken_api_key_ring'

/** globalState keys. Kept unqualified for backwards compatibility. */
export const STATE_LAST_CLAIM_DATE = 'lastClaimDate'
export const STATE_ACTIVE_PROVIDER = 'activeProvider'
export const STATE_USAGE = 'usageByDate'
/** Per-provider preferred model picks (`Record<ProviderId, ProviderModelInfo>`). */
export const STATE_PREFERRED_MODELS = 'preferredModels'
/** Legacy manual-rotation cursor; only cleared in `resetSession` now. */
export const STATE_ROTATION_INDEX = 'keyRotationIndex'
/** globalState key for the combined language model provider's rotation cursor. */
export const STATE_ROTATION_MODEL = 'rotationModel'
/** Shared rotation state for the combined xToken language model provider.

 * Persisted in `globalState` under `rotationModel` so a restart does not reset
 * which key/provider was last used for the combined model. The rotation model
 * owns the cursor for every provider that participates in combined mode: when a
 * request fails with a credential/rate-limit error the cursor advances to the
 * next stored key for that provider, and when the provider's ring is exhausted
 * the combined model falls back to the next provider in the configured order.
 * Rotations are intentionally per-session; the harness owns session lifecycle
 * and xToken simply keeps a best-effort cursor across messages.
 */
export interface RotationModelStore {
  /** Provider id that was used for the most recent successful request. */
  lastProviderId: ProviderId | undefined
  /** Per-provider cursor: index into that provider's stored key ring. */
  cursors: Record<string, number>
}

export class RotationModel {
  constructor(
    private readonly state: {
      getRotationModel: () => Promise<RotationModelStore | undefined>
      writeRotationModel: (store: RotationModelStore) => Promise<void>
    },
    private readonly keys: { listKeys: (providerId: ProviderId) => Promise<string[]> },
    private readonly logger: { debug: (message: string) => void }
  ) {}

  /** The provider id and key index to try first for the next combined request. */
  async currentCandidate(
    order: ProviderId[],
    allowed: ProviderId[]
  ): Promise<{ providerId: ProviderId, keyIndex: number } | undefined> {
    const store = await this.readStore()
    // Start from the last successful provider if it still has eligible keys.
    const start = store.lastProviderId && allowed.includes(store.lastProviderId)
      ? store.lastProviderId
      : undefined
    const ordered = start
      ? order.filter(id => id === start || id !== start)
      : order
    for (const providerId of ordered) {
      if (!allowed.includes(providerId))
        continue
      const ring = await this.keys.listKeys(providerId)
      if (ring.length === 0)
        continue
      const cursor = store.cursors[providerId] ?? 0
      const index = cursor % ring.length
      return { providerId, keyIndex: index }
    }
    return undefined
  }

  /** Record a successful request on `providerId` at `keyIndex`. */
  async recordSuccess(providerId: ProviderId, keyIndex: number): Promise<void> {
    const store = await this.readStore()
    store.lastProviderId = providerId
    store.cursors[providerId] = keyIndex
    await this.state.writeRotationModel(store)
    this.logger.debug(`RotationModel: pinned ${providerId} at key index ${keyIndex}`)
  }

  /** Advance the cursor for `providerId` when its current key is exhausted.
   * When the ring is fully exhausted, the caller should fall back to the next
   * provider in the configured order — this method does not pick that fallback. */
  async advanceCursor(providerId: ProviderId): Promise<number | undefined> {
    const store = await this.readStore()
    const ring = await this.keys.listKeys(providerId)
    if (ring.length === 0) {
      store.cursors[providerId] = 0
      await this.state.writeRotationModel(store)
      return undefined
    }
    const next = ((store.cursors[providerId] ?? 0) + 1) % ring.length
    store.cursors[providerId] = next
    await this.state.writeRotationModel(store)
    this.logger.debug(`RotationModel: advanced ${providerId} to key index ${next}`)
    return next
  }

  private async readStore(): Promise<RotationModelStore> {
    const raw = await this.state.getRotationModel()
    if (!raw)
      return { lastProviderId: undefined, cursors: {} }

    if (typeof raw.lastProviderId === 'string' && ALL_IDS.includes(raw.lastProviderId)) {
      // Safety: only keep known ids.
      const known = ALL_IDS.includes(raw.lastProviderId) ? raw.lastProviderId : undefined
      return {
        lastProviderId: known,
        cursors: typeof raw.cursors === 'object' && raw.cursors !== null
          ? (raw.cursors as Record<string, number>)
          : {}
      }
    }
    return { lastProviderId: undefined, cursors: {} }
  }
}

const ALL_IDS: readonly ProviderId[] = [
  'gemini', 'cerebras', 'openrouter', 'groq', 'mistral', 'cloudflare', 'github-models', 'kilo'
] as const

/** How many days of usage history are retained in globalState. */
export const USAGE_HISTORY_DAYS = 30

export const COMMANDS = {
  fetchToken: 'xToken.fetchToken',
  selectProvider: 'xToken.selectProvider',
  selectModel: 'xToken.selectModel',
  showToken: 'xToken.showToken',
  clearToken: 'xToken.clearToken',
  setKey: 'xToken.setKey',
  showUsage: 'xToken.showUsage',
  refreshStatus: 'xToken.refreshStatus',
  openSiteUrl: 'xToken.openSiteUrl'
} as const


/** Configuration namespace. All contributed settings live under `xtoken.*`. */
export const CONFIG_SECTION = 'xtoken'

/** Configuration keys for the combined VS Code language model provider. */
export const LM_CONFIG_SECTION = `${CONFIG_SECTION}.lm`

export const ALLOWED_PROVIDERS_KEY = `${LM_CONFIG_SECTION}.allowedProviders`
export const PROVIDER_ORDER_KEY = `${LM_CONFIG_SECTION}.providerOrder`

/**
 * Documented alias. The custom claim endpoint used to be read from this setting
 * before the configuration namespace was unified under `xtoken`.
 */
export const LEGACY_SERVER_URL_SETTING = 'xToken.serverUrl'

/** Context keys used by `when` clauses in package.json. */
export const CONTEXT_HAS_KEY = 'xtoken.hasKey'
export const CONTEXT_ACTIVE_PROVIDER = 'xtoken.activeProvider'

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 20
export const MIN_REQUEST_TIMEOUT_SECONDS = 2
export const MAX_REQUEST_TIMEOUT_SECONDS = 120

export const DEFAULT_KEYS_PER_PROVIDER = 8
export const MAX_KEYS_PER_PROVIDER = 32
