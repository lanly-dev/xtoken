/**
 * Cloudflare Workers AI provider module: catalog entry plus the uniform
 * provider method set ({@link ProviderModule}) bound to the behavior engine.
 */
import { claimFromServer, fetchProviderQuota, listProviderModels, verifyProviderKey } from './engine'
import type { ProviderModule, ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const cloudflare: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  listModels: (apiKey, context) => listProviderModels(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
