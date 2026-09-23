/**
 * Cerebras Inference provider module: catalog entry plus the uniform provider
 * method set ({@link ProviderModule}) bound to the shared behavior engine.
 */
import { claimFromServer, fetchProviderQuota, listProviderModels, verifyProviderKey } from './engine'
import type { ProviderModule, ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const cerebras: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  listModels: (apiKey, context) => listProviderModels(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
