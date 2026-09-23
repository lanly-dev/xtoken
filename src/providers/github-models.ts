/**
 * GitHub Models provider module (retired upstream): catalog entry plus the
 * uniform provider method set ({@link ProviderModule}) bound to the engine.
 */
import { claimFromServer, fetchProviderQuota, listProviderModels, verifyProviderKey } from './engine'
import type { ProviderModule, ProviderPreset } from '../types'

const preset: ProviderPreset = {
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
}

export const githubModels: ProviderModule = {
  preset,
  getPreset: () => preset,
  getStatus: () => preset.status,
  isAvailable: () => preset.status === 'available',
  verifyKey: (apiKey, context) => verifyProviderKey(preset, apiKey, context),
  fetchQuota: (apiKey, context) => fetchProviderQuota(preset, apiKey, context),
  listModels: (apiKey, context) => listProviderModels(preset, apiKey, context),
  claim: (serverUrl, payload, context) => claimFromServer(serverUrl, payload, context)
}
