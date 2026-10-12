import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Regression: ISSUE-002 — the npm tarball must ship the bundle patch file.
// `files` omitted cordis.patch.yml, so a registry install left the manifest
// declaring dsh.bundle.patch while the file was absent — every profile boot
// then failed loud with "failed to read overlay ... ENOENT". A link: install
// hides this (the whole repo is visible), which is why only a tarball install
// reproduces it. Found by /qa on 2026-08-27.
describe('package distribution shape', () => {
  it('files ships the bundle patch declared by dsh.bundle.patch', async () => {
    const manifest = JSON.parse(await readFile(`${repoRoot}/package.json`, 'utf8')) as {
      files?: string[]
      dsh?: { bundle?: { patch?: string } }
    }
    const patch = manifest.dsh?.bundle?.patch
    expect(patch).toBe('./cordis.patch.yml')
    expect(manifest.files ?? []).toContain('cordis.patch.yml')
  })

  it('declared type entry points match the flat lib/ declaration layout', async () => {
    // Regression: ISSUE-003 — types/exports pointed at lib/types/*.d.ts while
    // tsc (outDir lib, rootDir src) emits declarations beside the JS at the
    // lib/ root, so every types consumer resolved a dangling path.
    const manifest = JSON.parse(await readFile(`${repoRoot}/package.json`, 'utf8')) as {
      types?: string
      exports?: Record<string, { types?: string }>
    }
    expect(manifest.types).toBe('lib/index.d.ts')
    expect(manifest.exports?.['.']?.types).toBe('./lib/index.d.ts')
    expect(manifest.exports?.['./pack']?.types).toBe('./lib/pack.d.ts')
  })
})

// Regression: ISSUE-001 — bundle patch rows must import the real package name.
// A cordis entry's `name` is the loader's import specifier, not a display
// label: `name: docwright` booted the real dsh host to
// "Cannot find package 'docwright'" while all unit tests stayed green (they
// mount the plugin programmatically and never cross the patch layer).
// Found by /qa on 2026-08-27 via a `dsh plugin add` host-mount smoke.
describe('cordis.patch.yml bundle shape', () => {
  it('every insert row names the importable package name', async () => {
    const patch = await readFile(`${repoRoot}/cordis.patch.yml`, 'utf8')
    const manifest = JSON.parse(await readFile(`${repoRoot}/package.json`, 'utf8')) as { name: string }
    const names = [...patch.matchAll(/^\s*name:\s*'?[^\s']+'?\s*$/gm)].map(line => line[0].trim().replace(/^name:\s*/, '').replace(/'/g, ''))
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(name).toBe(manifest.name)
    }
  })
})
