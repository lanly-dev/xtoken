/**
 * QuickPick surfaces, prompts, clipboard and error presentation.
 */
import * as vscode from 'vscode'

import { xTokenError } from './api'
import { EXTENSION_NAME } from './constants'
import type { Logger } from './logger'
import { AVAILABLE_PROVIDERS, getProvider, UPCOMING_PROVIDERS } from './providers'
import type { ProviderId, ProviderPreset } from './types'
import { describeFreeTier, errorMessage, hostOf } from './utils'

export interface ProviderPickItem extends vscode.QuickPickItem {
  presetId?: ProviderId
}

/** Row describing one provider, shared by the provider picker and usage views. */
export function providerQuickPickItem(preset: ProviderPreset, activeId?: ProviderId): ProviderPickItem {
  const tags: string[] = [describeFreeTier(preset)]
  if (preset.status === 'planned')
    tags.push('coming soon')
  if (preset.status === 'retired')
    tags.push('retired upstream')
  if (preset.id === activeId)
    tags.push('active')

  return {
    label: `$(${preset.icon}) ${preset.name}`,
    description: tags.join(' \u00b7 '),
    detail: `${preset.summary} \u2014 ${preset.baseUrl}`,
    buttons: [
      { iconPath: new vscode.ThemeIcon('link-external'), tooltip: `Open ${preset.name} documentation` },
      { iconPath: new vscode.ThemeIcon('key'), tooltip: `Get a free ${preset.name} key` }
    ],
    presetId: preset.id
  }
}

/**
 * `xToken.selectProvider`: the single menu that lists every supported free
 * tier together with its daily limits, base URL and links for getting a key.
 */
export async function pickProvider(activeId: ProviderId | undefined): Promise<ProviderPreset | undefined> {
  const items: ProviderPickItem[] = [
    { label: 'Integrated in this release', kind: vscode.QuickPickItemKind.Separator },
    ...AVAILABLE_PROVIDERS.map(preset => providerQuickPickItem(preset, activeId)),
    { label: 'Next iteration (preset only)', kind: vscode.QuickPickItemKind.Separator },
    ...UPCOMING_PROVIDERS.map(preset => providerQuickPickItem(preset, activeId))
  ]

  const quickPick = vscode.window.createQuickPick<ProviderPickItem>()
  quickPick.title = `${EXTENSION_NAME}: select a free-tier provider`
  quickPick.placeholder = 'Gemini, Cerebras, OpenRouter, Groq and Mistral are ready to use'
  quickPick.matchOnDetail = true
  quickPick.matchOnDescription = true
  quickPick.ignoreFocusOut = true
  quickPick.items = items

  const buttonListener = quickPick.onDidTriggerItemButton(event => {
    const preset = getProvider(event.item.presetId)
    if (!preset)
      return
    const wantsKey = (event.button.tooltip ?? '').startsWith('Get a free')
    void openExternal(wantsKey ? preset.keyUrl : preset.docsUrl)
  })

  try {
    const picked = await new Promise<ProviderPickItem | undefined>(resolve => {
      const accepted = quickPick.onDidAccept(() => resolve(quickPick.activeItems[0]))
      const hidden = quickPick.onDidHide(() => resolve(undefined))
      quickPick.show()
      void accepted
      void hidden
    })
    return getProvider(picked?.presetId)
  } finally {
    buttonListener.dispose()
    quickPick.dispose()
  }
}

export type ProviderAction = 'fetch' | 'paste' | 'details' | 'docs'

/** Second step of `xToken.selectProvider`: what should happen with the pick? */
export async function pickProviderAction(
  preset: ProviderPreset,
  hasStoredKey: boolean
): Promise<ProviderAction | undefined> {
  interface ActionItem extends vscode.QuickPickItem {
    action: ProviderAction
  }

  const items: ActionItem[] = []
  if (preset.status === 'available') {
    items.push({
      label: '$(cloud-download) Fetch / claim a token now',
      description: hasStoredKey ? 're-verify, or add another key' : 'guided setup with key verification',
      action: 'fetch'
    })
    items.push({
      label: hasStoredKey ? '$(key) Replace the stored key' : '$(key) Paste an existing API key',
      description: `${preset.envVar} \u00b7 stored in Secret Storage`,
      action: 'paste'
    })
  }
  items.push({
    label: '$(info) Show free-tier details',
    description: describeFreeTier(preset),
    action: 'details'
  })
  items.push({
    label: '$(link-external) Open the key dashboard',
    description: hostOf(preset.keyUrl),
    action: 'docs'
  })

  const picked = await vscode.window.showQuickPick(items, {
    title: `${EXTENSION_NAME}: ${preset.name}`,
    placeHolder: preset.setupHint,
    ignoreFocusOut: true
  })
  return picked?.action
}

/** Password masked input box for a provider credential. */
export async function promptForApiKey(preset: ProviderPreset): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: `${EXTENSION_NAME}: ${preset.name}`,
    prompt: `Paste your ${preset.name} API key. It is kept in VS Code Secret Storage, never in settings.json.`,
    placeHolder: `${preset.envVar}  \u00b7  get one at ${preset.keyUrl}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: input => validateApiKey(input)
  })
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function validateApiKey(input: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '')
    return 'Enter an API key, or press Escape to cancel.'
  if (/\s/.test(trimmed))
    return 'API keys never contain whitespace.'
  if (trimmed.length < 8)
    return 'That looks too short for an API key.'
  return undefined
}

/** Modal confirmation for destructive commands. */
export async function confirmDestructive(
  message: string,
  confirmLabel: string,
  detail?: string
): Promise<boolean> {
  const picked = await vscode.window.showWarningMessage(message, { modal: true, detail }, confirmLabel)
  return picked === confirmLabel
}

/** Clipboard helper that reports success back to the user. */
export async function copyToClipboard(value: string, label: string): Promise<void> {
  await vscode.env.clipboard.writeText(value)
  void vscode.window.showInformationMessage(`${EXTENSION_NAME}: ${label} copied to the clipboard.`)
}

/** Open a URL in the user's browser, tolerating malformed values. */
export async function openExternal(url: string, logger?: Logger): Promise<boolean> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(url))
  if (!opened)
    logger?.warn(`The operating system refused to open ${url}`)
  return opened
}

/** Multi-line free-tier summary used by the details action and the log channel. */
export function providerDetailsLines(preset: ProviderPreset): string[] {
  return [
    `${preset.name} (${preset.vendor})`,
    `Status: ${preset.status}`,
    `Base URL: ${preset.baseUrl}`,
    `Docs: ${preset.docsUrl}`,
    `Keys: ${preset.keyUrl}`,
    `Environment variable: ${preset.envVar}`,
    `Context window: ${preset.contextWindow}`,
    `Published free tier: ${describeFreeTier(preset)}`,
    `Rate limits: ${preset.rateLimit}`,
    `Caveats: ${preset.limitNote}`,
    `Models: ${preset.models.join(', ')}`,
    `Next step: ${preset.setupHint}`
  ]
}

export interface ErrorPresentation {
  message: string
  hint?: string
  /** True when simply retrying later is a reasonable user action. */
  retryable: boolean
  /** True when the failure was a deliberate cancellation and should stay quiet. */
  quiet: boolean
}

/** Turn any thrown value into something worth showing in a notification. */
export function presentError(error: unknown, contextLabel: string): ErrorPresentation {
  if (error instanceof xTokenError) {
    return {
      message: `${EXTENSION_NAME} could not ${contextLabel}: ${error.message}`,
      hint: hintFor(error),
      retryable: error.code !== 'invalid-config',
      quiet: error.code === 'cancelled'
    }
  }
  return {
    message: `${EXTENSION_NAME} could not ${contextLabel}: ${errorMessage(error)}`,
    retryable: true,
    quiet: false
  }
}

function hintFor(error: xTokenError): string | undefined {
  switch (error.code) {
    case 'timeout':
      return 'Raise xtoken.requestTimeout or check your network connection.'
    case 'network':
      return 'Check your connection, proxy or corporate firewall settings.'
    case 'unauthorized':
      return 'The provider rejected this key. Create a fresh free key and paste it again.'
    case 'rate-limited':
      return 'The provider is throttling this key. Wait a moment or rotate to another stored key.'
    case 'endpoint-unsupported':
      return 'xtoken.serverUrl must accept a JSON POST and answer with a token field.'
    default:
      return undefined
  }
}
