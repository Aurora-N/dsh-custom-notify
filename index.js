/**
 * Notifications for the Harness desktop/web UI — composition root.
 *
 * Three moments need the user while they are looking somewhere else: a tool
 * approval, a structured question, and a turn that settled (or failed). The
 * plugin opens one channel and nothing else: `GET /dsh-notify/events` reaches
 * every open Harness page, which shows the banner itself — inside the desktop
 * app that banner is owned by DeepSeek Harness, its click focuses the window,
 * and it opens the Session the notification belongs to.
 *
 * The work is split by responsibility:
 *
 * - `host/config.js`      defaults, wording, settings keys, persistence
 * - `host/diagnostics.js` the logger and the capped diagnostics.log
 * - `host/notifier.js`    frame building, the page subscribers, the wait buffer
 * - `host/routes.js`      the HTTP surface (SSE, report, test, settings)
 * - `host/signals.js`     which Host events become notifications
 * - `host/util.js`        small shared helpers
 */
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG, TEXT, loadSettings } from './host/config.js'
import { createDiagnostics } from './host/diagnostics.js'
import { createNotifier } from './host/notifier.js'
import { mountRoutes } from './host/routes.js'
import { attachSignals } from './host/signals.js'
import { clamp } from './host/util.js'

/** `webServer` is required, not optional: reading it lazily at apply time loses
 * the race on a cold boot (the service mounts after this row), which left the
 * notification routes unregistered after every app restart. */
export const inject = ['sessions', 'webServer']

export { DEFAULT_CONFIG }

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig || {}), ...loadSettings() }
  const text = TEXT[config.language] ?? TEXT.zh
  const settleMs = clamp(config.settleMs, 0, 60_000, DEFAULT_CONFIG.settleMs)
  const coalesceMs = clamp(config.coalesceMs, 0, 60_000, DEFAULT_CONFIG.coalesceMs)

  const { diag, warn } = createDiagnostics(ctx, config.diagnostics !== false)
  const notifier = createNotifier({ config, diag })

  mountRoutes({ ctx, config, text, notifier, diag, guardToken: randomUUID() })

  // Whether the page will load a client half at all; the answer decides where
  // to look when notifications stop crossing the page channel.
  try {
    const graph = ctx.get('clientModules')?.graph?.()
    const entries = Array.isArray(graph?.entries) ? graph.entries : []
    diag(`boot client-graph modules=${entries.length} notify=${entries.some((entry) => entry?.id === 'dsh-custom-notify')}`)
  } catch (error) {
    diag(`boot client-graph-error ${error?.message ?? error}`)
  }
  diag(`config turnEnd=${config.turnEnd} approval=${config.approval} question=${config.question} error=${config.error} subagentApproval=${config.subagentApproval} subagentDone=${config.subagentDone} when=${config.when} settleMs=${settleMs}`)

  attachSignals({ ctx, config, text, notifier, diag, warn, settleMs, coalesceMs })

  ctx.effect(() => () => notifier.dispose())
}
