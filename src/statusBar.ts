/**
 * Status bar integration.
 *
 * A single right-aligned item summarises the whole extension:
 *   `$(key) xToken: Active`      when a token is available
 *   `$(warning) xToken: No Key`  when Secret Storage is still empty
 *
 * Clicking it always runs `xToken.selectProvider`.
 */
import * as vscode from 'vscode'

import { COMMANDS, EXTENSION_NAME, STATUS_BAR_PRIORITY } from './constants'
import type { Logger } from './logger'
import { formatCount, maskToken } from './utils'

export interface StatusBarModel {
  hasKey: boolean
  providerName?: string
  providerSummary?: string
  keyCount: number
  activeKey?: string
  requestsToday: number
  tokensToday: number
  freeTierLabel?: string
  remainingRequests?: number
  quotaDetail?: string
  lastClaimDate?: string
  pendingClaim: boolean
  /** Optional text appended to the label, e.g. `3/1,500`. */
  textSuffix?: string
}

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor(private readonly logger: Logger, clickCommand: string = COMMANDS.selectProvider) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY)
    this.item.name = EXTENSION_NAME
    this.item.command = clickCommand
    this.item.accessibilityInformation = { label: `${EXTENSION_NAME} free tier token manager` }
  }

  /** Apply a new model to the visible item. */
  update(model: StatusBarModel): void {
    if (model.hasKey) {
      const suffix = model.textSuffix ? ` \u00b7 ${model.textSuffix}` : ''
      this.item.text = `$(key) xToken: Active${suffix}`
      this.item.color = undefined
      this.item.backgroundColor = undefined
    } else {
      this.item.text = '$(warning) xToken: No Key'
      this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground')
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    }
    this.item.tooltip = this.buildTooltip(model)
    this.item.accessibilityInformation = {
      label: model.hasKey
        ? `${EXTENSION_NAME} active${model.providerName ? ` with ${model.providerName}` : ''}`
        : `${EXTENSION_NAME} has no API key`
    }
    this.item.show()
    this.logger.debug(`Status bar updated: ${model.hasKey ? 'active' : 'no key'}`)
  }

  /** Transient "working" state used while a claim or verification runs. */
  setBusy(message: string): void {
    this.item.text = `$(sync~spin) xToken: ${message}`
    this.item.backgroundColor = undefined
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }

  private buildTooltip(model: StatusBarModel): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(undefined, true)
    markdown.supportThemeIcons = true
    markdown.appendMarkdown(`**$(key) ${EXTENSION_NAME}** \u2014 free tier token manager\n\n`)
    if (!model.hasKey) {
      markdown.appendMarkdown('No API key in Secret Storage yet.\n\n')
      markdown.appendMarkdown('_Click to pick a provider and fetch a free-tier token._')
      return markdown
    }

    markdown.appendMarkdown(`Provider: **${model.providerName ?? 'unknown'}**\n\n`)
    if (model.activeKey)
      markdown.appendMarkdown(`Active key: \`${maskToken(model.activeKey)}\`\n\n`)
    markdown.appendMarkdown(`Stored keys: ${formatCount(model.keyCount)}\n\n`)
    markdown.appendMarkdown(`Today: ${formatCount(model.requestsToday)} request(s), `)
    markdown.appendMarkdown(`${formatCount(model.tokensToday)} token(s)\n\n`)
    if (model.freeTierLabel)
      markdown.appendMarkdown(`Free tier: ${model.freeTierLabel}\n\n`)
    if (model.remainingRequests !== undefined)
      markdown.appendMarkdown(`Remaining (tracked): ${formatCount(model.remainingRequests)}\n\n`)
    if (model.quotaDetail)
      markdown.appendMarkdown(`Provider quota: ${model.quotaDetail}\n\n`)
    if (model.lastClaimDate)
      markdown.appendMarkdown(`Last claim: ${model.lastClaimDate}\n\n`)
    if (model.pendingClaim)
      markdown.appendMarkdown('$(info) Today\'s claim is still available.\n\n')
    if (model.providerSummary)
      markdown.appendMarkdown(`${model.providerSummary}\n\n`)
    markdown.appendMarkdown('_Click to switch provider, fetch a token or inspect usage._')
    return markdown
  }
}
