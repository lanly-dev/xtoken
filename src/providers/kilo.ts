/**
 * Kilo Code Gateway provider module: catalog entry plus the uniform provider
 * method set ({@link ProviderModule}) bound to the shared behavior engine.
 */
import { claimFromServer, fetchProviderQuota, listProviderModels, verifyProviderKey } from './engine'
import type { ProviderModule, ProviderPreset } from '../types'

const preset: ProviderPreset = {
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

export const kilo: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  listModels: (apiKey, context) => listProviderModels(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
