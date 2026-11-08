/**
 * Writable state belongs to the user, never to the installed package: an
 * installed plugin lives under `node_modules` (or a pnpm store) which may be
 * read-only, shared between projects, or replaced on upgrade.
 *
 * `DSH_HOME` is honoured when the Host sets it; otherwise the standard `~/.dsh`.
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'dsh-custom-notify')

export function dataDir() {
  try {
    mkdirSync(DIR, { recursive: true })
  } catch {}
  return DIR
}

export function dataFile(name) {
  return join(dataDir(), name)
}
