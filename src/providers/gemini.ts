/**
 * Google Gemini API provider module: catalog entry plus the uniform provider
 * method set ({@link ProviderModule}) bound to the shared behavior engine.
 */
import { claimFromServer, fetchProviderQuota, listProviderModels, verifyProviderKey } from './engine'
import type { ProviderModule } from './provider-module'
import type { ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const gemini: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  listModels: (apiKey, context) => listProviderModels(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
