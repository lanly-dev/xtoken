/**
 * Output channel logger with level gating.
 *
 * Tokens are never written to the channel: only masked values from `maskToken` ever reach a log line.
 */
import * as vscode from 'vscode'

import { errorMessage } from './utils'
import { OUTPUT_CHANNEL_NAME } from './constants'
import type { LogLevel } from './types'

const LEVEL_WEIGHT: Record<LogLevel, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 }

export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel
  private level: LogLevel

  constructor(level: LogLevel, channelName: string = OUTPUT_CHANNEL_NAME) {
    this.level = level
    this.channel = vscode.window.createOutputChannel(channelName)
  }

  /** Re-apply the level after `xtoken.logLevel` changes. */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }

  error(message: string, error?: unknown): void {
    this.write('error', message, error)
  }

  warn(message: string, error?: unknown): void {
    this.write('warn', message, error)
  }

  info(message: string, error?: unknown): void {
    this.write('info', message, error)
  }

  debug(message: string, error?: unknown): void {
    this.write('debug', message, error)
  }

  /** Reveal the channel so the user can read a user-facing summary. */
  show(preserveFocus = true): void {
    this.channel.show(preserveFocus)
  }

  dispose(): void {
    this.channel.dispose()
  }

  private write(level: Exclude<LogLevel, 'off'>, message: string, error?: unknown): void {
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[this.level]) return
    const stamp = new Date().toISOString()
    const detail = error === undefined ? '' : ` :: ${errorMessage(error)}`
    this.channel.appendLine(`${stamp} [${level.toUpperCase()}] ${message}${detail}`)
  }
}
