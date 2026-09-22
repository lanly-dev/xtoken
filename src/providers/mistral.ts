/**
 * Mistral AI (Experiment plan) provider module: catalog entry plus the uniform
 * provider method set ({@link ProviderModule}) bound to the behavior engine.
 */
import { claimFromServer, fetchProviderQuota, verifyProviderKey } from './engine'
import type { ProviderModule } from './provider-module'
import type { ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const mistral: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
