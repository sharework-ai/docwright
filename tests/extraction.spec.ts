import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import { extractableParams, extractionFilePath, readExtractionFile, verifyExtraction, writeExtractionFile } from '../src/extract.ts'
import type { MaterialEntry } from '../src/materials.ts'
import { loadPacks } from '../src/pack-loader.ts'
import type { Pack } from '../src/pack.ts'
import { previewParams, resolveEffectiveParams, type ExtractionView } from '../src/params.ts'
import type { Receipt } from '../src/receipt.ts'
import { defineDocExtractTool, defineDocGenerateTool } from '../src/tools.ts'

const B70 = { value: 70, downFactor: 0.9, upFactor: 1.2 }
const B40 = { value: 40, downFactor: 0.9, upFactor: 1.2 }
const signal = new AbortController().signal

const MATERIAL = '# Requirement brief\n\nScope: favorites management.\nThe expected CFPs is 70 in total.\nNote: some teams budget 40 per feature.\nStyle: compact prose.\n'

/** Pack with two extractable params (required+optional) and one plain param. Packs land in `root`, the workspace materials in `ws`. */
async function exPackFixture(root: string, ws: string): Promise<void> {
  const dir = join(root, 'ex-pack')
  for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(dir, sub), { recursive: true })
  // Workspace-level materials root (topic-less topic pack → <ws>/references).
  await mkdir(join(ws, 'references'), { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    name: 'ex-pack', version: '1', description: 'd', consumes: [], languages: ['zh-CN'], reuse: true,
    params: {
      budget: { type: 'object', required: true, confirm: true, extractable: true, description: 'the budget' },
      style: { type: 'string', default: 'plain', confirm: true, extractable: true, description: 'prose style' },
      limit: { type: 'number', default: 3, min: 1, max: 20, description: 'plain bound' },
    },
  }), 'utf8')
  await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(dir, 'rules', 'zh-CN.json'), '[]', 'utf8')
  await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'T {{materials}}{{params}}', 'utf8')
  await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(dir, 'samples', 'golden.json'), '{"title":"abcdef"}', 'utf8')
  await writeFile(join(ws, 'references', 'req.md'), MATERIAL, 'utf8')
  const plain = join(root, 'plain-pack')
  for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(plain, sub), { recursive: true })
  await writeFile(join(plain, 'manifest.json'), JSON.stringify({ name: 'plain-pack', version: '1', description: 'd', consumes: [], languages: ['zh-CN'] }), 'utf8')
  await writeFile(join(plain, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(plain, 'rules', 'zh-CN.json'), '[]', 'utf8')
  await writeFile(join(plain, 'prompts', 'zh-CN.md'), 'T {{materials}}', 'utf8')
  await writeFile(join(plain, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(plain, 'samples', 'golden.json'), '{}', 'utf8')
}

interface ExDeps {
  packs: Map<string, Pack>
  root: string
  config: Record<string, unknown>
  ctx: { llm: unknown }
}

async function exDeps(): Promise<ExDeps & { ws: string }> {
  const root = await mkdtemp(join(tmpdir(), 'docwright-extract-packs-'))
  const ws = await mkdtemp(join(tmpdir(), 'docwright-extract-ws-'))
  await exPackFixture(root, ws)
  const packs = await loadPacks(root, {})
  const ctx = {
    llm: {
      stream: async function* (options: { messages: Array<{ content: Array<{ text: string }> }> }) {
        void options
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '{"title":"abcdef"}' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"title":"abcdef"}' } }
        yield { type: 'finish', reason: 'stop' }
      },
    },
  }
  return { packs, ws, root, config: { workspaceRoot: ws, maxIterations: 2, promptTokenBudget: 60_000, provider: 'p', model: 'm' }, ctx }
}

async function extractTool(deps: ExDeps) {
  return defineDocExtractTool(deps as never)
}

function entry(text: string, ref = 'req.md'): MaterialEntry {
  return { ref, hash: `h-${text.length}`, text }
}

describe('doc_extract_params', () => {
  it('verifies quoted proposals and persists the extraction file with the materials manifest', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps)
    const out = await tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70, quote: 'The expected CFPs is\n70' }, style: { notFound: true, suggestion: 'compact', rationale: 'stated under Style' } } } as never, { signal } as never) as { results: Array<{ name: string; status: string; ref?: string; suggestion?: unknown }>; extractionPath: string; extractable: string[] }
    expect(out.extractable).toEqual(['budget', 'style'])
    const budget = out.results.find(r => r.name === 'budget')!
    expect(budget.status).toBe('extracted')
    expect(budget.ref).toBe('req.md')
    const style = out.results.find(r => r.name === 'style')!
    expect(style.status).toBe('notFound')
    expect(style.suggestion).toBe('compact')
    const file = await readExtractionFile(out.extractionPath)
    expect(file?.pack).toBe('ex-pack')
    expect(file?.packVersion).toBe('1')
    expect(file?.materials).toEqual([{ ref: 'req.md', hash: expect.any(String) }])
    expect(file?.extractions.budget).toMatchObject({ status: 'extracted', value: B70 })
    expect(file?.extractions.style).toMatchObject({ status: 'notFound', suggestion: 'compact', rationale: 'stated under Style' })
  })

  it('degrades an unprovable quote to notFound instead of carrying an unproven value', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps)
    const out = await tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70, quote: 'no such sentence anywhere' } } } as never, { signal } as never) as { results: Array<{ name: string; status: string; reason?: string }> }
    expect(out.results[0]).toMatchObject({ name: 'budget', status: 'notFound', reason: 'quote not found in any material' })
  })

  it('records unproposed extractable params as not proposed', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps)
    const out = await tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: {} } as never, { signal } as never) as { results: Array<{ name: string; status: string; reason?: string }> }
    expect(out.results.map(r => [r.name, r.status, r.reason])).toEqual([['budget', 'notFound', 'not proposed'], ['style', 'notFound', 'not proposed']])
  })

  it('fails loud on unknown names, malformed proposals, violating suggestions, and a rationale without a suggestion', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps)
    await expect(tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { limit: { value: 5, quote: 'q' } } } as never, { signal } as never)).rejects.toThrow(/is not extractable/)
    await expect(tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70 } } } as never, { signal } as never)).rejects.toThrow(/must be \{ value, quote \}/)
    await expect(tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { notFound: true, suggestion: 5 } } } as never, { signal } as never)).rejects.toThrow(/must be an object/)
    await expect(tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { notFound: true, rationale: 'why' } } } as never, { signal } as never)).rejects.toThrow(/rationale requires a suggestion/)
    await expect(tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { notFound: true, rationale: 3 } } } as never, { signal } as never)).rejects.toThrow(/rationale must be a string/)
    // A non-object extractions bag is rejected by the tool schema (runner), not the body.
    await expect(tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: 'all of it' } as never, { signal } as never)).rejects.toThrow(/"extractions"/)
  })

  it('records a bare notFound without a suggestion', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps)
    const out = await tool.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { notFound: true } } } as never, { signal } as never) as { results: Array<{ name: string; status: string; reason?: string; suggestion?: unknown }> }
    expect(out.results[0]).toMatchObject({ name: 'budget', status: 'notFound', reason: 'not found in materials' })
    expect(out.results[0].suggestion).toBeUndefined()
  })

  it('refuses packs without extractable params and empty materials', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps)
    await expect(tool.execute({ pack: 'plain-pack', materials: ['req.md'], extractions: {} } as never, { signal } as never)).rejects.toThrow(/declares no extractable params/)
    await expect(tool.execute({ pack: 'ex-pack', materials: [], extractions: {} } as never, { signal } as never)).rejects.toThrow(/materials must not be empty/)
  })
})

describe('verifyExtraction', () => {
  it('keeps values whose quotes still match the current materials; drops the rest and surfaces suggestions', async () => {
    const deps = await exDeps()
    const pack = deps.packs.get('ex-pack')!
    const entries = [entry(MATERIAL)]
    const file = {
      pack: 'ex-pack', packVersion: '1', materials: [],
      extractions: {
        budget: { status: 'extracted', value: B70, quote: 'The expected CFPs is 70' } as const,
        style: { status: 'notFound', suggestion: 'compact' } as const,
        limit: { status: 'extracted', value: 5, quote: 'x' } as const,
      },
    }
    const kept = verifyExtraction(pack, file, entries)
    expect(kept.values.budget).toMatchObject({ value: B70, ref: 'req.md' })
    expect(kept.notFound.style).toMatchObject({ suggestion: 'compact' })
    expect(kept.values.limit).toBeUndefined()
    const drifted = verifyExtraction(pack, file, [entry('totally different text now')])
    expect(drifted.values.budget).toBeUndefined()
  })

  it('drops values that violate the installed spec (pack upgrades tighten constraints)', async () => {
    const deps = await exDeps()
    const pack = deps.packs.get('ex-pack')!
    const file = { pack: 'ex-pack', packVersion: '1', materials: [], extractions: { budget: { status: 'extracted', value: 'not an object', quote: 'The expected CFPs is 70' } as never } }
    const view = verifyExtraction(pack, file, [entry(MATERIAL)])
    expect(view.values.budget).toBeUndefined()
  })
})

describe('resolution and preview with the extraction tier', () => {
  const view = (style: string): ExtractionView => ({ values: { style: { value: style, quote: 'q', ref: 'req.md' } }, notFound: {} })

  it('resolves explicit > upstream base > extracted > default', async () => {
    const deps = await exDeps()
    const pack = deps.packs.get('ex-pack')!
    expect(resolveEffectiveParams(pack, { style: 'x' }, { budget: B40 }, view('z')).style).toBe('x')
    expect(resolveEffectiveParams(pack, undefined, { style: 'y', budget: B40 }, view('z')).style).toBe('y')
    expect(resolveEffectiveParams(pack, undefined, { budget: B40 }, view('z')).style).toBe('z')
    expect(resolveEffectiveParams(pack, undefined, { budget: B40 }, undefined).style).toBe('plain')
  })

  it('preview marks extracted rows with quote and ref; the receipt base outranks extraction; suggestions surface on unset rows', async () => {
    const deps = await exDeps()
    const pack = deps.packs.get('ex-pack')!
    const extracted: ExtractionView = { values: { budget: { value: B70, quote: 'The expected CFPs is 70', ref: 'req.md' } }, notFound: {} }
    const preview = previewParams(pack, undefined, undefined, extracted)
    const budget = preview.rows.find(r => r.name === 'budget')!
    expect(budget.source).toBe('extracted')
    expect(budget.value).toEqual(B70)
    expect(budget.quote).toBe('The expected CFPs is 70')
    expect(budget.extractionRef).toBe('req.md')
    // The receipt base outranks extraction (resolution order), so no row ever
    // shows an extracted value drifting against the base.
    const inherited = previewParams(pack, undefined, { budget: B40 }, extracted)
    expect(inherited.rows.find(r => r.name === 'budget')!.source).toBe('upstream')
    expect(inherited.drift).toEqual([])
    // notFound + suggestion lands on the unset row (no default, no value).
    const withSuggestion = previewParams(pack, undefined, undefined, { values: {}, notFound: { budget: { suggestion: B40, rationale: 'guess' } } })
    const row = withSuggestion.rows.find(r => r.name === 'budget')!
    expect(row.source).toBe('unset')
    expect(row.suggestion).toEqual(B40)
    expect(row.suggestionRationale).toBe('guess')
  })
})

describe('doc_generate with an extraction file', () => {
  it('shows extracted provenance in the confirmation table; the gate result stays lossless JSON', async () => {
    const deps = await exDeps()
    const extract = await extractTool(deps)
    await extract.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70, quote: 'The expected CFPs is 70' } } } as never, { signal } as never)
    const gen = defineDocGenerateTool(deps as never)
    const out = await gen.execute({ pack: 'ex-pack', materials: ['req.md'] } as never, { signal } as never) as { pendingConfirmation: boolean; paramTable: Array<{ name: string; source: string; value?: unknown; quote?: string }> }
    expect(out.pendingConfirmation).toBe(true)
    const row = out.paramTable.find(r => r.name === 'budget')!
    expect(row.source).toBe('extracted')
    expect(row.value).toEqual(B70)
    expect(row.quote).toBe('The expected CFPs is 70')
    expect(() => snapshotJsonValue(out)).not.toThrow()
  })

  it('a re-extracted different value skips reuse and re-gates; an identical re-extraction still reuses', async () => {
    const deps = await exDeps()
    const extract = await extractTool(deps)
    const gen = defineDocGenerateTool(deps as never)
    await extract.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70, quote: 'The expected CFPs is 70' } } } as never, { signal } as never)
    const first = await gen.execute({ pack: 'ex-pack', materials: ['req.md'], confirm: true } as never, { signal } as never) as { reused?: boolean; receipt: Receipt }
    expect(first.reused).toBeUndefined()
    expect(first.receipt.params?.budget).toEqual(B70)
    // Identical re-extraction: the receipt's as-run params still match → reuse.
    await extract.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70, quote: 'The expected CFPs is 70' } } } as never, { signal } as never)
    const reused = await gen.execute({ pack: 'ex-pack', materials: ['req.md'] } as never, { signal } as never) as { reused?: boolean }
    expect(reused.reused).toBe(true)
    // Re-extraction with a different value: reuse must miss, the gate stands.
    await extract.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B40, quote: 'some teams budget 40 per feature' } } } as never, { signal } as never)
    const regated = await gen.execute({ pack: 'ex-pack', materials: ['req.md'] } as never, { signal } as never) as { reused?: boolean; pendingConfirmation?: boolean; paramTable: Array<{ name: string; source: string; value?: unknown }> }
    expect(regated.reused).toBeUndefined()
    expect(regated.pendingConfirmation).toBe(true)
    expect(regated.paramTable.find(r => r.name === 'budget')?.value).toEqual(B40)
    // Unattended lane executes with the new value and records it as-run.
    const none = await gen.execute({ pack: 'ex-pack', materials: ['req.md'], confirmPolicy: 'none' } as never, { signal } as never) as { receipt: Receipt }
    expect(none.receipt.params?.budget).toEqual(B40)
  })

  it('a missing required extractable param fails loud naming the extraction outcome and the suggestion', async () => {
    const deps = await exDeps()
    const extract = await extractTool(deps)
    await extract.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { notFound: true, suggestion: B40, rationale: 'not stated anywhere' } } } as never, { signal } as never)
    const gen = defineDocGenerateTool(deps as never)
    await expect(gen.execute({ pack: 'ex-pack', materials: ['req.md'], confirmPolicy: 'none' } as never, { signal } as never))
      .rejects.toThrow(/extraction found no quotable value in the materials; suggested .*not stated anywhere.*pass it via params to endorse/)
  })

  it('extraction values are dropped when the materials changed since extraction (quote no longer verbatim)', async () => {
    const deps = await exDeps()
    const extract = await extractTool(deps)
    await extract.execute({ pack: 'ex-pack', materials: ['req.md'], extractions: { budget: { value: B70, quote: 'The expected CFPs is 70' } } } as never, { signal } as never)
    await writeFile(join(deps.ws, 'references', 'req.md'), '# Rewritten brief\n\nNo budget sentence anymore.\n', 'utf8')
    const gen = defineDocGenerateTool(deps as never)
    const out = await gen.execute({ pack: 'ex-pack', materials: ['req.md'] } as never, { signal } as never) as { pendingConfirmation: boolean; paramTable: Array<{ name: string; source: string; value?: unknown }> }
    const row = out.paramTable.find(r => r.name === 'budget')!
    expect(row.source).toBe('unset')
    expect(row.value).toBeUndefined()
  })
})

describe('extraction file plumbing', () => {
  it('treats a missing or corrupt file as no extraction tier', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docwright-exfile-'))
    expect(await readExtractionFile(join(dir, 'absent.json'))).toBeUndefined()
    await writeFile(join(dir, 'bad.json'), '{not json', 'utf8')
    expect(await readExtractionFile(join(dir, 'bad.json'))).toBeUndefined()
    await writeFile(join(dir, 'shape.json'), '{"extractions": 3}', 'utf8')
    expect(await readExtractionFile(join(dir, 'shape.json'))).toBeUndefined()
  })

  it('writes and re-reads round-trip via the path convention', async () => {
    const deps = await exDeps()
    const pack = deps.packs.get('ex-pack')!
    expect(extractableParams(pack)).toEqual(['budget', 'style'])
    const path = extractionFilePath(deps.ws, 'ex-pack')
    await writeExtractionFile(path, { pack: 'ex-pack', packVersion: '1', materials: [], extractions: { budget: { status: 'notFound' } } })
    const file = await readExtractionFile(path)
    expect(file?.extractions.budget).toEqual({ status: 'notFound' })
    await rm(path)
  })

  it('renders results as text blocks', async () => {
    const deps = await exDeps()
    const tool = await extractTool(deps) as unknown as { output: { render(a: unknown, v: unknown): Array<{ type: string; text: string }> } }
    const rendered = tool.output.render({}, { pack: 'ex-pack', results: [] })
    expect(rendered).toEqual([{ type: 'text', text: JSON.stringify({ pack: 'ex-pack', results: [] }) }])
  })

  it('cosmic-plan marks cfpTotal extractable (the motivating scenario)', async () => {
    const packs = await loadPacks(new URL('../packs', import.meta.url).pathname, {})
    const spec = packs.get('cosmic-plan')!.manifest.params!.cfpTotal!
    expect(spec.extractable).toBe(true)
    expect(spec.confirm).toBe(true)
    expect(spec.required).toBe(true)
  })
})
