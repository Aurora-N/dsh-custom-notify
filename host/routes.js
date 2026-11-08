/**
 * The plugin's HTTP surface, deliberately outside the admitted `/api` prefix:
 *
 * - `GET  /dsh-notify/events`   SSE carrier for open pages
 * - `POST /dsh-notify/report`   page-side telemetry into diagnostics.log
 * - `GET  /dsh-notify/test`     sample frame of any kind, for verification
 * - `GET  /dsh-notify/settings` read, plus `?set=key:value` toggles
 *   `PUT  /dsh-notify/settings` the same write, for API callers
 *
 * The desktop page is served from a custom `dsh-app://` scheme whose fetch drops
 * custom headers and only reliably forwards GET, so every mutation the panel
 * performs travels as a plain GET guarded by a per-process token.
 */
import {
  SETTINGS_KEYS,
  effectiveSettings,
  normalizeSetting,
  saveSettings,
} from './config.js'

export function mountRoutes({ ctx, config, text, notifier, diag, guardToken }) {
  const webServer = ctx.webServer

  function authorized(req) {
    if (req.headers['x-dsh-notify'] === '1') return true
    try {
      return new URL(req.url || '/', 'http://localhost').searchParams.get('token') === guardToken
    } catch {
      return false
    }
  }

  function streamHandler(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    res.write(`data: ${JSON.stringify({ kind: 'ready' })}\n\n`)
    notifier.streams.add(res)
    notifier.flushPending(res)
    diag(`sse-open ${req.headers.host ?? ''} total=${notifier.streams.size}`)
    const ping = setInterval(() => {
      try {
        // A real event, not a comment: the page needs a message it can see to
        // tell a live stream from a silently dead one.
        res.write(`data: ${JSON.stringify({ kind: 'ping' })}\n\n`)
      } catch {}
    }, 25_000)
    ping.unref?.()
    const drop = () => {
      clearInterval(ping)
      if (notifier.streams.delete(res)) diag(`sse-close total=${notifier.streams.size}`)
    }
    req.on('close', drop)
    req.on('error', drop)
    res.on('close', drop)
    res.on('error', drop)
  }

  function reportHandler(req, res) {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= 16 * 1024) chunks.push(chunk)
    })
    req.on('end', () => {
      diag(`client ${Buffer.concat(chunks).toString('utf8').trim().slice(0, 2000)}`)
      res.statusCode = 204
      res.end()
    })
    req.on('error', () => {
      res.statusCode = 400
      res.end()
    })
  }

  function testHandler(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    if (!authorized(req)) {
      diag(`forbidden ${req.url ?? ''}`)
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    // `?kind=approval` (or question/done/error) exercises the same path a real
    // event takes, including the in-page notice an actionable kind raises.
    const requested = new URL(req.url || '/', 'http://localhost').searchParams.get('kind')
    const kinds = {
      approval: { kind: 'approval', title: text.approval },
      question: { kind: 'question', title: text.question },
      done: { kind: 'done', title: text.done },
      error: { kind: 'error', title: text.error },
      test: { kind: 'test', title: text.test },
    }
    const sample = kinds[requested] ?? kinds.test
    notifier.notify({ kind: sample.kind, title: sample.title, subtitle: 'DSH', body: text.testBody })
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
      ok: true,
      channel: notifier.streams.size > 0 ? 'browser' : 'none',
      pageStreams: notifier.streams.size,
    }))
  }

  function applySet(set) {
    const changed = []
    for (const part of set.split(',')) {
      const index = part.indexOf(':')
      if (index < 0) continue
      const key = part.slice(0, index)
      const raw = part.slice(index + 1)
      const next = key === 'when' || key === 'toastPosition'
        ? normalizeSetting(key, raw)
        : normalizeSetting(key, raw === 'true' ? true : raw === 'false' ? false : undefined)
      if (next === undefined) continue
      if (config[key] === next) continue
      config[key] = next
      changed.push(key)
    }
    if (changed.length > 0) {
      saveSettings(config)
      diag(`settings ${changed.join(',')} -> ${JSON.stringify(effectiveSettings(config, notifier.streams.size).settings)}`)
    }
    return changed
  }

  function applyPatch(patch) {
    const changed = []
    for (const key of SETTINGS_KEYS) {
      const next = normalizeSetting(key, patch?.[key])
      if (next === undefined) continue
      if (config[key] === next) continue
      config[key] = next
      changed.push(key)
    }
    if (changed.length > 0) {
      saveSettings(config)
      diag(`settings ${changed.join(',')} -> ${JSON.stringify(effectiveSettings(config, notifier.streams.size).settings)}`)
    }
    return changed
  }

  function settingsHandler(req, res) {
    const reply = (status, body) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(body))
    }
    const read = () => effectiveSettings(config, notifier.streams.size)

    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost')
      const set = url.searchParams.get('set')
      if (set === null) {
        reply(200, { ...read(), token: guardToken })
        return
      }
      if (!authorized(req)) {
        diag(`forbidden ${req.url ?? ''}`)
        reply(403, { ok: false, error: 'forbidden' })
        return
      }
      const changed = applySet(set)
      reply(200, { ...read(), token: guardToken, changed })
      return
    }

    if (req.method !== 'PUT') {
      reply(405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!authorized(req)) {
      diag(`forbidden ${req.url ?? ''}`)
      reply(403, { ok: false, error: 'forbidden' })
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= 16 * 1024) chunks.push(chunk)
    })
    req.on('error', () => reply(400, { ok: false, error: 'body error' }))
    req.on('end', () => {
      let patch
      try {
        patch = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch (error) {
        reply(400, { ok: false, error: String(error?.message ?? error) })
        return
      }
      const changed = applyPatch(patch)
      reply(200, { ...read(), token: guardToken, changed })
    })
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-notify/events', handler: streamHandler }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-notify/test', handler: testHandler }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-notify/report', handler: reportHandler }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-notify/settings', handler: settingsHandler }))
  diag('routes registered')
}
