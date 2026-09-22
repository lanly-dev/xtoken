/**
 * Dashboard tree view for xToken, modelled after lanly-dev's vscode-lemon
 * dashboard: a single activity-bar tree that mirrors the extension state
 * (active credential, key rings, usage, quotas) with every provider grouped
 * under a collapsible Providers node.
 */
import * as vscode from 'vscode'

import { COMMANDS, EXTENSION_NAME } from './constants'
import type { Logger } from './logger'
import { PROVIDERS } from './providers'
import type { KeyStore } from './secrets'
import type { xTokenState } from './state'
import type { ProviderId, ProviderPreset, ProviderQuota } from './types'
import { describeFreeTier, describeQuota, formatCount, maskToken } from './utils'

/** Collaborators the dashboard needs to render itself. */
export interface DashboardDeps {
  state: xTokenState
  keys: KeyStore
  logger: Logger
  /** Cached live quota counters keyed by provider id (owned by extension.ts). */
  quotaCache: Map<ProviderId, ProviderQuota>
}

export type DashboardNode =
  | { kind: 'summary', label: string, detail: string }
  | { kind: 'providers' }
  | {
    kind: 'provider'
    preset: ProviderPreset
    active: boolean
    keyCount: number
    requests: number
    tokens: number
    quota: ProviderQuota | undefined
  }
  | { kind: 'key', providerId: ProviderId, masked: string, active: boolean }

export class DashboardTree implements vscode.TreeDataProvider<DashboardNode> {
  private readonly emitter = new vscode.EventEmitter<DashboardNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(private readonly deps: DashboardDeps) {}

  /** Repaint the tree; safe to call from any event handler. */
  refresh(): void {
    this.emitter.fire(undefined)
  }

  getTreeItem(node: DashboardNode): vscode.TreeItem {
    switch (node.kind) {
      case 'summary': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
        item.description = node.detail
        item.iconPath = new vscode.ThemeIcon('dashboard')
        item.contextValue = 'xToken.summary'
        return item
      }
      case 'providers': {
        const item = new vscode.TreeItem('Providers', vscode.TreeItemCollapsibleState.Expanded)
        item.iconPath = new vscode.ThemeIcon('list-tree')
        item.contextValue = 'xToken.providers'
        return item
      }
      case 'provider': {
        const preset = node.preset
        const item = new vscode.TreeItem(
          preset.name,
          node.keyCount > 0 && node.active
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        )
        item.iconPath = new vscode.ThemeIcon(node.active ? 'verify' : 'circle-large-outline')
        item.description = node.active
          ? `active \u00b7 ${node.keyCount} key(s) \u00b7 ${formatCount(node.requests)} req today`
          : `${node.keyCount} key(s) \u00b7 ${formatCount(node.requests)} req today`
        item.tooltip = new vscode.MarkdownString(
          [
            `**${preset.name}**${node.active ? ' \u00b7 active provider' : ''}`,
            describeFreeTier(preset),
            node.quota
              ? `${describeQuota(node.quota.remaining, node.quota.limit)} (live)`
              : 'live quota: not fetched',
            `Today: ${formatCount(node.requests)} request(s), ${formatCount(node.tokens)} token(s)`,
            preset.summary
          ].join('\n\n'))
        item.contextValue = node.active ? 'xToken.providerActive' : 'xToken.provider'
        return item
      }
      case 'key': {
        const item = new vscode.TreeItem(node.masked, vscode.TreeItemCollapsibleState.None)
        item.iconPath = new vscode.ThemeIcon(node.active ? 'key' : 'circle-outline')
        item.description = node.active ? 'active key' : undefined
        item.contextValue = node.active ? 'xToken.keyActive' : 'xToken.key'
        item.command = { command: COMMANDS.showToken, title: 'Show Active Token' }
        return item
      }
    }
  }

  async getChildren(element?: DashboardNode): Promise<DashboardNode[]> {
    if (!element)
      return this.roots()
    if (element.kind === 'providers')
      return this.providers()
    if (element.kind !== 'provider')
      return []
    const keys = await this.deps.keys.listKeys(element.preset.id)
    return keys.map((key, index) => ({
      kind: 'key' as const,
      providerId: element.preset.id,
      masked: maskToken(key),
      active: element.active && index === 0
    }))
  }

  private async roots(): Promise<DashboardNode[]> {
    const { state, keys } = this.deps
    const snapshot = state.snapshot()
    const ring = await keys.getKeyRing()
    const totalKeys = Object.values(ring).reduce((sum, list) => sum + list.length, 0)
    this.deps.logger.debug(`Dashboard: ${PROVIDERS.length} provider(s), ${totalKeys} key(s) rendered`)
    return [
      {
        kind: 'summary',
        label: `${EXTENSION_NAME} \u00b7 ${formatCount(totalKeys)} key(s) stored`,
        detail: [
          `${formatCount(snapshot.totals.requests)} request(s),`,
          `${formatCount(snapshot.totals.tokens)} token(s) today`
        ].join(' ')
      },
      { kind: 'providers' }
    ]
  }

  private async providers(): Promise<DashboardNode[]> {
    const { state, keys, quotaCache } = this.deps
    const activeId = state.activeProvider
    const snapshot = state.snapshot()
    const ring = await keys.getKeyRing()
    return PROVIDERS.map(preset => {
      const usage = snapshot.byProvider[preset.id] ?? { requests: 0, tokens: 0 }
      return {
        kind: 'provider' as const,
        preset,
        active: preset.id === activeId,
        keyCount: ring[preset.id]?.length ?? 0,
        requests: usage.requests,
        tokens: usage.tokens,
        quota: quotaCache.get(preset.id)
      }
    })
  }
}
