#!/usr/bin/env node
// Fold the tsdown banner back onto the single line the loader contract
// expects (hosts sniff `window.__ModuleLoader__.load({ id: "…"` from the
// file head). Blank-line padding keeps line counts stable. Mirrors
// dsh-market scripts/normalize-client-banner.mjs (banner part only — this
// bundle has no CSS modules to normalize).
import fs from 'node:fs'

const file = 'client/client.js'
const clientPkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientPkg)}, factory: (require) => {`
let code = fs.readFileSync(file, 'utf8')
if (code.startsWith(required)) {
  // Already normalized.
} else if (code.startsWith('window.__ModuleLoader__.load(')) {
  const end = code.indexOf('{', code.indexOf('load(')) // start of the object
  const lines = code.split('\n')
  const headEnd = lines.findIndex(line => line.includes('factory:'))
  if (headEnd === -1) throw new Error('client banner factory line not found')
  const head = lines.slice(0, headEnd + 1)
  const folded = `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientPkg)}, factory: (require) => {`
  const padding = head.slice(1, -1).map(() => '')
  code = [folded, ...padding, ...lines.slice(headEnd + 1)].join('\n')
} else {
  throw new Error(`client/client.js does not start with the loader banner; got: ${code.slice(0, 80)}`)
}
fs.writeFileSync(file, code)
console.log('client banner normalized')
