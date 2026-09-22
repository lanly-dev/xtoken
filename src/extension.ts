/**
 * xToken - free-tier API token manager for Visual Studio Code.
 *
 * Activation happens on `onStartupFinished`. This module only wires the
 * extension together: collaborators are created here, every `xToken.*`
 * command is registered inline, and all behaviour lives in the sibling
 * modules (`commands.ts`, `api.ts`, `state.ts`, ...).
 *
 * Command surface:
 *   xToken.fetchToken      claim from xtoken.serverUrl or run guided setup
 *   xToken.selectProvider  QuickPick over every supported free tier
 *   xToken.showToken       reveal the active secret with a copy button
 *   xToken.clearToken      wipe Secret Storage plus workspace state
 *   xToken.setKey          paste and verify a key by hand
 *   xToken.rotateKey       cycle through stored keys for a provider
 *   xToken.showUsage       daily ledger and live quota counters
 *   xToken.refreshStatus   re-read quota counters and repaint the status bar
 *   xToken.openSiteUrl     open the provider's "get an API key" page
 */
import { env, ExtensionContext, version, window } from 'vscode'

import {
  commandClearToken,
  commandFetchToken,
  commandOpenKeyUrl,
  commandRefreshStatus,
  commandRotateKey,
  commandSelectProvider,
  commandSetKey,
  commandShowToken,
  commandShowUsage,
  createApi,
  createCommandRegistrar,
  refreshStatusBar,
  registerEventListeners,
  verifyActiveKeyQuietly,
  type Runtime
} from './commands'
import { hasInvalidEndpoint, readConfig } from './config'
import { COMMANDS, EXTENSION_NAME } from './constants'
import { Logger } from './logger'
import { KeyStore } from './secrets'
import { StatusBarController } from './statusBar'
import { xTokenState } from './state'
import { DashboardTree } from './treeview'
import type { ProviderId, ProviderQuota, xTokenApi } from './types'

let runtime: Runtime | undefined

export async function activate(context: ExtensionContext): Promise<xTokenApi> {
  const config = readConfig()
  const logger = new Logger(config.logLevel)
  const state = new xTokenState(context.globalState, logger)
  const keys = new KeyStore(context.secrets, logger)
  const statusBar = new StatusBarController(logger)
  const quotaCache = new Map<ProviderId, ProviderQuota>()
  const dashboard = new DashboardTree({ state, keys, logger, quotaCache })

  const rt: Runtime = {
    context,
    logger,
    state,
    keys,
    statusBar,
    dashboard,
    version: readVersion(context),
    machineId: env.machineId,
    sessionId: env.sessionId,
    quotaCache
  }
  runtime = rt

  const rc = createCommandRegistrar(rt)
  const d1 = rc(COMMANDS.fetchToken, () => commandFetchToken(rt))
  const d2 = rc(COMMANDS.selectProvider, () => commandSelectProvider(rt))
  const d3 = rc(COMMANDS.showToken, () => commandShowToken(rt))
  const d4 = rc(COMMANDS.clearToken, () => commandClearToken(rt))
  const d5 = rc(COMMANDS.setKey, () => commandSetKey(rt))
  const d6 = rc(COMMANDS.rotateKey, () => commandRotateKey(rt))
  const d7 = rc(COMMANDS.showUsage, () => commandShowUsage(rt))
  const d8 = rc(COMMANDS.refreshStatus, () => commandRefreshStatus(rt))
  const d9 = rc(COMMANDS.openSiteUrl, node => commandOpenKeyUrl(rt, node))

  const [onConfigChange, onSecretsChange] = registerEventListeners(rt)
  const dashboardView = window.createTreeView('xToken.dashboard', { treeDataProvider: dashboard })

  context.subscriptions.push(
    logger, statusBar,
    d1, d2, d3, d4, d5, d6, d7, d8, d9,
    onConfigChange, onSecretsChange,
    dashboardView
  )

  logger.info(`${EXTENSION_NAME} v${rt.version} activated (extension host ${version})`)
  if (hasInvalidEndpoint(config)) {
    logger.warn(`Ignoring the malformed xtoken.serverUrl value: ${config.rawServerUrl}`)
    void window.showWarningMessage(
      `${EXTENSION_NAME}: xtoken.serverUrl is not a valid http(s) URL, so it will be ignored.`
    )
  }
  if (config.serverUrl) {
    const source = config.serverUrlSource === 'xtoken.serverUrl' ? 'xtoken.serverUrl' : 'xToken.serverUrl (alias)'
    logger.info(`Claim endpoint configured via ${source}: ${config.serverUrl}`)
  }

  await refreshStatusBar(rt)
  if (config.verifyOnStartup)
    void verifyActiveKeyQuietly(rt)

  return createApi(rt)
}

function readVersion(context: ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

// This method is called when your extension is deactivated
export function deactivate(): void {
  runtime?.logger.info(`${EXTENSION_NAME} deactivated`)
  runtime = undefined
}
