/**
 * The plugin's two output channels: the Cordis logger (operator-visible) and a
 * size-capped `diagnostics.log` next to the plugin (support-visible).
 */
import { appendFileSync, statSync, truncateSync } from 'node:fs'
import { dataFile } from './data-dir.js'

const LOG_PATH = dataFile('diagnostics.log')
const LOG_LIMIT = 256 * 1024

export function createDiagnostics(ctx, enabled) {
  function diag(message) {
    if (enabled === false) return
    try {
      if (statSync(LOG_PATH).size > LOG_LIMIT) truncateSync(LOG_PATH, 0)
    } catch {}
    try {
      appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`)
    } catch {}
  }

  function warn(message) {
    ctx.logger?.warn?.(`[notify] ${message}`)
  }

  return { diag, warn }
}
