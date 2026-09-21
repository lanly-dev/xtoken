/**
 * Free tier provider catalog.
 *
 * Every entry is a pre-configured preset: base URL, auth shape, the endpoint used
 * to verify a key, documentation links, published free tier ceilings and the
 * caveats that go with them.
 *
 * Publishing notes for maintainers: providers change their free tiers frequently.
 * The numbers below mirror the providers' published documentation at the time of
 * writing, and each entry carries a `limitNote` so the UI can always point the
 * user back at the authoritative page instead of silently trusting a constant.
 */
import type { ProviderId, ProviderPreset } from './types'

/**
 * Providers with a working fetch/verify path in this release (1-5), followed by
 * the presets that ship as documented metadata for the next iteration (6-8).
 */
export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini API',
    vendor: 'Google AI Studio',
    status: 'available',
    summary: '1M-2M context, strong agentic tool use, 1,500 free requests/day',
    icon: 'sparkle',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyUrl: 'https://aistudio.google.com/apikey',
    auth: { scheme: 'query', name: 'key' },
    verify: { path: '/models' },
    envVar: 'GEMINI_API_KEY',
    contextWindow: '1M-2M tokens',
    freeRequestLimit: 1500,
    rateLimit: 'Per-model RPM/TPM, 1,500 free requests/day',
    limitNote:
      'Free tier quotas are per Google Cloud project and reset daily at midnight Pacific Time. '
      + 'Some models (for example 2.5 Pro) have a much lower free RPM than 2.5 Flash.',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    setupHint: 'Create a free API key in Google AI Studio, then paste it here.'
  },
  {
    id: 'cerebras',
    name: 'Cerebras Inference',
    vendor: 'Cerebras Cloud',
    status: 'available',
    summary: 'Ultra-fast inference, 64K context, high free daily token allowance',
    icon: 'zap',
    baseUrl: 'https://api.cerebras.ai/v1',
    docsUrl: 'https://inference-docs.cerebras.ai/',
    keyUrl: 'https://cloud.cerebras.ai/',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    verify: { path: '/models' },
    envVar: 'CEREBRAS_API_KEY',
    contextWindow: '64K tokens',
    freeTokenLimit: 1_000_000,
    rateLimit: 'About 5 requests/min on the entry tier',
    limitNote:
      'Cerebras currently describes its entry tier as a $5 / 30-day Free Trial with roughly 1M tokens per day and '
      + 'a 5 RPM ceiling rather than a permanently free plan. Check the Limits section of the Cerebras console for '
      + 'your organisation\'s live numbers.',
    models: ['gpt-oss-120b', 'qwen-3.8-27b', 'llama-3.3-70b'],
    setupHint: 'Create an API key in the Cerebras Cloud console, then paste it here.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (:free models)',
    vendor: 'OpenRouter',
    status: 'available',
    summary: '50+ free models (DeepSeek-R1, Qwen-Coder), 50-1,000 free requests/day',
    icon: 'globe',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/keys',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    verify: { path: '/key' },
    quota: {
      path: '/key',
      remainingPath: 'data.free_model_daily_requests.remaining',
      limitPath: 'data.free_model_daily_requests.limit',
      usedPath: 'data.free_model_daily_requests.used'
    },
    envVar: 'OPENROUTER_API_KEY',
    contextWindow: 'Model dependent (up to 128K+)',
    freeRequestLimit: 50,
    rateLimit: 'About 20 requests/min, 50 requests/day for :free models',
    limitNote:
      'Free-model request caps are tiered by lifetime credit purchases: under 10 credits is 50 requests/day, once '
      + 'you have bought 10 or more credits the ceiling rises to 1,000 requests/day. xToken reads the provider\'s '
      + 'own counter from GET /api/v1/key whenever it refreshes status.',
    models: [
      'deepseek/deepseek-r1:free',
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free'
    ],
    setupHint: 'Create a key on OpenRouter; model ids ending in :free cost nothing.'
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    vendor: 'Groq',
    status: 'available',
    summary: 'Fast LPU inference, ~200K daily tokens / ~8K TPM free ceiling',
    icon: 'rocket',
    baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/docs',
    keyUrl: 'https://console.groq.com/keys',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    verify: { path: '/models' },
    envVar: 'GROQ_API_KEY',
    contextWindow: '32K-131K tokens depending on model',
    freeTokenLimit: 200_000,
    rateLimit: 'About 8K tokens/min and 200K tokens/day, model specific',
    limitNote:
      'Groq publishes per-model TPM/RPD limits instead of one account level daily counter, so the budget shown by '
      + 'xToken is an estimate of the free ceiling rather than a provider-reported number.',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    setupHint: 'Create an API key in the Groq console, then paste it here.'
  },
  {
    id: 'mistral',
    name: 'Mistral AI (Experiment plan)',
    vendor: 'Mistral AI',
    status: 'available',
    summary: 'Rate limited but generous monthly tokens for Codestral/Mistral models',
    icon: 'shield',
    baseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://docs.mistral.ai/',
    keyUrl: 'https://console.mistral.ai/api-keys',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    verify: { path: '/models' },
    envVar: 'MISTRAL_API_KEY',
    contextWindow: '32K-128K tokens',
    rateLimit: 'About 1 request/second on the free Experiment plan',
    limitNote:
      'The Experiment plan is throttled rather than metered: roughly one request per second plus a monthly token '
      + 'allowance that Mistral adjusts over time. xToken therefore tracks your own request counts instead of a '
      + 'published ceiling.',
    models: ['codestral-latest', 'mistral-small-latest', 'ministral-8b-latest'],
    setupHint: 'Create an API key in the Mistral console (the Experiment plan is free).'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    vendor: 'Cloudflare',
    status: 'planned',
    summary: '10,000 free AI Neurons/day (~100K+ tokens), serverless edge execution',
    icon: 'cloud',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    verify: { path: '/@cf/meta/llama-3.1-8b-instruct' },
    envVar: 'CLOUDFLARE_API_TOKEN',
    contextWindow: '8K-128K tokens depending on model',
    rateLimit: '10,000 Neurons/day free, resets at 00:00 UTC',
    limitNote:
      'Cloudflare still allocates 10,000 Neurons per day on the Workers Free plan and bills $0.011 per 1,000 '
      + 'Neurons beyond it on the paid plan. The REST URL embeds your account id, so this preset needs an extra '
      + 'placeholder before it can be used automatically.',
    models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen2.5-coder-32b-instruct'],
    setupHint: 'Planned for the next iteration: needs an account id plus a token with Workers AI access.'
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    vendor: 'GitHub',
    status: 'retired',
    summary: 'Was free GPT-4o / Llama / Phi access via a GitHub personal access token',
    icon: 'github',
    baseUrl: 'https://models.github.ai/inference',
    docsUrl: 'https://docs.github.com/en/github-models',
    keyUrl: 'https://github.com/settings/tokens',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    envVar: 'GITHUB_TOKEN',
    contextWindow: 'Varies by hosted model',
    rateLimit: 'Historically per-model request and token caps per personal access token',
    limitNote:
      'GitHub has announced the retirement of GitHub Models, so the free OpenAI-compatible endpoint is no longer a '
      + 'dependable allowance. The preset is kept for reference and migration: use GitHub Copilot models or another '
      + 'provider from this list instead.',
    models: ['openai/gpt-4o', 'meta/Llama-3.3-70B-Instruct', 'microsoft/Phi-3-medium-128k-instruct'],
    setupHint: 'Retired upstream. Kept for migration reference only.'
  },
  {
    id: 'kilo',
    name: 'Kilo Code Gateway',
    vendor: 'Kilo (acquired by Anaconda)',
    status: 'planned',
    summary: 'Free auto-router with no key required for :free models',
    icon: 'circuit-board',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    docsUrl: 'https://kilo.ai/docs/gateway/authentication',
    keyUrl: 'https://kilo.ai/docs/gateway/authentication',
    auth: { scheme: 'bearer', name: 'authorization', prefix: 'Bearer ' },
    verify: { path: '/models' },
    envVar: 'KILO_API_KEY',
    contextWindow: 'Depends on the routed model',
    rateLimit: 'Anonymous access for :free models, about 200 requests/hour per IP',
    limitNote:
      'The gateway allows unauthenticated calls for models tagged :free (for example z-ai/glm-5:free or '
      + 'minimax/minimax-m2.1:free) and rate limits anonymous traffic by IP address. Adding a Bearer key raises '
      + 'those limits and unlocks non-free models, and the gateway also supports BYOK for your other provider keys.',
    models: ['z-ai/glm-5:free', 'minimax/minimax-m2.1:free'],
    setupHint: 'Planned for the next iteration: works without a key for :free models.'
  }
]

/** Providers whose fetch/verify flow is implemented in this release. */
export const AVAILABLE_PROVIDERS: readonly ProviderPreset[] = PROVIDERS.filter(
  preset => preset.status === 'available'
)

/** Presets shipped as documentation only until the next iteration. */
export const UPCOMING_PROVIDERS: readonly ProviderPreset[] = PROVIDERS.filter(
  preset => preset.status !== 'available'
)

const PROVIDER_INDEX = new Map<string, ProviderPreset>(PROVIDERS.map(preset => [preset.id, preset]))

/** Look up a preset by id. */
export function getProvider(id: string | undefined): ProviderPreset | undefined {
  return id ? PROVIDER_INDEX.get(id) : undefined
}

/** Lookup for call sites where the id is known to be valid. */
export function requireProvider(id: ProviderId): ProviderPreset {
  const preset = PROVIDER_INDEX.get(id)
  if (!preset)
    throw new Error(`Unknown xToken provider: ${id}`)
  return preset
}

/** True when `value` is a provider id known to this build. */
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_INDEX.has(value)
}

/** Default provider used when nothing has been configured or selected yet. */
export function defaultProviderId(): ProviderId {
  return 'gemini'
}
