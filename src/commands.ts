/**
 * Command handlers, status-bar refresh logic and the exported extension API.
 *
 * Every `xToken.*` command is implemented in this module; `extension.ts` only
 * registers them against the command palette. All handlers share one
 * {@link Runtime} built during activation, which carries the collaborators
 * created there (logger, state, key store, status bar, dashboard).
 */
import * as vscode from 'vscode'

import {
  claimFromServer,
  fetchProviderQuota,
  xTokenError,
  verifyProviderKey,
  type RequestContext
} from './api'
import {
  CONFIG_SECTION,
  CONTEXT_ACTIVE_PROVIDER,
  CONTEXT_HAS_KEY,
  CONTEXT_KEY_COUNT,
  EXTENSION_NAME,
  LEGACY_SERVER_URL_SETTING
} from './constants'
import { readConfig, type xTokenConfig } from './config'
import type { DashboardNode, DashboardTree } from './treeview'
import type { Logger } from './logger'
import { AVAILABLE_PROVIDERS, getProvider, isProviderId, PROVIDERS, requireProvider } from './providers'
import type { KeyStore } from './secrets'
import type { StatusBarController } from './statusBar'
import type { xTokenState } from './state'
import type {
  ClaimRequestPayload,
  ProviderId,
  ProviderPreset,
  ProviderQuota,
  xTokenApi,
  VerificationResult
} from './types'
import * as ui from './ui'
import { describeFreeTier, describeQuota, formatCount, hostOf, maskToken, todayKey } from './utils'

export interface Runtime {
  context: vscode.ExtensionContext
  logger: Logger
  state: xTokenState
  keys: KeyStore
  statusBar: StatusBarController
  /** Activity-bar dashboard tree (mirrors state; refreshed on every repaint). */
  dashboard: DashboardTree
  version: string
  machineId: string
  sessionId: string
  /** Last provider reported quota counters, keyed by provider id. */
  quotaCache: Map<ProviderId, ProviderQuota>
}

type AcquisitionSource =
  | { kind: 'claim-endpoint', host: string, expiresAt?: string, dailyLimit?: number }
  | { kind: 'provider-key', detail: string }

/** Wrap a command so any unhandled rejection still reaches the user. */
export function createCommandRegistrar(rt: Runtime) {
  return (commandId: string, handler: (arg?: unknown) => Promise<void> | void): vscode.Disposable =>
    vscode.commands.registerCommand(commandId, async (arg?: unknown) => {
      rt.logger.debug(`Command ${commandId} invoked`)
      try {
        await handler(arg)
      } catch (error) {
        await reportUnexpected(rt, error, commandId)
      }
    })
}

/**
 * Open the provider's "get an API key" page in the user's browser. Invoked from
 * the inline dashboard button, so the argument is normally the provider node;
 * fall back to the active provider when called programmatically with an id.
 */
export async function commandOpenKeyUrl(rt: Runtime, source: unknown): Promise<void> {
  const preset = isDashboardProviderNode(source)
    ? source.preset
    : getProvider(isProviderId(source) ? source : rt.state.activeProvider)
  if (!preset) {
    await vscode.window.showInformationMessage(`${EXTENSION_NAME}: pick a provider in the dashboard first.`)
    return
  }
  rt.logger.info(`Opening the ${preset.name} key page: ${preset.keyUrl}`)
  await vscode.env.openExternal(vscode.Uri.parse(preset.keyUrl))
}

/** Type guard for dashboard provider nodes passed in from tree item menus. */
function isDashboardProviderNode(value: unknown): value is Extract<DashboardNode, { kind: 'provider' }> {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'provider'
}

export function registerEventListeners(rt: Runtime): vscode.Disposable[] {
  const configuration = vscode.workspace.onDidChangeConfiguration(event => {
    const relevant = event.affectsConfiguration(CONFIG_SECTION)
      || event.affectsConfiguration(LEGACY_SERVER_URL_SETTING)
    if (!relevant)
      return
    rt.logger.setLevel(readConfig().logLevel)
    rt.logger.info('Configuration changed; repainting the status bar')
    void refreshStatusBar(rt)
  })

  const secrets = rt.context.secrets.onDidChange(event => {
    rt.logger.debug(`Secret Storage changed (${event.key})`)
    void refreshStatusBar(rt)
  })

  return [configuration, secrets]
}

/** Public surface for other extensions: `const api = await extensions.getExtension(id)?.activate()`. */
export function createApi(rt: Runtime): xTokenApi {
  return {
    version: rt.version,
    providers: [...PROVIDERS],
    getActiveProvider: () => rt.state.activeProvider,
    getActiveToken: () => rt.keys.getActiveToken(),
    getKeyCount: () => rt.keys.getKeyCount(),
    recordUsage: (providerId, tokens = 0) => rt.state.recordRequest(providerId, tokens),
    getTodayUsage: () => rt.state.getUsage(),
    rotateKey: async () => {
      const activeId = rt.state.activeProvider
      if (!activeId)
        return undefined
      const rotated = await rt.keys.rotate(activeId, rt.state.getRotationIndex(activeId))
      if (rotated) {
        await rt.state.setRotationIndex(activeId, rotated.index)
        await refreshStatusBar(rt)
      }
      return rotated?.key
    },
    refreshStatusBar: () => refreshStatusBar(rt)
  }
}

/** `xToken.selectProvider`: provider QuickPick followed by an action menu. */
export async function commandSelectProvider(rt: Runtime): Promise<void> {
  const preset = await ui.pickProvider(rt.state.activeProvider)
  if (!preset)
    return
  const stored = await rt.keys.listKeys(preset.id)
  const action = await ui.pickProviderAction(preset, stored.length > 0)
  switch (action) {
    case 'details':
      await showProviderDetails(rt, preset)
      return
    case 'docs':
      await ui.openExternal(preset.keyUrl, rt.logger)
      return
    case 'paste':
      await commandSetKey(rt, preset)
      return
    case 'fetch':
      await commandFetchToken(rt, { providerId: preset.id })
      return
    default:
      rt.logger.debug(`Provider menu dismissed for ${preset.id}`)
  }
}

/** Show the free-tier details for a preset, with links and a copy action. */
async function showProviderDetails(rt: Runtime, preset: ProviderPreset): Promise<void> {
  const lines = ui.providerDetailsLines(preset)
  rt.logger.info(`${preset.name} details:\n${lines.join('\n')}`)
  const picked = await vscode.window.showInformationMessage(
    `${preset.name}: ${describeFreeTier(preset)}. ${preset.summary}`,
    'Copy Details',
    'Open Documentation',
    'Get a Free Key'
  )
  if (picked === 'Copy Details')
    await ui.copyToClipboard(lines.join('\n'), `${preset.name} details`)
  if (picked === 'Open Documentation')
    await ui.openExternal(preset.docsUrl, rt.logger)
  if (picked === 'Get a Free Key')
    await ui.openExternal(preset.keyUrl, rt.logger)
}

/**
 * `xToken.fetchToken`.
 *
 * The provider is resolved from the explicit argument, then the active provider in
 * `globalState`, then `xtoken.defaultProvider`. Acquisition then prefers the custom
 * claim endpoint in `xtoken.serverUrl` (aliased by `xToken.serverUrl`) and falls
 * back to the provider's guided setup: open the console, paste a key, verify it
 * over HTTPS before it is stored.
 */
export async function commandFetchToken(
  rt: Runtime,
  options: { providerId?: ProviderId, force?: boolean } = {}
): Promise<void> {
  const config = readConfig()
  const preset = await resolveTargetPreset(rt, config, options.providerId)
  if (!preset)
    return

  if (preset.status !== 'available') {
    const picked = await vscode.window.showInformationMessage(
      `${EXTENSION_NAME}: ${preset.name} is not automated yet (${preset.status}).`,
      'Show Details',
      'Open Documentation'
    )
    if (picked === 'Show Details')
      await showProviderDetails(rt, preset)
    if (picked === 'Open Documentation')
      await ui.openExternal(preset.docsUrl, rt.logger)
    return
  }

  if (!options.force && config.dailyClaimReminder && rt.state.isClaimedToday()) {
    const message = [
      `${EXTENSION_NAME}: a token was already claimed today (${rt.state.lastClaimDate}).`,
      'Fetching again spends another slice of the daily free-tier budget.'
    ].join(' ')
    const picked = await vscode.window.showInformationMessage(
      message,
      'Fetch Anyway',
      'Show Usage',
      'Open Console'
    )
    if (picked === 'Show Usage') {
      await commandShowUsage(rt)
      return
    }
    if (picked === 'Open Console') {
      await ui.openExternal(preset.keyUrl, rt.logger)
      return
    }
    if (picked !== 'Fetch Anyway')
      return
  }

  rt.statusBar.setBusy(`fetching ${preset.id}`)
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${EXTENSION_NAME}: fetching a free-tier token for ${preset.name}`,
        cancellable: true
      },
      async (progress, cancellationToken) => {
        const context: RequestContext = {
          timeoutMs: config.requestTimeoutMs,
          cancellationToken,
          logger: rt.logger,
          version: rt.version
        }
        try {
          const source = await acquireToken(rt, preset, config, progress, context)
          if (!source)
            return
          await afterTokenStored(rt, preset, source)
        } catch (error) {
          const presentation = ui.presentError(error, `fetch a token for ${preset.name}`)
          if (presentation.quiet) {
            rt.logger.info(`Token fetch for ${preset.name} was cancelled by the user`)
            return
          }
          await handleFailure(rt, error, `fetch a token for ${preset.name}`, () => {
            void commandFetchToken(rt, { providerId: preset.id, force: true })
            return Promise.resolve()
          })
        }
      }
    )
  } finally {
    await refreshStatusBar(rt)
  }
}

/**
 * Acquire a credential: custom claim endpoint first, guided setup second.
 * Returns `undefined` when the user backed out and nothing should be stored.
 */
async function acquireToken(
  rt: Runtime,
  preset: ProviderPreset,
  config: xTokenConfig,
  progress: vscode.Progress<{ message?: string, increment?: number }>,
  context: RequestContext
): Promise<AcquisitionSource | undefined> {
  if (context.cancellationToken?.isCancellationRequested)
    return undefined

  if (config.serverUrl) {
    progress.report({ message: `Contacting ${hostOf(config.serverUrl)}...`, increment: 15 })
    try {
      const claimed = await claimFromServer(config.serverUrl, buildClaimPayload(rt, preset, 'daily-claim'), context)
      progress.report({ message: 'Storing the claimed token in Secret Storage...', increment: 60 })
      await storeKey(rt, preset, claimed.token, config, { markClaimed: true, recordRequest: true })
      progress.report({ message: 'Done', increment: 25 })
      return {
        kind: 'claim-endpoint',
        host: hostOf(config.serverUrl),
        expiresAt: claimed.expiresAt,
        dailyLimit: claimed.dailyLimit
      }
    } catch (error) {
      if (error instanceof xTokenError && isFatalAcquisitionError(error))
        throw error
      rt.logger.warn('The claim endpoint did not yield a token; falling back to guided setup', error)
      progress.report({ message: 'Claim endpoint unavailable - running guided setup...', increment: 5 })
    }
  }

  const step = await vscode.window.showQuickPick(
    [
      { label: '$(link-external) Open the key dashboard', description: preset.keyUrl, value: 'open' as const },
      { label: '$(key) I already have a key - paste it now', description: preset.envVar, value: 'paste' as const }
    ],
    {
      title: `${EXTENSION_NAME}: ${preset.name} - step 1 of 2`,
      placeHolder: preset.setupHint,
      ignoreFocusOut: true
    }
  )
  if (!step)
    return undefined
  if (step.value === 'open')
    await ui.openExternal(preset.keyUrl, rt.logger)

  progress.report({ message: 'Waiting for the API key...', increment: 5 })
  const apiKey = await ui.promptForApiKey(preset)
  if (!apiKey) {
    rt.logger.info(`Key entry cancelled for ${preset.name}`)
    return undefined
  }

  progress.report({ message: `Verifying the key with ${preset.name}...`, increment: 25 })
  const outcome = await verifyWithRotation(rt, preset, apiKey, context, config)
  if (!outcome.verification.ok) {
    const status = outcome.verification.status ?? 'n/a'
    const keep = await vscode.window.showWarningMessage(
      `${preset.name} did not accept the key (HTTP ${status}): ${outcome.verification.detail}`,
      {
        modal: true,
        detail: 'Store it anyway? A key that fails verification is usually rejected at inference time too.'
      },
      'Store Anyway'
    )
    if (keep !== 'Store Anyway')
      return undefined
  }

  progress.report({ message: 'Storing the key in Secret Storage...', increment: 30 })
  await storeKey(rt, preset, outcome.key, config, { markClaimed: true, recordRequest: true })
  return { kind: 'provider-key', detail: outcome.verification.detail }
}

/** Errors that must abort the fetch instead of falling back to guided setup. */
function isFatalAcquisitionError(error: xTokenError): boolean {
  return error.code === 'cancelled' || error.code === 'timeout' || error.code === 'unauthorized'
}

/** Resolve the provider to act on, asking the user only when nothing is set yet. */
async function resolveTargetPreset(
  rt: Runtime,
  config: xTokenConfig,
  explicit?: ProviderId
): Promise<ProviderPreset | undefined> {
  const fromArgument = getProvider(explicit)
  if (fromArgument)
    return fromArgument
  const active = getProvider(rt.state.activeProvider)
  if (active)
    return active
  if (await rt.keys.hasAnyKey())
    return getProvider(config.defaultProvider)
  // First run with no configuration: make the choice explicit.
  return ui.pickProvider(undefined)
}

/** Persist a credential, activate it and refresh the derived state. */
async function storeKey(
  rt: Runtime,
  preset: ProviderPreset,
  apiKey: string,
  config: xTokenConfig,
  options: { markClaimed: boolean, recordRequest?: boolean }
): Promise<void> {
  const { added, count } = await rt.keys.addKey(preset.id, apiKey, config.maxKeysPerProvider)
  const index = await rt.keys.setActive(preset.id, apiKey, config.maxKeysPerProvider)
  await rt.state.setActiveProvider(preset.id)
  await rt.state.setRotationIndex(preset.id, index)
  if (options.markClaimed)
    await rt.state.markClaimed(todayKey())
  if (options.recordRequest)
    await rt.state.recordRequest(preset.id)
  rt.logger.info(
    `${preset.name}: ${added ? 'stored a new key' : 'reused an existing key'}; `
    + `${count} key(s) on record, active index ${index + 1}`
  )
  await applyContextKeys(rt)
}

/**
 * Verify a candidate key, trying the provider's other stored keys when
 * `xtoken.autoRotateOnFailure` is enabled and the provider answered 401/403/429.
 */
async function verifyWithRotation(
  rt: Runtime,
  preset: ProviderPreset,
  apiKey: string,
  context: RequestContext,
  config: xTokenConfig
): Promise<{ key: string, verification: VerificationResult }> {
  const verification = await verifyProviderKey(preset, apiKey, context)
  if (verification.ok || !config.autoRotateOnFailure)
    return { key: apiKey, verification }

  const status = verification.status ?? 0
  const credentialProblem = status === 401 || status === 403 || status === 429
  if (!credentialProblem)
    return { key: apiKey, verification }

  for (const candidate of await rt.keys.listKeys(preset.id)) {
    if (candidate === apiKey || context.cancellationToken?.isCancellationRequested)
      continue
    rt.logger.warn(`Key ${maskToken(apiKey)} was refused; trying stored key ${maskToken(candidate)}`)
    const alternative = await verifyProviderKey(preset, candidate, context)
    if (alternative.ok) {
      await rt.keys.setActive(preset.id, candidate, config.maxKeysPerProvider)
      return { key: candidate, verification: alternative }
    }
  }
  return { key: apiKey, verification }
}

/** Report a successful acquisition and repaint every piece of UI. */
async function afterTokenStored(
  rt: Runtime,
  preset: ProviderPreset,
  source: AcquisitionSource
): Promise<void> {
  await refreshStatusBar(rt, { forceQuota: true })
  const active = await rt.keys.getActiveToken()
  const details = source.kind === 'claim-endpoint'
    ? `claimed from ${source.host}${source.expiresAt ? ` (expires ${source.expiresAt})` : ''}`
    : source.detail
  const message = [
    `${EXTENSION_NAME}: ${preset.name} is ready.`,
    `${active ? maskToken(active) : 'token'} is in Secret Storage.`,
    details
  ].join(' ')
  const picked = await vscode.window.showInformationMessage(message, 'Copy Key', 'Show Usage')
  if (picked === 'Copy Key' && active) {
    await ui.copyToClipboard(active, `${preset.name} token`)
    return
  }
  if (picked === 'Show Usage')
    await commandShowUsage(rt)
}

/** Surface a failure in the UI with actionable buttons; cancellations stay silent. */
async function handleFailure(
  rt: Runtime,
  error: unknown,
  contextLabel: string,
  retry?: () => Promise<void>
): Promise<void> {
  const presentation = ui.presentError(error, contextLabel)
  if (presentation.quiet) {
    rt.logger.info(`${contextLabel} was cancelled`)
    return
  }
  rt.logger.error(presentation.message)

  const actions: string[] = []
  if (retry)
    actions.push('Retry')
  actions.push('Show Log')
  if (error instanceof xTokenError && error.code === 'endpoint-unsupported')
    actions.push('Open Settings')

  const message = presentation.hint ? `${presentation.message} ${presentation.hint}` : presentation.message
  const picked = await vscode.window.showErrorMessage(message, ...actions)
  if (picked === 'Retry' && retry)
    await retry()
  if (picked === 'Show Log')
    rt.logger.show(false)
  if (picked === 'Open Settings')
    await vscode.commands.executeCommand('workbench.action.openSettings', 'xtoken.serverUrl')
}

/** Last resort handler for unexpected command failures. */
async function reportUnexpected(rt: Runtime, error: unknown, commandId: string): Promise<void> {
  const presentation = ui.presentError(error, `run ${commandId}`)
  rt.logger.error(`${commandId} failed unexpectedly`, error)
  const message = presentation.hint ? `${presentation.message} ${presentation.hint}` : presentation.message
  const picked = await vscode.window.showErrorMessage(message, 'Show Log')
  if (picked === 'Show Log')
    rt.logger.show(false)
}

/** `xToken.showToken`: reveal the active secret with a Copy to Clipboard button. */
export async function commandShowToken(rt: Runtime): Promise<void> {
  const token = await rt.keys.getActiveToken()
  if (!token) {
    const picked = await vscode.window.showWarningMessage(
      `${EXTENSION_NAME}: Secret Storage is empty, so there is no token to show yet.`,
      'Select Provider',
      'Add Key'
    )
    if (picked === 'Select Provider')
      await commandSelectProvider(rt)
    if (picked === 'Add Key')
      await commandSetKey(rt)
    return
  }

  const preset = getProvider(rt.state.activeProvider)
  const keyCount = await rt.keys.getKeyCount()
  const detail = [
    preset ? `Provider: ${preset.name}` : 'Provider: unknown',
    `Stored keys: ${formatCount(keyCount)}`,
    `Tracked today: ${formatCount(preset ? rt.state.requestsToday(preset.id) : 0)} request(s)`,
    `Last claim: ${rt.state.lastClaimDate ?? 'never'}`
  ].join(' \u00b7 ')

  const picked = await vscode.window.showInformationMessage(
    `${EXTENSION_NAME} active token: ${maskToken(token)}`,
    'Copy to Clipboard',
    'Reveal Full Token',
    'Show Usage'
  )
  switch (picked) {
    case 'Copy to Clipboard':
      await ui.copyToClipboard(token, `${preset?.name ?? EXTENSION_NAME} token`)
      return
    case 'Reveal Full Token':
      // A QuickPick keeps the plaintext transient: it disappears when dismissed.
      await vscode.window.showQuickPick([{ label: token, description: 'active token', detail }], {
        title: `${EXTENSION_NAME}: active token (dismiss to hide)`,
        ignoreFocusOut: true
      })
      return
    case 'Show Usage':
      await commandShowUsage(rt)
      return
    default:
      rt.logger.debug('Token notification dismissed')
  }
}

/** `xToken.setKey`: paste a key for a provider, verify it, then store it. */
export async function commandSetKey(rt: Runtime, presetOverride?: ProviderPreset): Promise<void> {
  const config = readConfig()
  const preset = presetOverride
    ?? getProvider(rt.state.activeProvider)
    ?? (await ui.pickProvider(rt.state.activeProvider))
  if (!preset)
    return

  const apiKey = await ui.promptForApiKey(preset)
  if (!apiKey)
    return

  rt.statusBar.setBusy(`verifying ${preset.id}`)
  try {
    const verification = await verifyProviderKey(preset, apiKey, {
      timeoutMs: config.requestTimeoutMs,
      logger: rt.logger,
      version: rt.version
    })
    if (!verification.ok) {
      const status = verification.status ?? 'n/a'
      const keep = await vscode.window.showWarningMessage(
        `${preset.name} rejected the key (HTTP ${status}): ${verification.detail}`,
        { modal: true, detail: 'Store it anyway? Verification failed, so inference calls will probably fail too.' },
        'Store Anyway'
      )
      if (keep !== 'Store Anyway')
        return
    }

    await storeKey(rt, preset, apiKey, config, { markClaimed: false })
    await refreshStatusBar(rt, { forceQuota: true })
    const picked = await vscode.window.showInformationMessage(
      `${EXTENSION_NAME}: ${preset.name} key stored as ${maskToken(apiKey)}. ${verification.detail}`,
      'Show Usage',
      'Rotate Key'
    )
    if (picked === 'Show Usage')
      await commandShowUsage(rt)
    if (picked === 'Rotate Key')
      await commandRotateKey(rt)
  } catch (error) {
    await handleFailure(rt, error, `verify and store the ${preset.name} key`, () => {
      void commandSetKey(rt, preset)
      return Promise.resolve()
    })
  } finally {
    await refreshStatusBar(rt)
  }
}

/** `xToken.clearToken`: remove keys from Secret Storage and clear workspace state. */
export async function commandClearToken(rt: Runtime): Promise<void> {
  const ring = await rt.keys.getKeyRing()
  const activeId = rt.state.activeProvider
  const total = Object.values(ring).reduce((sum, keys) => sum + keys.length, 0)
  if (total === 0) {
    const picked = await vscode.window.showWarningMessage(
      `${EXTENSION_NAME}: Secret Storage is already empty.`,
      'Add Key'
    )
    if (picked === 'Add Key')
      await commandSetKey(rt)
    return
  }

  interface ScopeItem extends vscode.QuickPickItem {
    scope: 'all' | 'active' | 'cancel'
  }

  const activeCount = activeId ? ring[activeId]?.length ?? 0 : 0
  const items: ScopeItem[] = [
    {
      label: '$(trash) Remove every stored key',
      description: `${formatCount(total)} key(s) across ${formatCount(Object.keys(ring).length)} provider(s)`,
      scope: 'all'
    }
  ]
  if (activeId && activeCount > 0) {
    items.push({
      label: `$(trash) Remove only the ${requireProvider(activeId).name} keys`,
      description: `${formatCount(activeCount)} key(s)`,
      scope: 'active'
    })
  }
  items.push({ label: '$(close) Cancel', scope: 'cancel' })

  const picked = await vscode.window.showQuickPick(items, {
    title: `${EXTENSION_NAME}: clear stored keys`,
    placeHolder: 'Keys live in Secret Storage; removal cannot be undone',
    ignoreFocusOut: true
  })
  if (!picked || picked.scope === 'cancel')
    return

  const confirmed = await ui.confirmDestructive(
    'Remove stored API keys from Secret Storage?',
    'Remove Keys',
    'The keys are deleted from the operating system keychain and cannot be restored. '
    + 'xToken also clears its workspace state and the daily claim guard.'
  )
  if (!confirmed)
    return

  const removed = picked.scope === 'all'
    ? await rt.keys.clearAll()
    : activeId ? await rt.keys.clearProvider(activeId) : 0

  if (picked.scope === 'all') {
    await rt.state.resetSession()
    await rt.state.resetUsage()
  } else if (activeId)
    await rt.state.resetSession()

  await clearWorkspaceState(rt.context)
  await refreshStatusBar(rt)
  await vscode.window.showInformationMessage(
    `${EXTENSION_NAME}: removed ${formatCount(removed)} key(s) from Secret Storage and cleared workspace state.`
  )
}

/** Reset every workspace-scoped key this extension may have written. */
async function clearWorkspaceState(context: vscode.ExtensionContext): Promise<void> {
  for (const key of context.workspaceState.keys())
    await context.workspaceState.update(key, undefined)
}

/** `xToken.rotateKey`: switch to the next stored key for a provider. */
export async function commandRotateKey(rt: Runtime): Promise<void> {
  const providerIds = await rt.keys.providersWithKeys()
  if (providerIds.length === 0) {
    const picked = await vscode.window.showWarningMessage(
      `${EXTENSION_NAME}: there are no stored keys to rotate between.`,
      'Add Key',
      'Select Provider'
    )
    if (picked === 'Add Key')
      await commandSetKey(rt)
    if (picked === 'Select Provider')
      await commandSelectProvider(rt)
    return
  }

  const providerId = await resolveRotationProvider(rt, providerIds)
  if (!providerId)
    return
  const preset = requireProvider(providerId)
  const keys = await rt.keys.listKeys(providerId)
  if (keys.length < 2) {
    const picked = await vscode.window.showInformationMessage(
      `${EXTENSION_NAME}: ${preset.name} has a single stored key (${maskToken(keys[0] ?? '')}). `
      + 'Add another one to rotate between free allowances.',
      'Add Another Key'
    )
    if (picked === 'Add Another Key')
      await commandSetKey(rt, preset)
    return
  }

  const rotated = await rt.keys.rotate(providerId, rt.state.getRotationIndex(providerId))
  if (!rotated) {
    void vscode.window.showWarningMessage(`${EXTENSION_NAME}: nothing to rotate for ${preset.name}.`)
    return
  }
  await rt.state.setRotationIndex(providerId, rotated.index)
  await rt.state.setActiveProvider(providerId)
  await refreshStatusBar(rt)

  const picked = await vscode.window.showInformationMessage(
    `${EXTENSION_NAME}: rotated ${preset.name} to key ${rotated.index + 1}/${rotated.count} `
    + `(${maskToken(rotated.key)}).`,
    'Copy Key',
    'Show Token'
  )
  if (picked === 'Copy Key')
    await ui.copyToClipboard(rotated.key, `${preset.name} token`)
  if (picked === 'Show Token')
    await commandShowToken(rt)
}

/** Pick which provider to rotate through when several of them hold keys. */
async function resolveRotationProvider(rt: Runtime, providerIds: ProviderId[]): Promise<ProviderId | undefined> {
  const activeId = rt.state.activeProvider
  if (activeId && providerIds.includes(activeId))
    return activeId
  if (providerIds.length === 1)
    return providerIds[0]

  interface ProviderChoice extends vscode.QuickPickItem {
    providerId: ProviderId
  }
  const picked = await vscode.window.showQuickPick<ProviderChoice>(
    providerIds.map(providerId => ({
      label: requireProvider(providerId).name,
      description: describeFreeTier(requireProvider(providerId)),
      providerId
    })),
    { title: `${EXTENSION_NAME}: rotate which provider?`, ignoreFocusOut: true }
  )
  return picked?.providerId
}

/** `xToken.showUsage`: today's ledger plus live provider quota counters. */
export async function commandShowUsage(rt: Runtime): Promise<void> {
  const config = readConfig()

  interface UsageItem extends vscode.QuickPickItem {
    action?: 'refresh' | 'reset' | 'copy' | 'log'
    providerId?: ProviderId
  }

  for (;;) {
    const snapshot = rt.state.snapshot()
    const items: UsageItem[] = [
      { label: `Tracked usage for ${snapshot.date}`, kind: vscode.QuickPickItemKind.Separator },
      {
        label: '$(graph) All providers',
        description: [
          `${formatCount(snapshot.totals.requests)} request(s),`,
          `${formatCount(snapshot.totals.tokens)} token(s)`
        ].join(' '),
        detail: `${formatCount(snapshot.daysTracked)} day(s) of history retained (30 day window)`
      }
    ]

    for (const preset of PROVIDERS) {
      const usage = snapshot.byProvider[preset.id] ?? { requests: 0, tokens: 0 }
      const cached = rt.quotaCache.get(preset.id)
      const remaining = cached?.remaining ?? estimateRemaining(preset, usage.requests)
      items.push({
        label: `$(${preset.icon}) ${preset.name}`,
        description: `${formatCount(usage.requests)} req, ${formatCount(usage.tokens)} tok`,
        detail: quotaDetail(preset, remaining, cached?.checkedAt),
        providerId: preset.id
      })
    }

    items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator })
    items.push({
      label: '$(refresh) Refresh live quota counters',
      description: 'providers that publish a counter endpoint',
      action: 'refresh'
    })
    items.push({ label: '$(copy) Copy this summary', action: 'copy' })
    items.push({ label: '$(trash) Reset usage history', action: 'reset' })
    items.push({ label: '$(output) Open the xToken log', action: 'log' })

    const picked = await vscode.window.showQuickPick(items, {
      title: `${EXTENSION_NAME}: daily usage`,
      placeHolder: 'Free-tier allowances tracked locally, live counters where available',
      ignoreFocusOut: true
    })
    if (!picked)
      return

    switch (picked.action) {
      case 'refresh':
        await refreshQuotas(rt, config)
        continue
      case 'copy':
        await ui.copyToClipboard(usageSummary(rt), 'usage summary')
        continue
      case 'reset': {
        const confirmed = await ui.confirmDestructive(
          'Reset the xToken usage history?',
          'Reset History',
          'Tracked request and token counters for the last 30 days are removed. Stored keys are kept.'
        )
        if (confirmed) {
          await rt.state.resetUsage()
          await refreshStatusBar(rt)
        }
        continue
      }
      case 'log':
        rt.logger.show(false)
        return
      default:
        break
    }

    const preset = getProvider(picked.providerId)
    if (preset)
      await showProviderDetails(rt, preset)
  }
}

/** Read live quota counters for the providers that publish one. */
async function refreshQuotas(rt: Runtime, config: xTokenConfig): Promise<void> {
  const candidates = AVAILABLE_PROVIDERS.filter(preset => preset.quota)
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      `${EXTENSION_NAME}: none of the integrated providers expose a live quota counter.`
    )
    return
  }

  rt.statusBar.setBusy('refreshing quotas')
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${EXTENSION_NAME}: refreshing provider quota counters`,
        cancellable: true
      },
      async (progress, cancellationToken) => {
        for (const preset of candidates) {
          if (cancellationToken.isCancellationRequested)
            return
          const keys = await rt.keys.listKeys(preset.id)
          if (keys.length === 0)
            continue
          const activeKey = preset.id === rt.state.activeProvider ? await rt.keys.getActiveToken() : undefined
          progress.report({ message: `${preset.name}...` })
          try {
            const quota = await fetchProviderQuota(preset, activeKey ?? keys[0], {
              timeoutMs: config.requestTimeoutMs,
              cancellationToken,
              logger: rt.logger,
              version: rt.version
            })
            if (quota) {
              rt.quotaCache.set(preset.id, quota)
              rt.logger.info(`${preset.name} quota: ${describeQuota(quota.remaining, quota.limit)}`)
            }
          } catch (error) {
            rt.logger.warn(`Could not read the ${preset.name} quota counter`, error)
          }
        }
      }
    )
  } finally {
    await refreshStatusBar(rt)
  }
}

/** `xToken.refreshStatus`: re-read counters and repaint the status bar. */
export async function commandRefreshStatus(rt: Runtime): Promise<void> {
  const preset = getProvider(rt.state.activeProvider)
  if (preset?.quota)
    await refreshQuotas(rt, readConfig())
  else
    await refreshStatusBar(rt, { forceQuota: true })
  void vscode.window.showInformationMessage(`${EXTENSION_NAME}: status bar refreshed.`)
}

/** Recompute the status bar model from secrets, state and cached quotas. */
export async function refreshStatusBar(rt: Runtime, options: { forceQuota?: boolean } = {}): Promise<void> {
  const config = readConfig()
  const token = await rt.keys.getActiveToken()
  const keyCount = await rt.keys.getKeyCount()
  const preset = getProvider(rt.state.activeProvider)

  if (options.forceQuota && preset?.quota && token) {
    try {
      const quota = await fetchProviderQuota(preset, token, {
        timeoutMs: config.requestTimeoutMs,
        logger: rt.logger,
        version: rt.version
      })
      if (quota) {
        rt.quotaCache.set(preset.id, quota)
        rt.logger.debug(`Live quota for ${preset.id}: ${describeQuota(quota.remaining, quota.limit)}`)
      }
    } catch (error) {
      rt.logger.warn(`Could not read the ${preset.name} quota counter`, error)
    }
  }

  const cached = preset ? rt.quotaCache.get(preset.id) : undefined
  const requestsToday = preset ? rt.state.requestsToday(preset.id) : 0
  const tokensToday = preset ? rt.state.tokensToday(preset.id) : 0
  const remaining = cached?.remaining ?? estimateRemaining(preset, requestsToday)

  rt.statusBar.update({
    hasKey: token !== undefined,
    providerName: preset?.name,
    providerSummary: preset?.summary,
    keyCount,
    activeKey: token,
    requestsToday,
    tokensToday,
    freeTierLabel: preset ? describeFreeTier(preset) : undefined,
    remainingRequests: remaining,
    quotaDetail: cached ? `${describeQuota(cached.remaining, cached.limit)} (live)` : undefined,
    lastClaimDate: rt.state.lastClaimDate,
    pendingClaim: !rt.state.isClaimedToday(),
    textSuffix: config.usageInStatusBar && preset
      ? `${formatCount(requestsToday)}/${preset.freeRequestLimit ? formatCount(preset.freeRequestLimit) : '?'} today`
      : undefined
  })
  await applyContextKeys(rt)
  rt.dashboard.refresh()
}

/** Publish the `xtoken.*` context keys that drive command enablement and menus. */
async function applyContextKeys(rt: Runtime): Promise<void> {
  await vscode.commands.executeCommand('setContext', CONTEXT_HAS_KEY, await rt.keys.hasAnyKey())
  await vscode.commands.executeCommand('setContext', CONTEXT_KEY_COUNT, await rt.keys.getKeyCount())
  await vscode.commands.executeCommand('setContext', CONTEXT_ACTIVE_PROVIDER, rt.state.activeProvider ?? '')
}

/** Locally tracked remainder of a provider's free daily request budget. */
function estimateRemaining(preset: ProviderPreset | undefined, requestsToday: number): number | undefined {
  if (!preset || preset.freeRequestLimit === undefined)
    return undefined
  return Math.max(0, preset.freeRequestLimit - requestsToday)
}

/** Detail column for one provider row in the usage view. */
function quotaDetail(preset: ProviderPreset, remaining: number | undefined, checkedAt: number | undefined): string {
  const parts = [`free tier: ${describeFreeTier(preset)}`]
  if (remaining !== undefined)
    parts.push(`remaining: ${formatCount(remaining)}`)
  parts.push(checkedAt ? `live counter read ${new Date(checkedAt).toLocaleTimeString()}` : 'counted locally')
  return parts.join(' \u00b7 ')
}

/** Plain text ledger summary, used by the copy action. */
function usageSummary(rt: Runtime): string {
  const snapshot = rt.state.snapshot()
  const lines = [
    `${EXTENSION_NAME} usage summary (${snapshot.date})`,
    `Total: ${snapshot.totals.requests} request(s), ${snapshot.totals.tokens} token(s)`,
    `History retained: ${snapshot.daysTracked} day(s)`,
    `Active provider: ${rt.state.activeProvider ?? 'none'}`,
    `Last claim: ${rt.state.lastClaimDate ?? 'never'}`,
    ''
  ]
  for (const preset of PROVIDERS) {
    const usage = snapshot.byProvider[preset.id] ?? { requests: 0, tokens: 0 }
    lines.push(`${preset.name}: ${usage.requests} request(s), ${usage.tokens} token(s) - ${describeFreeTier(preset)}`)
  }
  return lines.join('\n')
}

/** Body sent to the custom claim endpoint configured in `xtoken.serverUrl`. */
function buildClaimPayload(
  rt: Runtime,
  preset: ProviderPreset,
  reason: ClaimRequestPayload['reason']
): ClaimRequestPayload {
  return {
    extension: 'xToken',
    version: rt.version,
    provider: preset.id,
    providerName: preset.name,
    requestedDailyRequests: preset.freeRequestLimit,
    requestedDailyTokens: preset.freeTokenLimit,
    machineId: rt.machineId,
    sessionId: rt.sessionId,
    platform: process.platform,
    locale: vscode.env.language,
    reason,
    requestedAt: new Date().toISOString()
  }
}

/** Optional startup check: verify the active key and offer a rotation when it fails. */
export async function verifyActiveKeyQuietly(rt: Runtime): Promise<void> {
  const config = readConfig()
  const token = await rt.keys.getActiveToken()
  const preset = getProvider(rt.state.activeProvider)
  if (!token || !preset)
    return

  rt.logger.debug(`Verifying the active ${preset.name} key after startup`)
  try {
    const verification = await verifyProviderKey(preset, token, {
      timeoutMs: config.requestTimeoutMs,
      logger: rt.logger,
      version: rt.version
    })
    if (verification.ok) {
      rt.logger.info(`Startup verification succeeded: ${verification.detail}`)
      return
    }

    rt.logger.warn(`Startup verification failed: ${verification.detail}`)
    const picked = await vscode.window.showWarningMessage(
      `${EXTENSION_NAME}: ${preset.name} no longer accepts the active key (HTTP ${verification.status ?? 'n/a'}).`,
      'Rotate Key',
      'Replace Key',
      'Select Provider'
    )
    if (picked === 'Rotate Key')
      await commandRotateKey(rt)
    if (picked === 'Replace Key')
      await commandSetKey(rt, preset)
    if (picked === 'Select Provider')
      await commandSelectProvider(rt)
  } catch (error) {
    rt.logger.warn('Startup verification could not complete', error)
  }
}
