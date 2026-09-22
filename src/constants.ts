/**
 * Shared identifiers, storage keys and tunables for the xToken extension.
 *
 * Everything that has to stay stable across releases (command ids, storage keys)
 * lives here so that a rename in one place cannot silently orphan user data.
 */

export const EXTENSION_NAME = 'xToken'
export const EXTENSION_ID = 'xToken'
export const PUBLISHER_ID = 'xToken-dev'
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
export const STATE_ROTATION_INDEX = 'keyRotationIndex'

/** How many days of usage history are retained in globalState. */
export const USAGE_HISTORY_DAYS = 30

export const COMMANDS = {
  fetchToken: 'xToken.fetchToken',
  selectProvider: 'xToken.selectProvider',
  showToken: 'xToken.showToken',
  clearToken: 'xToken.clearToken',
  setKey: 'xToken.setKey',
  rotateKey: 'xToken.rotateKey',
  showUsage: 'xToken.showUsage',
  refreshStatus: 'xToken.refreshStatus',
  openSiteUrl: 'xToken.openSiteUrl'
} as const

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/** Configuration namespace. All contributed settings live under `xtoken.*`. */
export const CONFIG_SECTION = 'xtoken'

/**
 * Documented alias. The custom claim endpoint used to be read from this setting
 * before the configuration namespace was unified under `xtoken`.
 */
export const LEGACY_SERVER_URL_SETTING = 'xToken.serverUrl'

/** Context keys used by `when` clauses in package.json. */
export const CONTEXT_HAS_KEY = 'xtoken.hasKey'
export const CONTEXT_KEY_COUNT = 'xtoken.keyCount'
export const CONTEXT_ACTIVE_PROVIDER = 'xtoken.activeProvider'

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 20
export const MIN_REQUEST_TIMEOUT_SECONDS = 2
export const MAX_REQUEST_TIMEOUT_SECONDS = 120

export const DEFAULT_KEYS_PER_PROVIDER = 8
export const MAX_KEYS_PER_PROVIDER = 32
