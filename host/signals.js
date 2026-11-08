/**
 * What the plugin listens to, and when a signal becomes a notification.
 *
 * Everything here rides durable session events wherever possible:
 * `approval/asked` and `tool/call` are committed before any answerer runs, and
 * `turn/start` / `turn/end` mark a turn's boundaries. The one exception is
 * `user-questions/request`, which is process-local by design and therefore only
 * used as a fallback.
 */
import { QUESTION_TOOLS } from './config.js'
import { messageOf, oneLine, schedule } from './util.js'

/** How old an already-asked approval may be to be announced on activation. */
const RESUME_WINDOW_MS = 180_000
const MAX_TITLE = 80

export function attachSignals({ ctx, config, text, notifier, diag, warn, settleMs, coalesceMs }) {
  /** dedupe key -> time of the last notification with that key. */
  const recent = new Map()
  /** sessionId -> start time of the turn in progress. */
  const turnStarted = new Map()
  /** sessionId -> disposer of the pending "did it really settle" timer. */
  const settling = new Map()

  function shouldSend(key) {
    const now = Date.now()
    const last = recent.get(key)
    if (last !== undefined && now - last < coalesceMs) return false
    recent.set(key, now)
    if (recent.size > 120) {
      for (const [entry, at] of recent) if (now - at > 60_000) recent.delete(entry)
    }
    return true
  }

  /** Session facts a notification needs, read without assuming any optional
   * service is present. */
  function describe(agentId) {
    let session
    try {
      session = ctx.sessions.get(agentId)
    } catch {}
    const header = session?.header
    let title
    try {
      title = ctx.get('sessionTitle')?.get?.(session)?.title
    } catch {}
    if (!title) {
      const cwd = header?.cwd
      title = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : undefined
    }
    return {
      child: header?.origin === 'subagent' || Boolean(header?.parentSession),
      title: oneLine(title || text.unnamed, MAX_TITLE),
    }
  }

  /** Child sessions have their own two switches: one for the requests that need
   * the user's decision, one for the informational endings. */
  function wanted(facts, kind) {
    if (facts.child === false) return true
    const actionable = kind === 'approval' || kind === 'question'
    return actionable ? config.subagentApproval === true : config.subagentDone === true
  }

  function questionText(rawArguments) {
    try {
      const parsed = JSON.parse(rawArguments)
      const first = Array.isArray(parsed?.questions) ? parsed.questions[0] : undefined
      return first?.header || first?.question
    } catch {}
    return undefined
  }

  function cancelSettling(id) {
    const dispose = settling.get(id)
    if (!dispose) return
    settling.delete(id)
    try {
      dispose()
    } catch {}
  }

  function approvalPayload(sessionId, facts, data) {
    return {
      kind: 'approval',
      sessionId,
      title: text.approval,
      subtitle: facts.title,
      body: [data?.toolName, data?.reason].filter(Boolean).join(' · ') || text.approval,
    }
  }

  /** Announce one settled turn once it has stayed finished for `settleMs`, so a
   * goal or queued round that starts right after it announces once, at rest. */
  function finishTurn(id, startedAt, reason) {
    diag(`turn-end ${String(reason?.kind)} started=${startedAt === undefined ? 'unknown' : 'known'}`)
    const kind = reason?.kind
    if (kind === 'aborted' || kind === 'interrupted' || kind === 'forked' || kind === 'blocked') return
    const facts = describe(id)
    if (!wanted(facts, kind === 'error' ? 'error' : 'done')) return
    cancelSettling(id)
    diag(`settle scheduled session=${id} in=${settleMs}ms kind=${String(kind)}`)
    const dispose = schedule(() => {
      settling.delete(id)
      diag(`settle fire session=${id}`)
      if (kind === 'error') {
        if (!config.error) return
        if (!shouldSend(`error:${id}`)) return
        notifier.notify({
          kind: 'error',
          sessionId: id,
          title: text.error,
          subtitle: facts.title,
          body: messageOf(reason?.error),
        })
        return
      }
      if (!config.turnEnd) return
      if (!shouldSend(`done:${id}`)) return
      const seconds = startedAt === undefined ? null : Math.max(1, Math.round((Date.now() - startedAt) / 1000))
      notifier.notify({
        kind: 'done',
        sessionId: id,
        title: text.done,
        subtitle: facts.title,
        body: seconds === null ? text.doneBodyShort : text.doneBody(seconds),
      })
    }, settleMs)
    settling.set(id, dispose)
  }

  /** An approval can be asked while this plugin is unloaded — the request that
   * re-enables it is exactly such a case — so on activation every approval that
   * is still open (asked without a matching decision) gets announced. */
  function resumeOpenApprovals() {
    if (!config.approval) return
    let sessions = []
    try {
      sessions = ctx.sessions.list()
    } catch {
      return
    }
    const now = Date.now()
    for (const session of sessions) {
      try {
        const id = session?.id
        if (id === undefined) continue
        const facts = describe(id)
        if (!wanted(facts, 'approval')) continue
        const total = Number(session.seq) || 0
        const events = session.snapshotEvents(Math.max(0, total - 200))
        const open = new Map()
        for (const event of events) {
          if (event?.type === 'approval/asked' && event.data?.id !== undefined) {
            open.set(event.data.id, { data: event.data, time: Number(event.time) || now })
          } else if (event?.type === 'approval/decided' && event.data?.id !== undefined) {
            open.delete(event.data.id)
          }
        }
        for (const [approvalId, entry] of open) {
          if (now - entry.time > RESUME_WINDOW_MS) continue
          if (!shouldSend(`approval:${id}:${approvalId}`)) continue
          diag(`resume-approval session=${id} id=${String(approvalId).slice(0, 8)} age=${Math.round((now - entry.time) / 1000)}s`)
          notifier.notify(approvalPayload(id, facts, entry.data))
        }
      } catch (error) {
        diag(`resume-error ${messageOf(error)}`)
      }
    }
  }

  ctx.on('session/event', (session, event) => {
    try {
      const type = event?.type
      const id = session?.id
      if (id === undefined) return

      // A turn that starts supersedes the settle timer of the previous one, so a
      // goal or queued round that resumes immediately announces once, at rest.
      if (type === 'turn/start') {
        turnStarted.set(id, Date.now())
        cancelSettling(id)
        return
      }
      if (type === 'turn/end') {
        finishTurn(id, turnStarted.get(id), event?.data?.reason)
        return
      }

      const isApproval = type === 'approval/asked'
      const isQuestion = type === 'tool/call' && QUESTION_TOOLS.has(event?.data?.name)
      if (!isApproval && !isQuestion) return

      const facts = describe(id)
      const eventKind = isApproval ? 'approval' : 'question'
      if (isApproval) diag(`approval session=${id} child=${facts.child} wanted=${wanted(facts, eventKind)}`)
      if (!wanted(facts, eventKind)) return

      if (isApproval) {
        if (!config.approval) return
        const data = event.data ?? {}
        if (!shouldSend(`approval:${id}:${data.id ?? ''}`)) return
        notifier.notify(approvalPayload(id, facts, data))
        return
      }

      if (!config.question) return
      const data = event.data ?? {}
      if (!shouldSend(`question:${id}:${data.callId ?? 'anonymous'}`)) return
      notifier.notify({
        kind: 'question',
        sessionId: id,
        title: text.question,
        subtitle: facts.title,
        body: questionText(data.arguments) || text.question,
      })
    } catch (error) {
      warn(`通知派发失败：${messageOf(error)}`)
      diag(`dispatch-error ${messageOf(error)}`)
    }
  })

  // Fallback for questions that do not come from a known tool call: the request
  // itself is process-local, so observing the answerer chain is the only signal
  // that exists. Deduped against the durable path by call id.
  ctx.on('user-questions/request', (request, next) => {
    try {
      if (config.question && !request?.signal?.aborted) {
        const id = request?.agent?.id
        if (id !== undefined) {
          const facts = describe(id)
          const first = request?.questions?.[0]
          const key = `question:${id}:${request?.wait?.callId ?? first?.id ?? 'anonymous'}`
          if (wanted(facts, 'question') && shouldSend(key)) {
            notifier.notify({
              kind: 'question',
              sessionId: id,
              title: text.question,
              subtitle: facts.title,
              body: first?.header || first?.question || text.question,
            })
          }
        }
      }
    } catch (error) {
      warn(`提问通知失败：${messageOf(error)}`)
      diag(`question-error ${messageOf(error)}`)
    }
    return next()
  })

  ctx.effect(() => () => {
    for (const dispose of settling.values()) {
      try {
        dispose()
      } catch {}
    }
    settling.clear()
    turnStarted.clear()
    recent.clear()
  })

  ctx.on('session/disposed', (session) => {
    const id = session?.id
    if (id === undefined) return
    // A finished subagent session is disposed right after its turn ends, so the
    // pending settle must survive it: the timer holds the facts it needs.
    turnStarted.delete(id)
  })

  // Announce approvals that were asked while this plugin was unloaded. Runs once
  // now and once shortly after, because sessions may still be restoring.
  resumeOpenApprovals()
  ctx.effect(() => schedule(resumeOpenApprovals, 3000))
}
