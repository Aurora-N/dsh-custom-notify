/** Small helpers shared by the Host modules. */

export function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function messageOf(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message) return error.message
  return String(error)
}

export function oneLine(value, max) {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Plain timeout on purpose: `ctx.timeout` mixes in a service method that throws
 * when the service context is not the caller's, and that failure would silently
 * drop every settled-turn notification. */
export function schedule(callback, delay) {
  const handle = setTimeout(callback, delay)
  return () => clearTimeout(handle)
}
