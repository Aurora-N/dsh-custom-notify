/**
 * The package name is load-bearing in three places: the npm package itself, the
 * client module id the page registers, and the bundle patch row the Loader
 * mounts. A mismatch fails quietly (a settings page that never appears), so CI
 * checks it before every publish.
 */
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pkg = JSON.parse(read('../package.json'))
const clientId = /id:\s*'([^']+)'/.exec(read('../client.js'))?.[1]
const patchName = /name:\s*'([^']+)'/.exec(read('../cordis.patch.yml'))?.[1]

const problems = []
if (typeof pkg.name !== 'string' || pkg.name.length === 0) problems.push('package.json 缺少 name')
if (clientId !== pkg.name) problems.push(`client.js 的 id（${clientId}）必须等于包名（${pkg.name}）`)
if (patchName !== pkg.name) problems.push(`cordis.patch.yml 的行 name（${patchName}）必须等于包名（${pkg.name}）`)

if (problems.length > 0) {
  console.error(`✗ ${problems.join('\n✗ ')}`)
  process.exit(1)
}

console.log(`✓ 名称一致：${pkg.name}`)
