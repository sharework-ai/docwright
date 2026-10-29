import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findOwnNamespace, setPackParamDefault, updateConfigViaHost } from '../src/params-writes.ts'
import type { SettingsDescriptorLike, SettingsServiceLike } from '../src/params-writes.ts'
import { loadPacks } from '../src/pack-loader.ts'

const B70 = { value: 70, downFactor: 0.9, upFactor: 1.2 }

/** A minimal pack with one editable (defaulted) param and one required param. */
async function packFixture(root: string, defaults: Record<string, unknown> = { limit: 3 }): Promise<void> {
  const dir = join(root, 'wp')
  for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(dir, sub), { recursive: true })
  const params: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(defaults)) {
    params[name] = { type: 'number', default: value, min: 1, max: 20, description: 'd' }
  }
  params.shares = { type: 'object', required: true, confirm: true, description: 'no default here' }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    name: 'wp', version: '1', description: 'd', consumes: [], languages: ['zh-CN'], params,
  }), 'utf8')
  await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(dir, 'rules', 'zh-CN.json'), '[]', 'utf8')
  await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'T {{materials}}', 'utf8')
  await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(dir, 'samples', 'golden.json'), '{}', 'utf8')
}

async function writeDeps() {
  const root = await mkdtemp(join(tmpdir(), 'docwright-writes-'))
  await packFixture(root)
  const packs = new Map(await loadPacks(root, {}))
  return {
    root,
    packs,
    deps: { packs, builtinRoot: root, loadPacks: (r: string, d: { extra?: readonly string[] | undefined }) => loadPacks(r, d) },
  }
}

describe('findOwnNamespace', () => {
  it('locates docwright by exact package name and suffix, with revision', () => {
    const a: SettingsDescriptorLike = { ns: 'e1', plugins: [{ name: '@sharework-ai/dsh-docwright' }], revision: 4 }
    expect(findOwnNamespace([a])).toEqual({ ns: 'e1', revision: 4 })
    const b: SettingsDescriptorLike = { ns: 'e2', plugins: ['x/y', 'sharework-ai/dsh-docwright'] }
    expect(findOwnNamespace([b]).ns).toBe('e2')
  })

  it('fails loud when no descriptor serves docwright', () => {
    expect(() => findOwnNamespace([{ ns: 'e', plugins: ['other'] }])).toThrow(/no settings form for docwright/)
    expect(() => findOwnNamespace([])).toThrow(/no settings form for docwright/)
    expect(() => findOwnNamespace([{ ns: 'e', plugins: 'weird' as never }])).toThrow(/no settings form for docwright/)
  })
})

describe('updateConfigViaHost', () => {
  it('describes, locates the namespace, and merges with the revision', async () => {
    const calls: Array<{ ns: string; patch: object; revision?: number }> = []
    const settings: SettingsServiceLike = {
      describe: () => [{ ns: 'own', plugins: ['@sharework-ai/dsh-docwright'], revision: 7 }],
      update: (ns, patch, expectedRevision) => {
        calls.push({ ns, patch, ...(expectedRevision === undefined ? {} : { revision: expectedRevision }) })
        return Promise.resolve()
      },
    }
    await updateConfigViaHost(settings, { confirmPolicy: 'strict' })
    expect(calls).toEqual([{ ns: 'own', patch: { confirmPolicy: 'strict' }, revision: 7 }])
  })
})

describe('setPackParamDefault', () => {
  it('writes the manifest, reloads, and hot-swaps the same map instance', async () => {
    const { root, packs, deps } = await writeDeps()
    await setPackParamDefault(deps, 'wp', 'limit', 9)
    // The SAME map instance now serves the new default (tools see it without a restart).
    expect(packs.get('wp')!.manifest.params!.limit!.default).toBe(9)
    const onDisk = JSON.parse(await readFile(join(root, 'wp', 'manifest.json'), 'utf8')) as { params: { limit: { default: number } } }
    expect(onDisk.params.limit.default).toBe(9)
    // The write is pretty-printed with a trailing newline (human-editable).
    const raw = await readFile(join(root, 'wp', 'manifest.json'), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('refuses to write when the manifest is corrupt or the param vanished, and reports reload failures', async () => {
    const { root, packs, deps } = await writeDeps()
    await writeFile(join(root, 'wp', 'manifest.json'), '{corrupt', 'utf8')
    await expect(setPackParamDefault(deps, 'wp', 'limit', 4)).rejects.toThrow(/not valid JSON/)
    // Manifest present but params.<name> gone (file edited under us).
    await writeFile(join(root, 'wp', 'manifest.json'), JSON.stringify({
      name: 'wp', version: '1', description: 'd', consumes: [], languages: ['zh-CN'],
      params: { other: { type: 'number', default: 1, description: 'd' } },
    }), 'utf8')
    await expect(setPackParamDefault(deps, 'wp', 'limit', 4)).rejects.toThrow(/no longer declares params\.limit/)
    // A reload failure (broken ruleset elsewhere in the root) is loud even though the manifest itself was fine.
    await packFixture(root)
    await mkdir(join(root, 'broken-pack'), { recursive: true })
    await writeFile(join(root, 'broken-pack', 'manifest.json'), '{"name": "broken"}', 'utf8')
    const good = JSON.parse(await readFile(join(root, 'wp', 'manifest.json'), 'utf8')) as never
    void good
    await writeFile(join(root, 'wp', 'manifest.json'), JSON.stringify({
      name: 'wp', version: '1', description: 'd', consumes: [], languages: ['zh-CN'],
      params: { limit: { type: 'number', default: 3, min: 1, max: 20, description: 'd' }, shares: { type: 'object', required: true, confirm: true, description: 'no default here' } },
    }), 'utf8')
    await expect(setPackParamDefault(deps, 'wp', 'limit', 5)).rejects.toThrow(/reloading packs failed/)
    expect(packs.get('wp')!.manifest.params!.limit!.default).toBe(3)
    await rm(join(root, 'broken-pack'), { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  })

  it('refuses unknown packs, non-defaulted params, and load-invalid values without writing', async () => {
    const { root, deps } = await writeDeps()
    const before = await readFile(join(root, 'wp', 'manifest.json'), 'utf8')
    await expect(setPackParamDefault(deps, 'ghost', 'limit', 4)).rejects.toThrow(/unknown pack "ghost"/)
    // shares has no default: editing it is a structural change, not maintenance.
    await expect(setPackParamDefault(deps, 'wp', 'shares', B70)).rejects.toThrow(/does not declare a default/)
    // Out-of-range default: the load-time gate rejects the manifest before disk.
    await expect(setPackParamDefault(deps, 'wp', 'limit', 99)).rejects.toThrow(/default must be <= max/)
    expect(await readFile(join(root, 'wp', 'manifest.json'), 'utf8')).toBe(before)
    await rm(root, { recursive: true, force: true })
  })
})
