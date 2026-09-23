export async function translateChatRequest(
  messages: readonly LanguageModelChatRequestMessage[],
  options: LanguageModelChatRequestOptions
): Promise<{
  providerId: ProviderId
  modelId: string
  system: string[]
  user: Array<{ role: 'user'; content: string }>
  temperature?: number,
  maxTokens?: number
  stop?: string[]
  stream: boolean
  tools?: unknown[]
}> {
  const providers = resolveProviderOrder(options) // options/from options; default config order
  const modelIds = resolveModelIds(options, providers)
  const providerId = pickProviderId(providers)
  const modelId = pickModelId(modelIds, providerId)

  const system = [] as string[]
  const user: Array<{ role: 'user'; content: string }> = []
  let maxTokens: number | undefined
  let temperature: number | undefined
  let stop: string[] | undefined
  let stream = true
  let tools: unknown[] | undefined

  for (const message of messages) {
    const content = resolveChatContent(message.content)
    switch (message.role) {
      case 'system':
        system.push(content)
        break
      case 'user':
        user.push({ role: 'user', content })
        break
      default:
        break
    }
  }

  if (options.maxTokens !== undefined)
    maxTokens = options.maxTokens
  if (options.stream !== undefined)
    stream = options.stream

  return {
    providerId,
    modelId,
    system,
    user,
    temperature,
    maxTokens,
    stop,
    stream,
    tools
  }
}

function resolveProviderOrder(options: LanguageModelChatRequestOptions): ProviderId[] {
  const config = readConfig()
  const preferred = config.providerOrder
  if (preferred.length === 0)
    return PROVIDERS.map(p => p.id)
  return preferred.filter(isProviderId)
}

function resolveModelIds(
  options: LanguageModelChatRequestOptions,
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
