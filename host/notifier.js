/**
 * The delivery side of the plugin: turn one attention moment into a frame and
 * hand it to every open page.
 *
 * There is deliberately no second channel. A frame that finds no page waits a
 * few seconds for a reconnect and is then dropped, which is why this module owns
 * both the subscriber set and the waiting buffer.
 */
import { oneLine, schedule } from './util.js'

const MAX_TITLE = 80
const MAX_BODY = 160
/** How long a frame waits for a page that is reconnecting before it is dropped. */
const PENDING_TTL_MS = 8000

export function createNotifier({ config, diag }) {
  /** Open SSE responses; non-empty means a page can show a clickable banner. */
  const streams = new Set()
  /** Frames waiting for a page to (re)connect, oldest first. */
  const pending = []

  function push(frame) {
    if (streams.size === 0) return false
    const line = `data: ${JSON.stringify(frame)}\n\n`
    for (const response of streams) {
      try {
        response.write(line)
      } catch {
        streams.delete(response)
      }
    }
    return streams.size > 0
  }

  /** Deliver the frames that arrived while no page was listening. */
  function flushPending(response) {
    if (pending.length === 0) return
    const now = Date.now()
    for (const entry of pending.splice(0)) {
      if (now - entry.at > PENDING_TTL_MS) continue
      try {
        response.write(`data: ${JSON.stringify(entry.frame)}\n\n`)
        diag(`flush kind=${entry.frame.kind} waited=${now - entry.at}ms`)
      } catch {}
    }
  }

  /** Deliver one notification. Never throws: a failed banner must not disturb an
   * approval, a question, or a running turn. */
  function notify({ kind, sessionId, title, subtitle, body }) {
    const frame = {
      kind: kind ?? 'generic',
      sessionId: sessionId === undefined ? null : sessionId,
      title: oneLine(title, MAX_TITLE),
      subtitle: subtitle ? oneLine(subtitle, MAX_TITLE) : '',
      body: oneLine(body, MAX_BODY),
      when: config.when,
      toastPosition: config.toastPosition,
      sound: config.sound !== false,
      at: Date.now(),
    }
    diag(`notify kind=${frame.kind} session=${frame.sessionId} streams=${streams.size}`)
    if (push(frame)) return
    // No page right now: hold the frame briefly, because a page that is
    // reloading or reconnecting comes back within a few seconds.
    pending.push({ frame, at: Date.now() })
    schedule(() => {
      const index = pending.findIndex((entry) => entry.frame === frame)
      if (index < 0) return
      const [dropped] = pending.splice(index, 1)
      diag(`drop kind=${dropped.frame.kind} waited=${Date.now() - dropped.at}ms`)
    }, PENDING_TTL_MS)
  }

  function dispose() {
    pending.length = 0
    for (const response of streams) {
      try {
        response.end()
      } catch {}
    }
    streams.clear()
  }

  return { streams, notify, push, flushPending, dispose }
}
