import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const fail = (message) => { console.error('preflight: FAIL — ' + message); process.exit(1) }

if (pkg.name !== 'dsh-browser-annotate') fail('unexpected package name')
if (!pkg.dsh || pkg.dsh.manifestVersion !== 1) fail('missing dsh.manifestVersion')
if (pkg.dsh.bundle?.patch !== './cordis.patch.yml') fail('missing bundle patch')
if (pkg.dsh.client?.platform !== 'web') fail('client platform must be web')
for (const file of pkg.files) if (!existsSync(resolve(root, file))) fail('missing file ' + file)
const client = readFileSync(resolve(root, 'client.js'), 'utf8')
if (!client.includes("id: 'dsh-browser-annotate'")) fail('client module id mismatch')
const host = readFileSync(resolve(root, 'index.js'), 'utf8')
if (!host.includes("name = 'dsh-browser-annotate'")) fail('host plugin name mismatch')
if (!host.includes('/dsh-browser-annotate')) fail('missing host route')
console.log('preflight: OK — ' + pkg.name + '@' + pkg.version)
