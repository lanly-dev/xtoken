
import { env, ExtensionContext, version, window, lm } from 'vscode'

import {
  commandClearToken,
  commandFetchToken,
  commandOpenKeyUrl,
  commandRefreshStatus,
  commandSelectModel,
  commandSelectProvider,
  commandSetKey,
  commandShowToken,
  commandShowUsage,
  createApi,
  createCommandRegistrar,
  refreshUi,
  registerEventListeners,
  verifyActiveKeyQuietly,
  type Runtime
} from './commands'

import { COMMANDS, EXTENSION_NAME } from './constants'
import { ChatProvider } from './lm-chat'
import { DashboardTree } from './treeview'
import { hasInvalidEndpoint, readConfig } from './config'
import { KeyStore } from './secrets'
import { Logger } from './logger'
import { xTokenState } from './state'
import type { ProviderId, ProviderQuota, xTokenApi } from './types'

let runtime: Runtime | undefined

export async function activate(context: ExtensionContext): Promise<xTokenApi> {
  const config = readConfig()
  const logger = new Logger(config.logLevel)
  const state = new xTokenState(context.globalState, logger)
  const keys = new KeyStore(context.secrets, logger)
  const quotaCache = new Map<ProviderId, ProviderQuota>()
  const dashboard = new DashboardTree({ state, keys, logger, quotaCache })

  const rt: Runtime = {
    context,
    logger,
    state,
    keys,
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
  const d5 = rc(COMMANDS.setKey, arg => commandSetKey(rt, arg))
  const d6 = rc(COMMANDS.showUsage, () => commandShowUsage(rt))
  const d7 = rc(COMMANDS.refreshStatus, () => commandRefreshStatus(rt))
  const d8 = rc(COMMANDS.openSiteUrl, node => commandOpenKeyUrl(rt, node))
  const d9 = rc(COMMANDS.selectModel, arg => commandSelectModel(rt, arg))

  const chat = new ChatProvider(rt, logger)
  const ch = lm.registerLanguageModelProvider(chat, { viewlet: true })

  context.subscriptions.push(
    logger,
    d1, d2, d3, d4, d5, d6, d7, d8, d9,
    onConfigChange, onSecretsChange,
    dashboardView,
    ch
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

  await refreshUi(rt)
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
