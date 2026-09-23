import * as vscode from 'vscode'

import { readConfig } from './config'
import { getModule, isProviderId, PROVIDERS } from './providers'
import type { ProviderId } from './types'

function resolveChatContent(content: vscode.LanguageModelChatMessage['content']): string {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if ('text' in part) {
          const typed = part as { text: string }
          return typed.text
        }
        if ('kind' in part) {
          const typed = part as { kind: string, mimeType?: string }
          if (typed.kind === 'image')
            return '[image: ' + (typed.mimeType ?? 'unknown') + ']'
        }
        return ''
      })
      .join('')
  }
  return ''
}

export async function translateChatRequest(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  _options: vscode.LanguageModelChatRequestOptions
): Promise<{
  providerId: ProviderId
  modelId: string
  system: string[]
  user: Array<{ role: 'user', content: string }>
  stream: boolean
  tools?: unknown[] | undefined
}> {
  const providers = resolveProviderOrder()
  const modelIds = resolveModelIds({}, providers)
  const providerId = pickProviderId(providers)
  const modelId = pickModelId(modelIds, providerId)

  const system = [] as string[]
  const user: Array<{ role: 'user', content: string }> = []
  let stream = true
  let tools: unknown[] | undefined

  for (const message of messages) {
    const content = resolveChatContent(message.content as vscode.LanguageModelChatMessage['content'])
    if (message.role === vscode.LanguageModelChatMessageRole.User)
      user.push({ role: 'user', content })

  }

  if (_options.tools !== undefined)
    tools = _options.tools

  return {
    providerId,
    modelId,
    system,
    user,
    stream,
    tools
  }
}

function resolveProviderOrder(): ProviderId[] {
  const config = readConfig()
  const preferred = config.providerOrder
  if (preferred.length === 0)
    return PROVIDERS.map(p => p.id)
  return preferred.filter(isProviderId)
}

function resolveModelIds(
  _options: vscode.LanguageModelChatRequestOptions,
  providers: ProviderId[]
): Map<ProviderId, string> {
  const map = new Map<ProviderId, string>()
  for (const id of providers) {
    const module = getModule(id)
    if (!module)
      continue
    const prefers = module.modelIdForCombinedMode?.()
    if (prefers)
      map.set(id, prefers)
  }
  return map
}

function pickProviderId(providers: ProviderId[]): ProviderId {
  return providers[0] ?? 'gemini'
}

function pickModelId(modelIds: Map<ProviderId, string>, providerId: ProviderId): string {
  const preferred = modelIds.get(providerId)
  if (preferred)
    return preferred
  const module = getModule(providerId)
  if (module) {
    const preset = module.getPreset()
    if (preset.models.length > 0)
      return preset.models[0]
  }
  return 'gpt-4o'
}

export class ChatProvider implements vscode.LanguageModelChatProvider {
  readonly id = 'xToken (rotating)'
  readonly label = 'xToken (rotating)'
  readonly supportsImageContent = false

  provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
    return []
  }

  provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const translated = translateChatRequest(messages, {})
    return translated.then(result => {
      const module = getModule(result.providerId)
      if (!module || !module.chat) {
        progress.report(new vscode.LanguageModelTextPart('No chat implementation for ' + result.providerId))
        return
      }
      return module.chat(result, (part: vscode.LanguageModelResponsePart) => progress.report(part), token)
    })
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const str = typeof text === 'string' ? text : JSON.stringify(text)
    return Promise.resolve(Math.ceil(str.length / 4))
  }
}
