/**
 * Client half of the notifications plugin.
 *
 * This artifact is one browser module: the client module system serves exactly
 * one `./client` script per package and its `factory(require)` only resolves
 * registered package ids, so the split by responsibility happens here, in file
 * order, rather than across files.
 *
 *   1. locale dictionaries        (text for the panel)
 *   2. endpoint helpers           (base path, settings/test URLs)
 *   3. useT                       (locale-following translate hook)
 *   4. panel rows                 (which switch maps to which setting)
 *   5. styles                     (panel + notice stack)
 *   6. toast store                (in-page notices, outside React state)
 *   7. <ToastStack/>              (notice list rendered into shell.overlay)
 *   8. <Switch/>                  (one boolean row)
 *   9. <Panel/>                   (the settings page)
 *  10. <BellIcon/>                (settings nav glyph)
 *  11. notification pipeline      (SSE, permission, show, badge)
 *  12. apply()                    (mounts slots and starts the pipeline)
 *
 * The Host pushes one frame per attention moment over `/dsh-custom-notify/events`.
 * Each frame becomes a notification the desktop app owns, so its click can focus
 * the window and open the Session it belongs to. Steps are reported to
 * `/dsh-custom-notify/report`, which the Host appends to `diagnostics.log`.
 */
report('module-eval', { href: String(window.location.pathname) })

window.__ModuleLoader__.load({
  id: 'dsh-custom-notify',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ZH = {
      'nav': '通知',
      'panel.title': '通知设置',
      'panel.subtitle': '选择哪些情况提醒你，以及是否播放声音。改完立即生效。',
      'row.approval': '需要审核',
      'row.approval.desc': '工具调用请求授权时',
      'row.question': '需要你回答',
      'row.question.desc': '模型向你提问、需要你选择时',
      'row.turnEnd': '执行完成',
      'row.turnEnd.desc': '一轮结束时',
      'row.error': '执行出错',
      'row.error.desc': '一轮以错误结束时',
      'row.subagentApproval': '子代理的审核 / 提问',
      'row.subagentApproval.desc': '子会话需要你授权或回答时提醒',
      'row.subagentDone': '子代理的完成 / 出错',
      'row.subagentDone.desc': '子会话结束或失败时提醒',
      'row.sound': '通知声音',
      'row.sound.desc': '弹通知时播放系统提示音',
      'row.when': '通知时机',
      'row.when.desc': '什么时候才提醒你。停在你正在看的这条会话时通常不用再弹。',
      'when.always': '任何时候',
      'when.always.desc': '不管窗口状态，每条都提醒',
      'row.pos': '提示位置',
      'row.pos.desc': '应用内提示条出现在窗口的哪个角',
      'pos.top-left': '左上',
      'pos.top-right': '右上',
      'pos.bottom-left': '左下',
      'pos.bottom-right': '右下',
      'when.away-session': '离开当前会话时',
      'when.away-session.desc': '只有在你看的不是这条会话、或窗口不在前台时提醒',
      'when.background': 'App 不在前台时',
      'when.background.desc': '窗口在前台就完全不提醒，适合专注时不打扰',
      'channel.browser': '当前通道：App 通知（可点击跳转、带 Dock 角标）',
      'channel.none': '当前通道：页面未连接，通知会等几秒重连，超时后丢弃',
      'action.test': '发送测试通知',
      'state.loading': '读取中…',
      'state.failed': '读取设置失败',
    }
    const EN = {
      'nav': 'Notifications',
      'panel.title': 'Notifications',
      'panel.subtitle': 'Choose which moments notify you, and whether to play a sound. Changes apply immediately.',
      'row.approval': 'Approval needed',
      'row.approval.desc': 'A tool call asks for permission',
      'row.question': 'Your answer is needed',
      'row.question.desc': 'The model asks you to choose something',
      'row.turnEnd': 'Turn finished',
      'row.turnEnd.desc': 'A turn settles',
      'row.error': 'Turn failed',
      'row.error.desc': 'A turn ends with an error',
      'row.subagentApproval': 'Subagent approvals',
      'row.subagentApproval.desc': 'A subagent session asks for permission or an answer',
      'row.subagentDone': 'Subagent completions',
      'row.subagentDone.desc': 'A subagent session settles or fails',
      'row.sound': 'Notification sound',
      'row.sound.desc': 'Play the system sound with the banner',
      'row.when': 'When to notify',
      'row.when.desc': 'When a notification is raised at all. Sitting on that very Session usually needs no banner.',
      'when.always': 'Always',
      'when.always.desc': 'Notify regardless of window state',
      'row.pos': 'Notice position',
      'row.pos.desc': 'Which corner of the window the in-page notice uses',
      'pos.top-left': 'Top left',
      'pos.top-right': 'Top right',
      'pos.bottom-left': 'Bottom left',
      'pos.bottom-right': 'Bottom right',
      'when.away-session': 'When away from that session',
      'when.away-session.desc': 'Only when you are not viewing that Session, or the window is in the background',
      'when.background': 'Only when the app is in the background',
      'when.background.desc': 'Stay silent whenever the window is in front',
      'channel.browser': 'Channel: app notifications (clickable, Dock badge)',
      'channel.none': 'Channel: no page connected; a notification waits a few seconds for a reconnect',
      'action.test': 'Send a test notification',
      'state.loading': 'Loading…',
      'state.failed': 'Could not read the settings',
    }

    function basePath() {
      const base = (typeof document !== 'undefined' && document.baseURI) || window.location.href
      return base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1)
    }

    function settingsUrl() {
      return `${basePath()}dsh-custom-notify/settings`
    }

    function testUrl() {
      return `${basePath()}dsh-custom-notify/test`
    }

    /** Set by `apply`; the panel reads it so the labels follow the UI language. */
    let localeService = null

    function useT() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        if (!localeService) return undefined
        return localeService.subscribe(() => bump((value) => value + 1))
      }, [])
      return localeService ? localeService.bind('notify') : (key) => key
    }

    const ROWS = [
      ['approval', 'row.approval', 'row.approval.desc'],
      ['question', 'row.question', 'row.question.desc'],
      ['turnEnd', 'row.turnEnd', 'row.turnEnd.desc'],
      ['error', 'row.error', 'row.error.desc'],
      ['subagentApproval', 'row.subagentApproval', 'row.subagentApproval.desc'],
      ['subagentDone', 'row.subagentDone', 'row.subagentDone.desc'],
      ['sound', 'row.sound', 'row.sound.desc'],
    ]

    const WHEN_OPTIONS = [
      ['always', 'when.always', 'when.always.desc'],
      ['away-session', 'when.away-session', 'when.away-session.desc'],
      ['background', 'when.background', 'when.background.desc'],
    ]

    const POSITION_OPTIONS = [
      ['top-left', 'pos.top-left'],
      ['top-right', 'pos.top-right'],
      ['bottom-left', 'pos.bottom-left'],
      ['bottom-right', 'pos.bottom-right'],
    ]

    const PANEL_CSS = `
.dn-panel{display:flex;flex-direction:column;gap:14px;max-width:640px;font-size:13px;
  --dn-text:var(--dsw-alias-label-primary,#1b1d22);
  --dn-muted:var(--dsw-alias-label-secondary,#6b7280);
  --dn-surface:var(--dsw-alias-bg-layer-1,#ffffff);
  --dn-surface-2:var(--dsw-alias-bg-layer-2,#f3f4f6);
  --dn-border:var(--dsw-alias-border-l1,#e5e7eb);
  --dn-border-strong:var(--dsw-alias-border-l2,#d1d5db);
  --dn-brand:var(--dsw-alias-brand-primary,#4d6bfe);
  /* Contrast against the brand: the dark theme's brand is near-white, so the
     "on" label and the knob must be the base background, not hard-coded white. */
  --dn-on-brand:var(--dsw-alias-bg-base,#ffffff);
  color:var(--dn-text);}
/* The alias tokens already flip with the app theme; the fallbacks keep the
   page readable when a build ships without them, and follow the OS scheme. */
@media (prefers-color-scheme: dark){
  .dn-panel{
    --dn-text:var(--dsw-alias-label-primary,#e8eaf0);
    --dn-muted:var(--dsw-alias-label-secondary,#9aa1ad);
    --dn-surface:var(--dsw-alias-bg-layer-1,#1b1e24);
    --dn-surface-2:var(--dsw-alias-bg-layer-2,#24272f);
    --dn-border:var(--dsw-alias-border-l1,#2c3038);
    --dn-border-strong:var(--dsw-alias-border-l2,#3a3f49);
  }
}
/* The app can force dark while the OS stays light, so the theme attribute wins
   as well; the token is already dark there, the fallback covers its absence. */
body[data-ds-dark-theme] .dn-panel,
html[data-ds-dark-theme] .dn-panel{
  --dn-text:var(--dsw-alias-label-primary,#e8eaf0);
  --dn-muted:var(--dsw-alias-label-secondary,#9aa1ad);
  --dn-surface:var(--dsw-alias-bg-layer-1,#1b1e24);
  --dn-surface-2:var(--dsw-alias-bg-layer-2,#24272f);
  --dn-border:var(--dsw-alias-border-l1,#2c3038);
  --dn-border-strong:var(--dsw-alias-border-l2,#3a3f49);
}
.dn-sub{margin:0 0 2px;font-size:12.5px;line-height:1.6;color:var(--dn-muted);}
.dn-group{border:1px solid var(--dn-border);border-radius:12px;overflow:hidden;
  background:var(--dn-surface);}
.dn-row{display:flex;align-items:center;gap:16px;padding:12px 14px;border-top:1px solid var(--dn-border);}
.dn-row:first-child{border-top:0;}
.dn-row-main{flex:1;min-width:0;}
.dn-row-title{font-size:13px;font-weight:500;}
.dn-row-desc{margin-top:2px;font-size:11.5px;color:var(--dn-muted);line-height:1.5;}
.dn-row-column{flex-direction:column;align-items:stretch;gap:10px;}
.dn-modes{display:flex;gap:8px;flex-wrap:wrap;}
.dn-mode{border:1px solid var(--dn-border-strong);background:var(--dn-surface);
  color:inherit;font:inherit;font-size:12px;padding:6px 12px;border-radius:999px;cursor:pointer;
  transition:background .15s,border-color .15s,color .15s;}
.dn-mode:hover{background:var(--dn-surface-2);}
.dn-mode[aria-pressed="true"]{background:var(--dn-brand);border-color:transparent;color:var(--dn-on-brand);}
.dn-switch{flex:none;width:38px;height:22px;border-radius:999px;border:0;padding:0;cursor:pointer;
  background:var(--dn-border-strong);position:relative;transition:background .15s;}
.dn-switch[aria-checked="true"]{background:var(--dn-brand);}
.dn-switch span{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:#fff;transition:transform .15s,background .15s;}
/* A near-white track needs a contrasting knob, otherwise the switch reads as a
   single white blob. */
.dn-switch[aria-checked="true"] span{transform:translateX(16px);background:var(--dn-on-brand);}
.dn-foot{display:flex;align-items:center;gap:12px;}
.dn-btn{border:1px solid var(--dn-border-strong);background:var(--dn-surface);
  color:inherit;font:inherit;font-size:12.5px;padding:6px 12px;border-radius:8px;cursor:pointer;}
.dn-btn:hover{background:var(--dn-surface-2);}
.dn-channel{font-size:11.5px;color:var(--dn-muted);}
`

    // A banner is not guaranteed to appear while the app is frontmost, so an
    // attention item also lands in this in-page stack. It is the channel that
    // works whenever the page is visible at all.
    const toastItems = new Set()
    const toastListeners = new Set()
    let toastSeq = 0
    let uiRef = null
    /** Corner the notice stack uses; the Host sends it with every frame. */
    let toastPosition = 'bottom-right'

    function toastSnapshot() {
      return Array.from(toastItems)
    }

    function toastNotify() {
      for (const listener of toastListeners) {
        try {
          listener()
        } catch {}
      }
    }

    function pushToast(entry) {
      toastSeq += 1
      const item = { ...entry, id: toastSeq }
      toastItems.add(item)
      toastNotify()
      report('toast-push', { kind: entry.kind, size: toastItems.size })
      setTimeout(() => {
        toastItems.delete(item)
        toastNotify()
      }, 9000)
      return item
    }

    function dismissToast(item) {
      toastItems.delete(item)
      toastNotify()
    }

    const TOAST_CSS = `
.dn-toasts{position:fixed;display:flex;flex-direction:column;gap:8px;z-index:80;pointer-events:auto;
  --dn-toast-bg:var(--dsw-alias-bg-overlay,#ffffff);
  --dn-toast-border:var(--dsw-alias-border-l1,#e5e7eb);
  --dn-toast-text:var(--dsw-alias-label-primary,#1b1d22);
  --dn-toast-muted:var(--dsw-alias-label-secondary,#6b7280);
  --dn-toast-brand:var(--dsw-alias-brand-primary,#4d6bfe);
  --dn-toast-shadow:0 8px 24px rgba(0,0,0,.18);}
.dn-toasts.pos-bottom-right{right:16px;bottom:16px;}
.dn-toasts.pos-bottom-left{left:16px;bottom:16px;}
/* Top corners stack the newest notice nearest the edge. */
.dn-toasts.pos-top-right{right:16px;top:16px;flex-direction:column-reverse;}
.dn-toasts.pos-top-left{left:16px;top:16px;flex-direction:column-reverse;}
@media (prefers-color-scheme: dark){
  .dn-toasts{
    --dn-toast-bg:var(--dsw-alias-bg-overlay,#23262e);
    --dn-toast-border:var(--dsw-alias-border-l1,#31353f);
    --dn-toast-text:var(--dsw-alias-label-primary,#e8eaf0);
    --dn-toast-muted:var(--dsw-alias-label-secondary,#9aa1ad);
    --dn-toast-shadow:0 8px 24px rgba(0,0,0,.5);}
}
body[data-ds-dark-theme] .dn-toasts,
html[data-ds-dark-theme] .dn-toasts{
  --dn-toast-bg:var(--dsw-alias-bg-overlay,#23262e);
  --dn-toast-border:var(--dsw-alias-border-l1,#31353f);
  --dn-toast-text:var(--dsw-alias-label-primary,#e8eaf0);
  --dn-toast-muted:var(--dsw-alias-label-secondary,#9aa1ad);
  --dn-toast-shadow:0 8px 24px rgba(0,0,0,.5);
}
.dn-toast{display:flex;flex-direction:column;gap:2px;max-width:320px;padding:10px 12px;border-radius:10px;
  border:1px solid var(--dn-toast-border);background:var(--dn-toast-bg);
  color:var(--dn-toast-text);box-shadow:var(--dn-toast-shadow);
  font:inherit;font-size:12.5px;text-align:left;cursor:pointer;}
.dn-toast:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6);}
.dn-toast-title{display:flex;align-items:center;gap:6px;font-weight:600;}
.dn-toast-dot{width:6px;height:6px;border-radius:50%;background:var(--dn-toast-brand);flex:none;}
.dn-toast-body{color:var(--dn-toast-muted);line-height:1.45;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}
`

    function ToastStack() {
      const [items, setItems] = React.useState(toastSnapshot)
      React.useEffect(() => {
        const unsubscribe = (() => {
          const listener = () => {
            const next = toastSnapshot()
            report('toast-render', { count: next.length })
            setItems(next)
          }
          toastListeners.add(listener)
          return () => toastListeners.delete(listener)
        })()
        return () => unsubscribe()
      }, [])
      if (items.length === 0) return null
      return h('div', { className: `dn-toasts pos-${toastPosition}` },
        h('style', null, TOAST_CSS),
        items.map((item) => h('button', {
          type: 'button',
          key: item.id,
          className: 'dn-toast',
          onClick: () => {
            if (item.sessionId && uiRef) {
              try {
                uiRef.openSession(item.sessionId)
              } catch {}
            }
            dismissToast(item)
          },
        },
        h('span', { className: 'dn-toast-title' }, h('span', { className: 'dn-toast-dot' }), item.title),
        h('span', { className: 'dn-toast-body' }, item.body),
        )),
      )
    }

    function Switch({ checked, onChange, label }) {
      // Deliberately plain: the host's own button styles win here, which is what
      // makes this row look native next to the shipped settings.
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'dn-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        onClick: () => onChange(!checked),
      }, h('span'))
    }

    function Panel() {
      const t = useT()
      const [state, setState] = React.useState({ phase: 'loading', settings: {}, pageStreams: 0 })
      const [busy, setBusy] = React.useState(false)
      /** The Host's per-process guard token; the custom scheme drops custom
       * headers, so it travels as a query parameter instead. */
      const tokenRef = React.useRef('')
      /** The `dsh-app://` scheme drops custom headers and may not forward PUT,
       * so every mutating call is a plain GET with the token in the query. */
      const queryUrl = (url, extra) => {
        const params = new URLSearchParams(extra)
        if (tokenRef.current) params.set('token', tokenRef.current)
        const search = params.toString()
        return search ? `${url}?${search}` : url
      }

      React.useEffect(() => {
        let live = true
        fetch(settingsUrl(), { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((value) => {
            if (!live) return
            if (typeof value.token === 'string') tokenRef.current = value.token
            setState({ phase: 'ready', settings: value.settings || {}, pageStreams: value.pageStreams || 0 })
            report('settings-loaded', { url: settingsUrl() })
          })
          .catch((error) => {
            report('settings-load-failed', {
              url: settingsUrl(),
              message: String(error && error.message ? error.message : error),
            })
            if (live) setState((prev) => ({ ...prev, phase: 'failed' }))
          })
        return () => {
          live = false
        }
      }, [])

      const update = (key, value) => {
        const next = { ...state.settings, [key]: value }
        setState({ ...state, settings: next })
        setBusy(true)
        fetch(queryUrl(settingsUrl(), { set: `${key}:${value}` }), { headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((result) => {
            if (typeof result.token === 'string') tokenRef.current = result.token
            setState({ phase: 'ready', settings: result.settings || next, pageStreams: result.pageStreams || 0 })
          })
          .catch(() => {
            setState((prev) => ({ ...prev, phase: 'failed' }))
          })
          .finally(() => setBusy(false))
      }

      const sendTest = () => {
        fetch(queryUrl(testUrl(), {}), { headers: { accept: 'application/json' } }).catch(() => {})
      }

      return h('div', { className: 'dn-panel' },
        h('style', null, PANEL_CSS),
        h('p', { className: 'dn-sub' }, t('panel.subtitle')),
        h('div', { className: 'dn-group' }, ROWS.map(([key, titleKey, descKey]) => h('div', { className: 'dn-row', key },
          h('div', { className: 'dn-row-main' },
            h('div', { className: 'dn-row-title' }, t(titleKey)),
            h('div', { className: 'dn-row-desc' }, t(descKey)),
          ),
          h(Switch, {
            checked: state.settings[key] !== false,
            label: t(titleKey),
            onChange: (value) => update(key, value),
          }),
        ))),
        h('div', { className: 'dn-group' },
          h('div', { className: 'dn-row dn-row-column' },
            h('div', { className: 'dn-row-main' },
              h('div', { className: 'dn-row-title' }, t('row.when')),
              h('div', { className: 'dn-row-desc' }, t('row.when.desc')),
            ),
            h('div', { className: 'dn-modes' }, WHEN_OPTIONS.map(([value, labelKey, descKey]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'dn-mode',
                'aria-pressed': (state.settings.when || 'away-session') === value ? 'true' : 'false',
                title: t(descKey),
                onClick: () => update('when', value),
              }, t(labelKey)),
            )),
          ),
        ),
        h('div', { className: 'dn-group' },
          h('div', { className: 'dn-row dn-row-column' },
            h('div', { className: 'dn-row-main' },
              h('div', { className: 'dn-row-title' }, t('row.pos')),
              h('div', { className: 'dn-row-desc' }, t('row.pos.desc')),
            ),
            h('div', { className: 'dn-modes' }, POSITION_OPTIONS.map(([value, labelKey]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'dn-mode',
                'aria-pressed': (state.settings.toastPosition || 'bottom-right') === value ? 'true' : 'false',
                onClick: () => update('toastPosition', value),
              }, t(labelKey)),
            )),
          ),
        ),
        h('div', { className: 'dn-foot' },
          h('button', { type: 'button', className: 'dn-btn', onClick: sendTest, disabled: busy }, t('action.test')),
          h('span', { className: 'dn-channel' },
            state.phase === 'loading'
              ? t('state.loading')
              : state.phase === 'failed'
                ? t('state.failed')
                : t(state.pageStreams > 0 ? 'channel.browser' : 'channel.none')),
        ),
      )
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 20
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' }),
        h('path', { d: 'M13.7 21a2 2 0 0 1-3.4 0' }),
      )
    }

    return {
      inject: ['uiWorkspace', 'slots', 'locale'],
      apply(ctx) {
        localeService = ctx.locale
        uiRef = ctx.uiWorkspace
        ctx.effect(() => ctx.locale.register('notify', 'zh', ZH))
        ctx.effect(() => ctx.locale.register('notify', 'en', EN))
        const translate = () => ctx.locale.bind('notify')('nav')

        const Ctor = window.Notification
        report('apply', {
          notification: typeof Ctor,
          permission: typeof Ctor === 'function' ? Ctor.permission : 'null',
          eventSource: typeof window.EventSource,
          secure: window.isSecureContext === true,
          badge: typeof navigator.setAppBadge,
          clearBadge: typeof navigator.clearAppBadge,
        })
        if (typeof Ctor !== 'function') return

        let source = null
        let releaseGesture = null
        let reconnectTimer = null
        /** Time of the last byte received on the stream, for the watchdog. */
        let lastSeen = 0
        /** Attention items the user has not looked at yet. */
        let unread = 0

        function paintBadge() {
          try {
            if (typeof navigator.setAppBadge !== 'function') {
              report('badge-missing', {})
              return
            }
            if (unread > 0) {
              Promise.resolve(navigator.setAppBadge(unread)).then(
                () => report('badge-set', { unread }),
                (error) => report('badge-error', { message: String(error && error.message ? error.message : error) }),
              )
            } else if (typeof navigator.clearAppBadge === 'function') {
              Promise.resolve(navigator.clearAppBadge()).then(
                () => report('badge-clear', {}),
                () => {},
              )
            } else {
              Promise.resolve(navigator.setAppBadge(0)).catch(() => {})
            }
          } catch (error) {
            report('badge-throw', { message: String(error) })
          }
        }

        function settleBadge() {
          if (unread === 0) return
          unread = 0
          paintBadge()
        }

        /** True when this page is the window the user is looking at AND it shows
         * the Session the notification is about. The page title carries the
         * selected Session's title, so a matching subtitle means the approval
         * card or the transcript for it is already on screen and a banner would
         * only interrupt. */
        /** The page is the window the user is looking at right now. */
        function pageFocused() {
          try {
            if (document.visibilityState !== 'visible') return false
            return typeof document.hasFocus !== 'function' || document.hasFocus()
          } catch {
            return false
          }
        }

        /** The page currently shows the Session this frame belongs to. The page
         * title carries the selected Session's title, so a matching subtitle
         * means that conversation — approval card or transcript — is on screen. */
        function showingSession(frame) {
          try {
            const subtitle = String(frame.subtitle || '').replace(/…$/, '').trim()
            if (!subtitle) return false
            return String(document.title || '').includes(subtitle.slice(0, 40))
          } catch {
            return false
          }
        }

        function show(frame) {
          // `when` is the user's timing choice: always / away from that Session /
          // only in the background.
          const mode = frame.when || 'away-session'
          if (mode !== 'always') {
            const focused = pageFocused()
            const suppress = mode === 'background' ? focused : focused && showingSession(frame)
            if (suppress) {
              report('suppressed', {
                kind: frame.kind,
                session: frame.sessionId,
                mode,
                title: String(document.title || ''),
                focused: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
                visibility: document.visibilityState,
              })
              return
            }
          }
          try {
            // A fresh tag per notification: reusing one makes the platform
            // replace the previous banner silently (no sound, no alert), which
            // looks exactly like "notifications stopped".
            const body = oneLine([frame.subtitle, frame.body].filter(Boolean).join(' · '), 220)
            const notification = new Ctor(frame.title || 'DeepSeek Harness', {
              body,
              tag: `${frame.kind || 'generic'}:${frame.sessionId || 'global'}:${frame.at || Date.now()}`,
              silent: frame.sound === false,
            })
            notification.onclick = () => {
              try {
                window.focus()
              } catch {}
              if (frame.sessionId) {
                try {
                  ctx.uiWorkspace.openSession(frame.sessionId)
                } catch {}
              }
              settleBadge()
              try {
                notification.close()
              } catch {}
            }
            notification.onshow = () => report('nb-onshow', { kind: frame.kind })
            notification.onerror = (event) => report('nb-error', {
              kind: frame.kind,
              message: String((event && event.error && event.error.message) || 'unknown'),
            })
            // The badge answers "what did I miss while I was away"; while the
            // window is in front the banner has already done that job.
            const away = !(document.visibilityState === 'visible'
              && (typeof document.hasFocus !== 'function' || document.hasFocus()))
            if (away) {
              unread += 1
              paintBadge()
            }
            // macOS delivers an app's notification while the app is active but
            // often shows no banner for it, which is exactly the "after I
            // clicked one, nothing appears" case. Actionable kinds therefore
            // also land in the page; informational ones only when away, where
            // the banner is the one that works.
            const actionable = frame.kind === 'approval' || frame.kind === 'question'
            if (frame.toastPosition) toastPosition = frame.toastPosition
            if (!away || actionable) {
              pushToast({
                kind: frame.kind,
                title: frame.title || 'DeepSeek Harness',
                body,
                sessionId: frame.sessionId,
              })
            }
            report('shown', { kind: frame.kind, session: frame.sessionId, unread, away, body, tag: notification.tag })
          } catch (error) {
            report('show-error', { message: String(error && error.message ? error.message : error) })
          }
        }

        function connect() {
          if (source) return
          if (Ctor.permission !== 'granted') {
            report('connect-skip', { permission: Ctor.permission })
            return
          }
          const Source = window.EventSource
          if (typeof Source !== 'function') {
            report('connect-skip', { reason: 'no EventSource' })
            return
          }
          try {
            source = new Source('/dsh-custom-notify/events')
          } catch (error) {
            source = null
            report('connect-error', { message: String(error && error.message ? error.message : error) })
            scheduleReconnect()
            return
          }
          lastSeen = Date.now()
          source.onopen = () => {
            lastSeen = Date.now()
            report('sse-open', { url: source ? source.url : '' })
          }
          source.onerror = () => dropStream('error')
          source.onmessage = (event) => {
            lastSeen = Date.now()
            if (!event.data) return
            // Permission withdrawn after connect: stop the stream so the Host
            // falls back to operating-system banners instead of losing them.
            if (Ctor.permission !== 'granted') {
              dropStream('permission')
              return
            }
            try {
              const frame = JSON.parse(event.data)
              if (frame && frame.kind !== 'ready' && frame.kind !== 'ping') show(frame)
            } catch {}
          }
        }

        /** EventSource stops retrying after an HTTP failure, and a Host reload
         * can hand the page exactly that, so the stream is rebuilt here. */
        function dropStream(reason) {
          report('sse-drop', { reason })
          if (source) {
            try {
              source.close()
            } catch {}
            source = null
          }
          scheduleReconnect()
        }

        function scheduleReconnect() {
          if (reconnectTimer) return
          if (Ctor.permission !== 'granted') return
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connect()
          }, 4000)
        }

        /** Browsers only prompt on a user gesture, so ask on the first one. */
        function armPermission() {
          const onGesture = () => {
            if (releaseGesture) releaseGesture()
            releaseGesture = null
            report('permission-gesture', {})
            let pending
            try {
              pending = Ctor.requestPermission()
            } catch (error) {
              report('permission-error', { message: String(error) })
              return
            }
            if (pending && typeof pending.then === 'function') {
              pending.then((state) => {
                report('permission', { state })
                if (state === 'granted') connect()
              }, () => {})
            }
          }
          document.addEventListener('pointerdown', onGesture, true)
          document.addEventListener('keydown', onGesture, true)
          releaseGesture = () => {
            document.removeEventListener('pointerdown', onGesture, true)
            document.removeEventListener('keydown', onGesture, true)
          }
        }

        ctx.effect(() => {
          const onAttention = () => settleBadge()
          const onVisibility = () => {
            if (document.visibilityState === 'visible') settleBadge()
          }
          window.addEventListener('focus', onAttention)
          document.addEventListener('visibilitychange', onVisibility)

          // A stream that stops delivering is indistinguishable from an idle
          // Host, so the Host sends a real `ping` event and this timer treats
          // its absence as a dead carrier.
          const watchdog = setInterval(() => {
            if (!source) return
            if (Date.now() - lastSeen > 70_000) dropStream('stale')
          }, 20_000)

          if (Ctor.permission === 'granted') connect()
          else if (Ctor.permission === 'default') armPermission()

          return () => {
            window.removeEventListener('focus', onAttention)
            document.removeEventListener('visibilitychange', onVisibility)
            clearInterval(watchdog)
            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = null
            if (releaseGesture) releaseGesture()
            releaseGesture = null
            if (source) {
              try {
                source.close()
              } catch {}
              source = null
            }
            settleBadge()
          }
        })

        // A slot this version does not declare, or an options shape it
        // rejects, must cost only that one entry — never the whole activation.
        function mount(owner, options, component) {
          try {
            const install = () => ctx.slots.register(options, component)
            const dispose = owner ? ctx.slots.inject(owner, install) : install()
            report('mount', { slot: options.name })
            return dispose
          } catch (error) {
            report('mount-error', {
              slot: options.name,
              message: String(error && error.message ? error.message : error),
            })
            return () => {}
          }
        }

        // The control panel: one page inside Settings, listed in its nav.
        ctx.effect(() => mount('settings.section', {
          name: 'settings.section',
          id: 'notify',
          order: 40,
          label: () => translate(),
        }, Panel))
        // The nav glyph seat appears only once the settings shell renders, so
        // this waits on the declaration instead of registering eagerly.
        ctx.effect(() => mount('settings.section.icon', { name: 'settings.section.icon', id: 'notify', order: 40 }, PanelIcon))
        ctx.effect(() => mount(null, { name: 'shell.overlay', id: 'notify-toast', order: 90 }, ToastStack))
        report('apply-done', {})
      },
    }
  },
})

function oneLine(value, max) {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Best-effort telemetry for the Host-side diagnostics log. */
function report(name, detail) {
  try {
    const body = JSON.stringify({
      name,
      detail,
      href: String(window.location.pathname),
      at: Date.now(),
    })
    fetch('/dsh-custom-notify/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {}
}
