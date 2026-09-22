/**
 * OpenRouter (:free models) provider module: catalog entry plus the uniform
 * provider method set ({@link ProviderModule}) bound to the behavior engine.
 */
import { claimFromServer, fetchProviderQuota, listProviderModels, verifyProviderKey } from './engine'
import type { ProviderModule } from './provider-module'
import type { ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const openrouter: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  listModels: (apiKey, context) => listProviderModels(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
