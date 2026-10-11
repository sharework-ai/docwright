import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { effectiveWorkspaceRoot, normalizeWindowsPath, resolveRootWithin, wslpathTranslate } from '../src/paths.ts'
import { defineDocGenerateTool } from '../src/tools.ts'
import { loadPacks } from '../src/pack-loader.ts'
import { fileURLToPath } from 'node:url'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))
const signal = new AbortController().signal

describe('effectiveWorkspaceRoot', () => {
  it('prefers the session workspace cwd over config and process cwd', () => {
    const root = effectiveWorkspaceRoot({ agent: { session: { cwd: '/tmp/session-ws' } } }, '/tmp/config-ws')
    expect(root).toBe('/tmp/session-ws')
  })

  it('falls back to config workspaceRoot without a session cwd', () => {
    expect(effectiveWorkspaceRoot(undefined, '/tmp/config-ws')).toBe('/tmp/config-ws')
    expect(effectiveWorkspaceRoot({ agent: { session: { cwd: '' } } }, '/tmp/config-ws')).toBe('/tmp/config-ws')
  })

  it('falls back to the process cwd when neither is set', () => {
    expect(effectiveWorkspaceRoot(undefined, undefined)).toBe(process.cwd())
  })
})

describe('normalizeWindowsPath (wslpath subprocess with regex fallback)', () => {
  it('uses the real wslpath binary on WSL (default mounts)', () => {
    expect(normalizeWindowsPath('D:\\projects\\lab\\需求 说明.md')).toBe('/mnt/d/projects/lab/需求 说明.md')
    expect(normalizeWindowsPath('d:/x/y.md')).toBe('/mnt/d/x/y.md')
  })

  it('falls back to the regex translation when wslpath is unavailable', () => {
    expect(normalizeWindowsPath('d:/x/y.md', () => undefined)).toBe('/mnt/d/x/y.md')
    expect(normalizeWindowsPath('D:\\a\\b.md', () => undefined)).toBe('/mnt/d/a/b.md')
  })

  it('prefers the wslpath result over the regex when both exist', () => {
    expect(normalizeWindowsPath('D:\\x\\y.md', () => '/custom/root/d/x/y.md')).toBe('/custom/root/d/x/y.md')
  })

  it('a failing wslpath binary reports unavailable and the regex takes over', () => {
    expect(wslpathTranslate('D:\\x\\y.md', 'definitely-not-a-real-wslpath')).toBeUndefined()
    expect(normalizeWindowsPath('D:\\x\\y.md', ref => wslpathTranslate(ref, 'definitely-not-a-real-wslpath'))).toBe('/mnt/d/x/y.md')
  })

  it('a working wslpath binary translates through the subprocess (fake executable)', async () => {
    // Probe (-u C:\) succeeds and translations echo a fixed mount.
    const fakeEcho = join(tmpdir(), `fake-wslpath-echo-${Date.now()}`)
    await writeFile(fakeEcho, '#!/bin/sh\necho "/fake/mnt/$2"\n', { mode: 0o755 })
    expect(wslpathTranslate('D:\\x\\y.md', fakeEcho)).toBe('/fake/mnt/D:\\x\\y.md')
    expect(normalizeWindowsPath('D:\\x\\y.md', ref => wslpathTranslate(ref, fakeEcho))).toBe('/fake/mnt/D:\\x\\y.md')
  })

  it('a wslpath binary whose translation fails falls back to the regex', async () => {
    // Probe succeeds, every translation exits non-zero.
    const fakeFail = join(tmpdir(), `fake-wslpath-fail-${Date.now()}`)
    await writeFile(fakeFail, '[ "$2" = "C:\\" ] && exit 0\nexit 1\n', { mode: 0o755 })
    expect(wslpathTranslate('D:\\x\\y.md', fakeFail)).toBeUndefined()
    expect(normalizeWindowsPath('D:\\x\\y.md', ref => wslpathTranslate(ref, fakeFail))).toBe('/mnt/d/x/y.md')
  })

  it('passes POSIX paths and plain filenames through unchanged (no subprocess)', () => {
    expect(normalizeWindowsPath('/mnt/d/x.md')).toBe('/mnt/d/x.md')
    expect(normalizeWindowsPath('req.md')).toBe('req.md')
    expect(normalizeWindowsPath('D:nope.md')).toBe('D:nope.md')
  })
})

describe('resolveRootWithin', () => {  it('defaults materialsRoot to references/ and outputRoot to output/', () => {
    expect(resolveRootWithin('/tmp/ws', undefined, 'materialsRoot')).toBe('/tmp/ws/references')
    expect(resolveRootWithin('/tmp/ws', undefined, 'outputRoot')).toBe('/tmp/ws/output')
  })

  it('joins relative specs and accepts absolute specs inside the workspace', () => {
    expect(resolveRootWithin('/tmp/ws', '素材', 'materialsRoot')).toBe('/tmp/ws/素材')
    expect(resolveRootWithin('/tmp/ws', '/tmp/ws/custom-out', 'outputRoot')).toBe('/tmp/ws/custom-out')
  })

  it('fails loud when the resolved root escapes the workspace', () => {
    expect(() => resolveRootWithin('/tmp/ws', '../elsewhere', 'materialsRoot')).toThrow(/materialsRoot escapes the workspace root/)
    expect(() => resolveRootWithin('/tmp/ws', '/etc', 'outputRoot')).toThrow(/outputRoot escapes the workspace root/)
  })
})

describe('session-driven roots end to end (doc_generate via tool)', () => {
  it('reads materials from <session-ws>/references and writes to <session-ws>/output', async () => {
    const packs = await loadPacks(packsRoot, {})
    const pack = packs.get('cosmic-plan')!
    const sessionWs = await mkdtemp(join(tmpdir(), 'hanzeep-session-'))
    await mkdir(join(sessionWs, 'references'), { recursive: true })
    await writeFile(join(sessionWs, 'references', 'req.md'), '素材内容', 'utf8')
    const configWs = await mkdtemp(join(tmpdir(), 'hanzeep-config-'))
    const tool = defineDocGenerateTool({
      packs,
      config: { workspaceRoot: configWs, maxIterations: 3, promptTokenBudget: 60_000, model: 'test', provider: 'x' },
      ctx: {
        llm: {
          stream: async function* () {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: JSON.stringify(pack.goldenSample) }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(pack.goldenSample) } }
            yield { type: 'finish', reason: 'stop' }
          },
        },
      },
    })
    const out = await tool.execute(
      { pack: 'cosmic-plan', materials: ['req.md'], artifactName: 'sess' } as never,
      { agent: { session: { cwd: sessionWs } }, signal } as never,
    ) as unknown as { artifactPath: string }
    expect(out.artifactPath).toBe(join(sessionWs, 'output', 'sess.json'))
    expect(JSON.parse(await readFileUtf8(out.artifactPath)).docType).toBe('plan')
  })
})

async function readFileUtf8(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path, 'utf8')
}
