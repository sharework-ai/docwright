import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readMaterials } from '../src/materials.ts'
import { artifactHashOf } from '../src/receipt.ts'
import { fileURLToPath } from 'node:url'

function packsRoot(): string {
  return fileURLToPath(new URL('../packs', import.meta.url))
}


describe('materials', () => {
  it('reads files relative to the materials root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await writeFile(join(root, 'req.md'), '需求内容', 'utf8')
    expect(await readMaterials(['req.md'], root, [root])).toEqual(['需求内容'])
  })

  it('resolves against a references subdirectory when passed as the materials root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await mkdir(join(root, 'references'), { recursive: true })
    await writeFile(join(root, 'references', 'req.md'), 'ref content', 'utf8')
    expect(await readMaterials(['req.md'], root, [join(root, 'references')])).toEqual(['ref content'])
  })

  it('allows ../ references that stay inside the workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await mkdir(join(root, 'references'), { recursive: true })
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'a.md'), 'doc content', 'utf8')
    expect(await readMaterials(['../docs/a.md'], root, [join(root, 'references')])).toEqual(['doc content'])
  })

  it('reads CJK and space filenames (test-plan edge case)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await mkdir(join(root, '子 目录'), { recursive: true })
    await writeFile(join(root, '子 目录', '需求 素材.md'), ' spaced content ', 'utf8')
    expect(await readMaterials(['子 目录/需求 素材.md'], root, [root])).toEqual([' spaced content '])
  })

  it('rejects path traversal outside the workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await expect(readMaterials(['../../etc/passwd'], root, [root])).rejects.toThrow(/escapes the workspace root/)
  })

  it('rejects traversal escaping the workspace from the materials root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await expect(readMaterials(['../../../etc/passwd'], root, [join(root, 'references')])).rejects.toThrow(/escapes the workspace root/)
  })

  it('an empty materials list is legal (chained packs may rely on upstream alone)', async () => {
    await expect(readMaterials([], '/tmp', ['/tmp'])).resolves.toEqual([])
  })

  it('accepts a ref that redundantly repeats the materials root directory name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-mat-'))
    await mkdir(join(root, 'references'), { recursive: true })
    await writeFile(join(root, 'references', 'arch.md'), 'arch content', 'utf8')
    expect(await readMaterials(['references/arch.md'], root, [join(root, 'references')])).toEqual(['arch content'])
  })

  it('ENOENT error lists each candidate root with its files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-mat-'))
    await mkdir(join(root, 'references'), { recursive: true })
    await mkdir(join(root, 'topic', 'references'), { recursive: true })
    await writeFile(join(root, 'references', 'req.md'), 'req content', 'utf8')
    await expect(readMaterials(['missing.md'], root, [join(root, 'topic', 'references'), join(root, 'references')]))
      .rejects.toThrow(/material not readable: missing\.md[\s\S]*topic\/references\/ has: \(no files\)[\s\S]*references\/ has: req\.md/)
    await expect(readMaterials(['also-missing.md'], root, [join(root, 'references')]))
      .rejects.toThrow(/references\/ has: req\.md/)
  })

  it('topic-level root shadows the workspace-level one; the latter is the fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-mat-'))
    await mkdir(join(root, 'topic-a', 'input'), { recursive: true })
    await mkdir(join(root, 'input'), { recursive: true })
    await writeFile(join(root, 'topic-a', 'input', 'req.md'), 'topic input', 'utf8')
    await writeFile(join(root, 'input', 'req.md'), 'shared input', 'utf8')
    const roots = [join(root, 'topic-a', 'input'), join(root, 'input')]
    expect(await readMaterials(['req.md'], root, roots)).toEqual(['topic input'])
    expect(await readMaterials(['req.md'], root, [roots[1]!])).toEqual(['shared input'])
  })

  it('ENOENT on a nonexistent candidate root lists it as missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-mat-'))
    await expect(readMaterials(['req.md'], root, [join(root, 'nowhere')]))
      .rejects.toThrow(/nowhere\/ has: \(directory does not exist\)/)
  })

  it('rejects a missing file with a readable error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-ws-'))
    await expect(readMaterials(['nope.md'], root, [root])).rejects.toThrow(/not readable/)
  })

  it('reads inline text marked with #!inline', async () => {
    const out = await readMaterials(['#!inline\n直接素材'], '/tmp', ['/tmp'])
    expect(out).toEqual(['直接素材'])
  })
})

describe('doc-service generateDocument', () => {
  it('green path writes artifact, receipt, and markdown; then doc_validate revalidates', async () => {
    const { loadPacks } = await import('../src/pack-loader.ts')
    const { generateDocument, DocService } = await import('../src/doc-service.ts')
    const { readFile } = await import('node:fs/promises')
    const packs = await loadPacks(packsRoot(), { builtin: [] })
    const pack = packs.get('cosmic-plan')!
    const contextGolden = JSON.stringify(packs.get('cosmic-context')!.goldenSample)
    const root = await mkdtemp(join(tmpdir(), 'docwright-gen-'))
    const llm = { async complete() { return JSON.stringify(pack.goldenSample) } }
    const out = await generateDocument({
      pack, language: 'zh-CN', materials: ['#!inline\n素材'], upstream: [contextGolden], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, artifactName: 't1',
      materialsRoots: [root], workspaceRoot: root, outputRoot: join(root, 'output'),
      config: { maxIterations: 3, promptTokenBudget: 60_000, model: 'test' },
      llm,
      onRound: () => {},
    })
    expect(out.receipt.isValid).toBe(true)
    const receiptOnDisk = JSON.parse(await readFile(`${out.artifactPath.replace('.json', '')}.receipt.json`, 'utf8'))
    expect(receiptOnDisk.isValid).toBe(true)
    const md = await readFile(out.markdownPath, 'utf8')
    expect(md.length).toBeGreaterThan(0)

    // revalidate deterministic path (doc_validate core)
    const service = new DocService(pack, 'zh-CN')
    const artifact = JSON.parse(await readFile(out.artifactPath, 'utf8'))
    expect(service.validate(artifact, undefined, { upstream: [JSON.parse(contextGolden)] }).filter(i => i.severity === 'error')).toEqual([])
    expect(artifactHashMatches(service, artifact, receiptOnDisk.artifactHash)).toBe(true)
  })

  it('writes to a custom output root when given one', async () => {
    const { loadPacks } = await import('../src/pack-loader.ts')
    const { generateDocument } = await import('../src/doc-service.ts')
    const { readFile } = await import('node:fs/promises')
    const packs = await loadPacks(packsRoot(), { builtin: [] })
    const pack = packs.get('cosmic-plan')!
    const root = await mkdtemp(join(tmpdir(), 'docwright-gen-'))
    const customOut = join(root, '交付物')
    const llm = { async complete() { return JSON.stringify(pack.goldenSample) } }
    const out = await generateDocument({
      pack, language: 'zh-CN', materials: ['#!inline\n素材'], upstream: [JSON.stringify(packs.get('cosmic-context')!.goldenSample)], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, artifactName: 'custom',
      materialsRoots: [root], workspaceRoot: root, outputRoot: customOut,
      config: { maxIterations: 3, promptTokenBudget: 60_000, model: 'test' },
      llm,
      onRound: () => {},
    })
    expect(out.artifactPath).toBe(join(customOut, 'custom.json'))
    expect(JSON.parse(await readFile(out.artifactPath, 'utf8')).docType).toBe('plan')
  })

  it('exhausted loop keeps the draft + red receipt and throws', async () => {
    const { loadPacks } = await import('../src/pack-loader.ts')
    const { generateDocument } = await import('../src/doc-service.ts')
    const { readFile } = await import('node:fs/promises')
    const packs = await loadPacks(packsRoot(), { builtin: [] })
    const pack = packs.get('cosmic-plan')!
    const root = await mkdtemp(join(tmpdir(), 'docwright-gen-'))
    const bad = JSON.parse(JSON.stringify(pack.goldenSample))
    bad.functions[0].funcDesc = '短'
    const llm = { async complete() { return JSON.stringify(bad) } }
    await expect(generateDocument({
      pack, language: 'zh-CN', materials: ['#!inline\n素材'], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, artifactName: 't2',
      materialsRoots: [root], workspaceRoot: root, outputRoot: join(root, 'output'),
      config: { maxIterations: 3, promptTokenBudget: 60_000, model: 'test' }, llm, onRound: () => {},
    })).rejects.toThrow(/exhausted/)
    const receipt = JSON.parse(await readFile(join(root, 'output', 't2.receipt.json'), 'utf8'))
    expect(receipt.isValid).toBe(false)
    const draft = JSON.parse(await readFile(join(root, 'output', 't2.json'), 'utf8'))
    expect(draft.functions[0].funcDesc).toBe('短')
  })

  it('fails loud when the first prompt exceeds the budget', async () => {
    const { loadPacks } = await import('../src/pack-loader.ts')
    const { generateDocument } = await import('../src/doc-service.ts')
    const packs = await loadPacks(packsRoot(), { builtin: [] })
    const pack = packs.get('cosmic-plan')!
    const root = await mkdtemp(join(tmpdir(), 'docwright-gen-'))
    const llm = { async complete() { return JSON.stringify(pack.goldenSample) } }
    await expect(generateDocument({
      pack, language: 'zh-CN', materials: ['#!inline\n素材'], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, artifactName: 't3',
      materialsRoots: [root], workspaceRoot: root, outputRoot: join(root, 'output'),
      config: { maxIterations: 3, promptTokenBudget: 5, model: 'test' }, llm, onRound: () => {},
    })).rejects.toThrow(/token budget/)
  })
})

function artifactHashMatches(service: { validate(a: unknown): unknown }, artifact: unknown, expected: string): boolean {
  void service
  return artifactHashOf(artifact) === expected
}
