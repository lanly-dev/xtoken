/**
 * Groq Cloud provider module: catalog entry plus the uniform provider method
 * set ({@link ProviderModule}) bound to the shared behavior engine.
 */
import { claimFromServer, fetchProviderQuota, verifyProviderKey } from './engine'
import type { ProviderModule } from './provider-module'
import type { ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const groq: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
