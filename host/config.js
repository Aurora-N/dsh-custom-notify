/**
 * Configuration surface of the notifications plugin: defaults, wording, the
 * settings keys the panel may change, and their persistence.
 *
 * Nothing here touches a Cordis context; `index.js` assembles the pieces.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dataFile } from './data-dir.js'

export const DEFAULT_CONFIG = {
  /** Notify when a tool call waits for the user's approval decision. */
  approval: true,
  /** Notify when the model asks the user a structured question. */
  question: true,
  /** Notify when a turn settled (the agent returned to idle). */
  turnEnd: true,
  /** Notify when a turn errored. */
  error: true,
  /** Notify for a subagent session's approval and question requests. */
  subagentApproval: false,
  /** Notify when a subagent session settles or fails. */
  subagentDone: false,
  /** When to notify: `always`, `away-session` (the page is not showing that
   * Session) or `background` (the app is not in front). */
  when: 'away-session',
  /** Play the notification sound. */
  sound: true,
  /** Where the in-page notice stack sits: one of `bottom-right`,
   * `bottom-left`, `top-right`, `top-left`. */
  toastPosition: 'bottom-right',
  /** Idle must hold this long before a settled turn is announced, so a goal or
   * queued round that resumes immediately does not notify twice. */
  settleMs: 1200,
  /** Identical notifications closer together than this collapse into one. */
  coalesceMs: 1500,
  /** Notification wording. */
  language: 'zh',
  /** Append delivery decisions to `diagnostics.log` next to this module. */
  diagnostics: true,
}

export const TEXT = {
  zh: {
    approval: '需要你审核',
    question: '需要你回答',
    done: '执行完成',
    error: '执行出错',
    test: '通知测试',
    testBody: '如果你看到这条通知，说明通知链路是通的。',
    doneBody: (seconds) => `本轮已结束，用时 ${seconds} 秒`,
    doneBodyShort: '本轮已结束',
    unnamed: '未命名会话',
  },
  en: {
    approval: 'Approval needed',
    question: 'Your answer is needed',
    done: 'Turn finished',
    error: 'Turn failed',
    test: 'Notification test',
    testBody: 'If you can see this, the notification path works.',
    doneBody: (seconds) => `Settled after ${seconds}s`,
    doneBodyShort: 'Turn finished',
    unnamed: 'Untitled session',
  },
}

export function textFor(language) {
  return TEXT[language] ?? TEXT.zh
}

/** Tool calls that are themselves a request for the user's attention. */
export const QUESTION_TOOLS = new Set(['ask_user_question'])

/** Settings the panel may change at runtime; everything else stays in the patch. */
export const BOOLEAN_KEYS = [
  'approval',
  'question',
  'turnEnd',
  'error',
  'subagentApproval',
  'subagentDone',
  'sound',
]
export const WHEN_MODES = new Set(['always', 'away-session', 'background'])
export const TOAST_POSITIONS = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left'])
export const SETTINGS_KEYS = [...BOOLEAN_KEYS, 'when', 'toastPosition']

const SETTINGS_FILE = dataFile('settings.json')

/** Accept only a value this build understands; anything else is "not chosen". */
export function normalizeSetting(key, value) {
  if (key === 'when') {
    return typeof value === 'string' && WHEN_MODES.has(value) ? value : undefined
  }
  if (key === 'toastPosition') {
    return typeof value === 'string' && TOAST_POSITIONS.has(value) ? value : undefined
  }
  return typeof value === 'boolean' ? value : undefined
}

/** Panel choices persisted next to the plugin; a missing or broken file is
 * simply "nothing chosen yet". */
export function loadSettings() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    const settings = {}
    for (const key of SETTINGS_KEYS) {
      const value = normalizeSetting(key, parsed?.[key])
      if (value !== undefined) settings[key] = value
    }
    // Migration: one `subagents` boolean used to gate both child kinds.
    if (typeof parsed?.subagents === 'boolean') {
      if (parsed.subagentApproval === undefined) settings.subagentApproval = parsed.subagents
      if (parsed.subagentDone === undefined) settings.subagentDone = parsed.subagents
    }
    return settings
  } catch {
    return {}
  }
}

export function saveSettings(config) {
  const payload = {}
  for (const key of SETTINGS_KEYS) {
    const value = normalizeSetting(key, config[key])
    if (value !== undefined) payload[key] = value
  }
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(payload, null, 2)}\n`)
}

/** What the panel renders: every boolean switch plus the two enum choices. */
export function effectiveSettings(config, pageStreams) {
  const settings = {}
  for (const key of BOOLEAN_KEYS) settings[key] = config[key] !== false
  settings.when = WHEN_MODES.has(config.when) ? config.when : DEFAULT_CONFIG.when
  settings.toastPosition = TOAST_POSITIONS.has(config.toastPosition)
    ? config.toastPosition
    : DEFAULT_CONFIG.toastPosition
  return { settings, pageStreams }
}
