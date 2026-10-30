/**
 * pack:check CLI — authoring verification ladder layers 1-2 in one command
 * (docs/designs/pack-authoring.md). Thin wrapper over checkPacks(): the
 * loader gate + per-language golden green through the real DocService.
 *
 * Usage: pnpm run pack:check -- <packs-dir> [--with <other-root>]...
 * `--with` merges extra pack roots (same-name wins) so a packsDir pack can
 * resolve consumed upstreams (e.g. the repository's built-in packs/).
 * Exit:  0 all green · 1 golden failures · 2 usage/loader failure
 */

import { resolve } from 'node:path'
import { checkPacks, renderPackCheckReport } from '../src/pack-check.ts'

const args = process.argv.slice(2).filter(arg => arg !== '--')
const dir = args[0]
const extraRoots: string[] = []
for (let i = 1; i < args.length; i++) {
  if (args[i] !== '--with' || args[i + 1] === undefined) {
    console.error('usage: pnpm run pack:check -- <packs-dir> [--with <other-root>]...')
    process.exit(2)
  }
  extraRoots.push(resolve(args[++i]!))
}
if (dir === undefined || dir === '') {
  console.error('usage: pnpm run pack:check -- <packs-dir> [--with <other-root>]...')
  process.exit(2)
}

try {
  const report = await checkPacks(resolve(dir), { extraRoots })
  console.log(renderPackCheckReport(report))
  process.exit(report.green ? 0 : 1)
} catch (error) {
  console.error(`pack:check: FAIL: ${(error as Error).message}`)
  process.exit(2)
}
