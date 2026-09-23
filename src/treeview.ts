/**
 * Dashboard tree view for xToken, modelled after lanly-dev's vscode-lemon
 * dashboard: a single activity-bar tree that mirrors the extension state
 * (active credential, key rings, usage, quotas) with every provider grouped
 * under a collapsible Providers node.
 */
import * as vscode from 'vscode'

import { COMMANDS, EXTENSION_NAME } from './constants'
import { describeFreeTier, describeQuota, formatCount, maskToken } from './utils'
import { PROVIDERS } from './providers'
import type { DashboardDeps, DashboardNode } from './types'

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
          node.keyCount === 0
            ? vscode.TreeItemCollapsibleState.None
            : node.active
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.Collapsed
        )
        item.iconPath = new vscode.ThemeIcon(node.active ? 'verify' : 'circle-large-outline')
        item.description = [
          node.active
            ? `active \u2022 ${node.keyCount} 🔑`
            : `${node.keyCount} \u2022 key(s)`,
          node.model ? `\u2022 ${node.model.id}` : undefined
        ].filter(part => part !== undefined).join(' ')
        item.tooltip = new vscode.MarkdownString(
          [
            `**${preset.name}**${node.active ? ' \u00b7 active provider' : ''}`,
            describeFreeTier(preset),
            node.quota
              ? `${describeQuota(node.quota.remaining, node.quota.limit)} (live)`
              : 'live quota: not fetched',
            node.model
              ? `Preferred model: \`${node.model.id}\``
              : 'Preferred model: provider default (`xToken.selectModel` to pick one)',
            `Today: ${formatCount(node.requests)} request(s), ${formatCount(node.tokens)} token(s)`,
            preset.summary
          ].join('\n\n'))
        item.contextValue = node.active ? 'xToken.providerActive' : 'xToken.provider'
        return item
      }
      case 'key': {
        const item = new vscode.TreeItem(node.masked, vscode.TreeItemCollapsibleState.None)
        item.iconPath = new vscode.ThemeIcon(node.active ? 'key' : 'circle-outline')
        const descParts: string[] = []
        if (node.active)
          descParts.push('active key')
        if (node.model)
          descParts.push(`\u2022 ${node.model.id}`)
        item.description = descParts.length ? descParts.join(' ') : undefined
        item.contextValue = node.active ? 'xToken.keyActive' : 'xToken.key'
        item.command = { command: COMMANDS.showToken, title: 'Show Active Token' }
        if (node.model) {
          item.tooltip = new vscode.MarkdownString(
            [
              `Active key for **${node.providerName}**`,
              `Using model: \`${node.model.id}\``,
              node.active ? 'This is the active credential for this provider.' : ''
            ].filter(Boolean).join('\n\n'))
        }
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
    const activeToken = element.active ? await this.deps.keys.getActiveToken() : undefined
    const model = this.deps.state.preferredModel(element.preset.id)
    return keys.map(key => ({
      kind: 'key' as const,
      providerId: element.preset.id,
      masked: maskToken(key),
      active: key === activeToken,
      model,
      providerName: element.preset.name
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
        quota: quotaCache.get(preset.id),
        model: state.preferredModel(preset.id)
      }
    })
  }
}
