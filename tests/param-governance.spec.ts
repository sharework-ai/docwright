import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import { loadPacks } from '../src/pack-loader.ts'
import type { Pack } from '../src/pack.ts'
import { previewParams, resolveEffectiveParams } from '../src/params.ts'
import { assembleGeneratorPrompt } from '../src/prompt.ts'
import { defineDocGenerateTool } from '../src/tools.ts'
import { generateDocument } from '../src/doc-service.ts'
import { getDocService } from '../src/doc-service.ts'
import type { LlmPort } from '../src/llm-port.ts'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))
const signal = new AbortController().signal

const BUDGET = { value: 70, downFactor: 0.9, upFactor: 1.2 }

async function packOf(name: string): Promise<Pack> {
  const packs = await loadPacks(packsRoot, {})
  const pack = packs.get(name)
  if (pack === undefined) throw new Error(`${name} not loaded`)
  return pack
}

/** A minimal manifest-only spec for loader rejection tests. */
async function loadFailing(spec: Record<string, unknown>): Promise<Error> {
  const root = await mkdtemp(join(tmpdir(), 'docwright-gov-load-'))
  const dir = join(root, 'gp')
  await mkdir(join(dir, 'rules'), { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'gp', version: '1', description: 'd', languages: ['zh-CN'], params: { p: spec } }), 'utf8')
  try {
    await loadPacks(root, {})
  } catch (error) {
    return error as Error
  }
  throw new Error('expected loadPacks to fail')
}

/** Pack with the gate shape: a required+confirm object budget and a defaulted param. */
async function gatePackFixture(root: string): Promise<void> {
  const dir = join(root, 'gate-pack')
  for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(dir, sub), { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    name: 'gate-pack', version: '1', description: 'd', consumes: [], languages: ['zh-CN'],
    params: {
      budget: { type: 'object', required: true, confirm: true, description: 'the budget' },
      limit: { type: 'number', default: 3, min: 1, max: 20, description: 'max length' },
    },
  }), 'utf8')
  await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(dir, 'rules', 'zh-CN.json'), JSON.stringify([{ id: 'g/max', severity: 'error', given: '$', field: 'title', kind: 'maxLength', max: { param: 'limit' }, suggestion: 's' }]), 'utf8')
  await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'T {{materials}}{{params}}', 'utf8')
  await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(dir, 'samples', 'golden.json'), '{"title":"abcdef"}', 'utf8')
}

interface GateDeps {
  packs: Map<string, Pack>
  ws: string
  prompts: string[]
  config: Record<string, unknown>
  ctx: { llm: unknown }
}

async function gateDeps(configOver: Record<string, unknown> = {}, reply = '{"title":"abcdef"}'): Promise<GateDeps> {
  const ws = await mkdtemp(join(tmpdir(), 'docwright-gate-'))
  await gatePackFixture(ws)
  const packs = await loadPacks(ws, {})
  const prompts: string[] = []
  const ctx = {
    llm: {
      stream: async function* (options: { messages: Array<{ content: Array<{ text: string }> }> }) {
        prompts.push(options.messages[0]!.content.map(c => c.text).join(''))
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: 'stop' }
      },
    },
  }
  return { packs, ws, prompts, config: { workspaceRoot: ws, maxIterations: 2, promptTokenBudget: 60_000, provider: 'p', model: 'm', ...configOver }, ctx }
}

/** Producer/consumer pair for inheritance and drift tests. */
async function chainFixture(root: string, consumerPolicy?: string): Promise<void> {
  const producer = join(root, 'prod-pack')
  for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(producer, sub), { recursive: true })
  await writeFile(join(producer, 'manifest.json'), JSON.stringify({
    name: 'prod-pack', version: '1', description: 'd', consumes: [], languages: ['zh-CN'],
    params: {
      budget: { type: 'object', required: true, confirm: true, description: 'the shared budget' },
      minTitle: { type: 'number', default: 3, min: 1, max: 20, description: 'min title length' },
    },
  }), 'utf8')
  await writeFile(join(producer, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(producer, 'rules', 'zh-CN.json'), JSON.stringify([{ id: 'p/min', severity: 'error', given: '$', field: 'title', kind: 'minLength', min: { param: 'minTitle' }, suggestion: 's' }]), 'utf8')
  await writeFile(join(producer, 'prompts', 'zh-CN.md'), 'T {{materials}}{{params}}', 'utf8')
  await writeFile(join(producer, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(producer, 'samples', 'golden.json'), '{}', 'utf8')
  const consumer = join(root, 'cons-pack')
  for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(consumer, sub), { recursive: true })
  await writeFile(join(consumer, 'manifest.json'), JSON.stringify({
    name: 'cons-pack', version: '1', description: 'd', consumes: ['prod-pack'], languages: ['zh-CN'],
    ...(consumerPolicy === undefined ? {} : { paramDriftPolicy: consumerPolicy }),
    params: {
      budget: { type: 'object', confirm: true, description: 'the shared budget' },
      minTitle: { type: 'number', description: 'inherited drift target' },
    },
  }), 'utf8')
  await writeFile(join(consumer, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(consumer, 'rules', 'zh-CN.json'), '[]', 'utf8')
  await writeFile(join(consumer, 'prompts', 'zh-CN.md'), 'C {{materials}}{{params}}', 'utf8')
  await writeFile(join(consumer, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(consumer, 'samples', 'golden.json'), '{}', 'utf8')
}

async function chainDeps(consumerPolicy?: string, reply = '{}'): Promise<GateDeps & { root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'docwright-chain-gov-'))
  await chainFixture(root, consumerPolicy)
  const packs = await loadPacks(root, {})
  const prompts: string[] = []
  const ctx = {
    llm: {
      stream: async function* (options: { messages: Array<{ content: Array<{ text: string }> }> }) {
        prompts.push(options.messages[0]!.content.map(c => c.text).join(''))
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: 'stop' }
      },
    },
  }
  return { packs, ws: root, root, prompts, config: { workspaceRoot: root, maxIterations: 2, promptTokenBudget: 60_000, provider: 'p', model: 'm' }, ctx }
}

describe('pack loader: param attributes', () => {
  it('rejects a required param that declares a default', async () => {
    const error = await loadFailing({ type: 'number', required: true, default: 5, description: 'd' })
    expect(error.message).toMatch(/manifest\.params\.p\.default is forbidden on a required param/)
  })

  it('rejects non-boolean required/overridable/confirm flags', async () => {
    expect((await loadFailing({ type: 'number', default: 1, required: 'yes', description: 'd' })).message).toMatch(/\.required must be a boolean/)
    expect((await loadFailing({ type: 'number', default: 1, overridable: 1, description: 'd' })).message).toMatch(/\.overridable must be a boolean/)
    expect((await loadFailing({ type: 'number', default: 1, confirm: 'sure', description: 'd' })).message).toMatch(/\.confirm must be a boolean/)
  })

  it('rejects object params with non-object defaults, enum, or numeric bounds', async () => {
    expect((await loadFailing({ type: 'object', default: [1], description: 'd' })).message).toMatch(/\.default must match type "object"/)
    expect((await loadFailing({ type: 'object', default: 'x', description: 'd' })).message).toMatch(/\.default must match type "object"/)
    expect((await loadFailing({ type: 'object', default: { a: 1 }, enum: [], description: 'd' })).message).toMatch(/\.enum is not supported for object params/)
    expect((await loadFailing({ type: 'object', default: { a: 1 }, min: 1, description: 'd' })).message).toMatch(/\.min\/max are only valid for number-typed params/)
  })

  it('accepts a plain-object default and an optional object param without default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-gov-obj-'))
    const dir = join(root, 'op')
    for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(dir, sub), { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      name: 'op', version: '1', description: 'd', languages: ['zh-CN'],
      params: {
        band: { type: 'object', default: { min: 1, max: 9 }, description: 'd' },
        shared: { type: 'object', description: 'inherited only' },
      },
    }), 'utf8')
    await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
    await writeFile(join(dir, 'rules', 'zh-CN.json'), '[]', 'utf8')
    await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'T {{materials}}', 'utf8')
    await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
    await writeFile(join(dir, 'samples', 'golden.json'), '{}', 'utf8')
    const packs = await loadPacks(root, {})
    const pack = packs.get('op')!
    expect(resolveEffectiveParams(pack, undefined)).toEqual({ band: { min: 1, max: 9 } })
  })

  it('rejects an invalid paramDriftPolicy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-gov-policy-'))
    const dir = join(root, 'pp')
    await mkdir(join(dir, 'rules'), { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'pp', version: '1', description: 'd', languages: ['zh-CN'], paramDriftPolicy: 'ignore' }), 'utf8')
    await expect(loadPacks(root, {})).rejects.toThrow(/manifest\.paramDriftPolicy must be "regenerate" or "revalidate"/)
  })

  it('rejects a declarative bound that references a default-less optional param', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-gov-ref-'))
    const dir = join(root, 'rp')
    for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(dir, sub), { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      name: 'rp', version: '1', description: 'd', languages: ['zh-CN'],
      params: { maybe: { type: 'number', description: 'inherited only' } },
    }), 'utf8')
    await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
    await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'T {{materials}}', 'utf8')
    await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
    await writeFile(join(dir, 'samples', 'golden.json'), '{}', 'utf8')
    await writeFile(join(dir, 'rules', 'zh-CN.json'), JSON.stringify([{ id: 'r', severity: 'error', given: '$', field: 'title', kind: 'maxLength', max: { param: 'maybe' }, suggestion: 's' }]), 'utf8')
    await expect(loadPacks(root, {})).rejects.toThrow(/param "maybe" which has no default; bound references require a param that is always present/)
  })
})

describe('resolveEffectiveParams: object, required, and optional-without-default', () => {
  it('accepts object overrides and rejects non-object values', async () => {
    const pack = await packOf('cosmic-plan')
    const budget = { value: 70, downFactor: 0.9, upFactor: 1.2 }
    expect(resolveEffectiveParams(pack, { cfpTotal: budget }).cfpTotal).toEqual(budget)
    expect(() => resolveEffectiveParams(pack, { cfpTotal: [1] })).toThrow(/param "cfpTotal" must be an object \(got an array/)
    expect(() => resolveEffectiveParams(pack, { cfpTotal: 5 })).toThrow(/param "cfpTotal" must be an object \(got 5/)
  })

  it('fails loud when a required param is missing from call and base', async () => {
    const pack = await packOf('cosmic-plan')
    expect(() => resolveEffectiveParams(pack, undefined)).toThrow(/missing required pack param "cfpTotal" for pack "cosmic-plan"/)
    expect(() => resolveEffectiveParams(pack, undefined, { cfpTotal: { value: 1, downFactor: 1, upFactor: 1 } })).not.toThrow()
  })

  it('explicit overrides win over the inherited base', async () => {
    const pack = await packOf('cosmic-plan')
    const out = resolveEffectiveParams(pack, { cfpTotal: { value: 100, downFactor: 0.9, upFactor: 1.2 } }, { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } })
    expect((out.cfpTotal as { value: number }).value).toBe(100)
  })
})

describe('previewParams: table, missing, and drift', () => {
  it('labels the source of every value and lists missing required params', async () => {
    const pack = await packOf('cosmic-plan')
    const preview = previewParams(pack, undefined, undefined)
    expect(preview.rows.find(r => r.name === 'cfpPerFunc')!.source).toBe('default')
    expect(preview.rows.find(r => r.name === 'cfpTotal')!.source).toBe('unset')
    expect(preview.rows.find(r => r.name === 'cfpPerSubProc')!.source).toBe('default')
    expect(preview.missingRequired).toEqual(['cfpTotal'])
    expect(preview.drift).toEqual([])
    const row = preview.rows.find(r => r.name === 'cfpTotal')!
    expect(row.required).toBe(true)
    expect(row.confirm).toBe(true)
  })

  it('omits value on unset rows so the row stays lossless JSON', async () => {
    const pack = await packOf('cosmic-plan')
    const preview = previewParams(pack, undefined, undefined)
    const unset = preview.rows.find(r => r.source === 'unset')!
    expect(unset.name).toBe('cfpTotal')
    expect('value' in unset).toBe(false)
    for (const row of preview.rows) expect(snapshotJsonValue(row)).not.toBeUndefined()
  })

  it('detects drift only against recorded base values (canonical compare)', async () => {
    const pack = await packOf('cosmic-plan')
    const base = { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 }, cfpPerSubProc: 2.5 }
    const same = previewParams(pack, { cfpTotal: { upFactor: 1.2, value: 70, downFactor: 0.9 } }, base)
    expect(same.drift).toEqual([])
    const changed = previewParams(pack, { cfpTotal: { value: 100, downFactor: 0.9, upFactor: 1.2 }, cfpPerSubProc: 3 }, base)
    expect(changed.drift).toEqual([
      { name: 'cfpTotal', from: base.cfpTotal, to: { value: 100, downFactor: 0.9, upFactor: 1.2 } },
      { name: 'cfpPerSubProc', from: 2.5, to: 3 },
    ])
    // No base entry → nothing to drift against.
    const noBase = previewParams(pack, { cfpTotal: { value: 1, downFactor: 1, upFactor: 1 } }, undefined)
    expect(noBase.drift).toEqual([])
  })
})

describe('prompt: overridable-param hint', () => {
  it('renders the materials-may-adjust line for present overridable params only', () => {
    const out = assembleGeneratorPrompt({
      promptTemplate: 'T{{params}}',
      materials: ['m'],
      params: { style: 'formal', limit: 5 },
      overridableParams: ['style', 'absent'],
    })
    expect(out).toContain('Materials content may adjust these params when the materials clearly justify different values: style.')
    expect(out).not.toContain('absent')
    const hard = assembleGeneratorPrompt({ promptTemplate: 'T{{params}}', materials: ['m'], params: { limit: 5 }, overridableParams: [] })
    expect(hard).not.toContain('Materials content may adjust')
    const noParams = assembleGeneratorPrompt({ promptTemplate: 'T{{params}}', materials: ['m'], overridableParams: ['style'] })
    expect(noParams).toBe('T')
  })
})

describe('doc_generate: confirmation gate', () => {
  it('gates on confirm-flagged params with missing required entries; no route needed, no LLM spent', async () => {
    const deps = await gateDeps({ provider: undefined, model: undefined })
    const tool = defineDocGenerateTool(deps as never)
    const out = await tool.execute({ pack: 'gate-pack', materials: ['#!inline\nm'] } as never, { signal } as never) as { pendingConfirmation: boolean; missingRequired: string[]; hint: string; paramTable: Array<{ name: string; source: string; value: unknown }> }
    expect(out.pendingConfirmation).toBe(true)
    expect(out.missingRequired).toEqual(['budget'])
    expect(out.hint).toContain('confirm: true')
    expect(deps.prompts).toEqual([])
    const budget = out.paramTable.find(r => r.name === 'budget')!
    expect(budget.source).toBe('unset')
    expect(budget.required).toBe(true)
    const limit = out.paramTable.find(r => r.name === 'limit')!
    expect(limit.source).toBe('default')
  })

  it('gate result survives the dsh lossless-JSON output snapshot the runner applies', async () => {
    // The real runtime snapshots every tool result before model delivery
    // (createSuccessResult → snapshotJsonValue); one explicit `undefined`
    // property anywhere poisons the whole result into INVALID_TOOL_OUTPUT.
    const deps = await gateDeps({ provider: undefined, model: undefined })
    const tool = defineDocGenerateTool(deps as never)
    const out = await tool.execute({ pack: 'gate-pack', materials: ['#!inline\nm'] } as never, { signal } as never)
    expect(snapshotJsonValue(out)).not.toBeUndefined()
  })

  it('rejects params passed as a JSON-encoded string at the schema layer', async () => {
    const deps = await gateDeps({ provider: undefined, model: undefined })
    const tool = defineDocGenerateTool(deps as never)
    await expect(tool.execute({ pack: 'gate-pack', materials: ['#!inline\nm'], params: '{"budget": {"v": 1}}' } as never, { signal } as never))
      .rejects.toThrow(/invalid arguments[\s\S]*params/)
  })

  it('gates on explicit params until confirmed, then executes and records as-run params', async () => {
    const deps = await gateDeps()
    const tool = defineDocGenerateTool(deps as never)
    const gated = await tool.execute({ pack: 'gate-pack', materials: ['#!inline\nm'], params: { budget: { v: 1 }, limit: 10 } } as never, { signal } as never) as { pendingConfirmation: boolean; paramTable: Array<{ name: string; source: string }> }
    expect(gated.pendingConfirmation).toBe(true)
    expect(gated.paramTable.find(r => r.name === 'budget')!.source).toBe('explicit')
    expect(deps.prompts).toEqual([])

    const out = await tool.execute({ pack: 'gate-pack', materials: ['#!inline\nm'], artifactName: 'g', params: { budget: { v: 1 }, limit: 10 }, confirm: true } as never, { signal } as never) as { receipt: { isValid: boolean; params?: Record<string, unknown> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.params).toEqual({ budget: { v: 1 }, limit: 10 })
  })

  it('throws for missing required params once the gate is confirmed', async () => {
    const deps = await gateDeps()
    const tool = defineDocGenerateTool(deps as never)
    await expect(tool.execute({ pack: 'gate-pack', materials: ['#!inline\nm'], confirm: true } as never, { signal } as never)).rejects.toThrow(/missing required pack params for "gate-pack": budget/)
  })
})

describe('doc_generate: chain inheritance and param drift', () => {
  it('inherits confirm params from the upstream receipt: no re-confirmation downstream', async () => {
    const deps = await chainDeps()
    const packs = deps.packs
    await generateDocument({
      pack: packs.get('prod-pack')!, language: 'zh-CN', materials: ['#!inline\nm'], artifactName: 'up',
      materialsRoot: join(deps.root, 'references'), workspaceRoot: deps.root, outputRoot: join(deps.root, 'output'),
      config: { provider: 'p', model: 'm' } as never, llm: { async complete() { return '{"title":"abcdef"}' } }, onRound: () => {},
      params: { budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    } as never)
    const tool = defineDocGenerateTool(deps as never)
    const out = await tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'] } as never, { signal } as never) as { pendingConfirmation?: boolean; receipt: { isValid: boolean; params?: Record<string, unknown> } }
    expect(out.pendingConfirmation).toBeUndefined()
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.params).toMatchObject({ budget: { value: 70 } })
  })

  it('gates drifted params with a regenerate impact preview, then refuses after confirm', async () => {
    const deps = await chainDeps()
    const packs = deps.packs
    await generateDocument({
      pack: packs.get('prod-pack')!, language: 'zh-CN', materials: ['#!inline\nm'], artifactName: 'up',
      materialsRoot: join(deps.root, 'references'), workspaceRoot: deps.root, outputRoot: join(deps.root, 'output'),
      config: { provider: 'p', model: 'm' } as never, llm: { async complete() { return '{"title":"abcdef"}' } }, onRound: () => {},
      params: { budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    } as never)
    const tool = defineDocGenerateTool(deps as never)
    const drifted = { budget: { value: 120, downFactor: 0.9, upFactor: 1.2 } }
    const gated = await tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'], params: drifted } as never, { signal } as never) as { pendingConfirmation: boolean; paramDrift: Array<{ name: string }>; driftImpact: string }
    expect(gated.pendingConfirmation).toBe(true)
    expect(gated.paramDrift.map(d => d.name)).toEqual(['budget'])
    expect(gated.driftImpact).toContain('paramDriftPolicy is "regenerate"')
    await expect(tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'], params: drifted, confirm: true } as never, { signal } as never)).rejects.toThrow(/params drift from the upstream receipts \(budget: .* → .*\); pack "cons-pack" paramDriftPolicy is "regenerate"/)
  })

  it('revalidate policy: the gate previews the deterministic re-check result', async () => {
    const deps = await chainDeps('revalidate')
    await generateDocument({
      pack: deps.packs.get('prod-pack')!, language: 'zh-CN', materials: ['#!inline\nm'], artifactName: 'up',
      materialsRoot: join(deps.root, 'references'), workspaceRoot: deps.root, outputRoot: join(deps.root, 'output'),
      config: { provider: 'p', model: 'm' } as never, llm: { async complete() { return '{"title":"abcdef"}' } }, onRound: () => {},
      params: { budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    } as never)
    const tool = defineDocGenerateTool(deps as never)
    const green = await tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'], params: { minTitle: 5 } } as never, { signal } as never) as { pendingConfirmation: boolean; driftImpact: string }
    expect(green.pendingConfirmation).toBe(true)
    expect(green.driftImpact).toContain('revalidated green under the new params')
    const red = await tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'], params: { minTitle: 10 } } as never, { signal } as never) as { driftImpact: string }
    expect(red.driftImpact).toContain('fail under the new params')
    expect(red.driftImpact).toContain('p/min')
  })

  it('revalidate policy: confirmed drift fails loud when the upstream breaks under the new params', async () => {
    const deps = await chainDeps('revalidate')
    await generateDocument({
      pack: deps.packs.get('prod-pack')!, language: 'zh-CN', materials: ['#!inline\nm'], artifactName: 'up',
      materialsRoot: join(deps.root, 'references'), workspaceRoot: deps.root, outputRoot: join(deps.root, 'output'),
      config: { provider: 'p', model: 'm' } as never, llm: { async complete() { return '{"title":"abcdef"}' } }, onRound: () => {},
      params: { budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    } as never)
    const tool = defineDocGenerateTool(deps as never)
    await expect(tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'], params: { minTitle: 10 }, confirm: true } as never, { signal } as never)).rejects.toThrow(/upstream artifacts fail validation under the new params \(prod-pack: p\/min\)/)
  })

  it('revalidate policy: a hand-written receipt with a spec-violating base fails loud (language falls back)', async () => {
    const deps = await chainDeps('revalidate')
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { artifactHashOf } = await import('../src/receipt.ts')
    await mkdir(join(deps.root, 'output'), { recursive: true })
    await writeFile(join(deps.root, 'output', 'hand.json'), '{}', 'utf8')
    await writeFile(join(deps.root, 'output', 'hand.receipt.json'), JSON.stringify({
      pack: 'prod-pack', packVersion: '1', artifactHash: artifactHashOf({}), isValid: true,
      params: { minTitle: 'not-a-number', budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    }), 'utf8')
    const tool = defineDocGenerateTool(deps as never)
    await expect(tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/hand.json'], params: { budget: { value: 100, downFactor: 0.9, upFactor: 1.2 } }, confirm: true } as never, { signal } as never)).rejects.toThrow(/upstream artifacts fail validation under the new params \(prod-pack: pack "prod-pack" param "minTitle" \(receipt-recorded\) must be a number/)
  })

  it('revalidate policy: a language-less receipt falls back to the pack first language before rule replay', async () => {
    const deps = await chainDeps('revalidate')
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { artifactHashOf } = await import('../src/receipt.ts')
    await mkdir(join(deps.root, 'output'), { recursive: true })
    await writeFile(join(deps.root, 'output', 'hand2.json'), '{}', 'utf8')
    await writeFile(join(deps.root, 'output', 'hand2.receipt.json'), JSON.stringify({
      pack: 'prod-pack', packVersion: '1', artifactHash: artifactHashOf({}), isValid: true,
      params: { minTitle: 5, budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    }), 'utf8')
    const tool = defineDocGenerateTool(deps as never)
    await expect(tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/hand2.json'], params: { budget: { value: 100, downFactor: 0.9, upFactor: 1.2 } }, confirm: true } as never, { signal } as never)).rejects.toThrow(/fail validation under the new params \(prod-pack: p\/min\)/)
  })

  it('revalidate policy: drifted params re-check the upstream artifact under its own pack rules', async () => {
    const deps = await chainDeps('revalidate')
    const packs = deps.packs
    await generateDocument({
      pack: packs.get('prod-pack')!, language: 'zh-CN', materials: ['#!inline\nm'], artifactName: 'up',
      materialsRoot: join(deps.root, 'references'), workspaceRoot: deps.root, outputRoot: join(deps.root, 'output'),
      config: { provider: 'p', model: 'm' } as never, llm: { async complete() { return '{"title":"abcdef"}' } }, onRound: () => {},
      params: { budget: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
    } as never)
    const tool = defineDocGenerateTool(deps as never)
    // The producer declares no further rules, so any budget value revalidates green.
    const out = await tool.execute({ pack: 'cons-pack', materials: ['#!inline\nm'], artifactName: 'down', upstream: ['output/up.json'], params: { budget: { value: 500 } }, confirm: true } as never, { signal } as never) as { receipt: { isValid: boolean; params?: Record<string, unknown> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.params).toMatchObject({ budget: { value: 500 } })
  })
})

describe('cosmic-plan: shared-budget band rules', () => {
  it('golden stays green inside the declared bands', async () => {
    const pack = await packOf('cosmic-plan')
    const all = await loadPacks(packsRoot, {})
    const context = { upstream: [all.get('cosmic-context')!.goldenSample] }
    const service = getDocService(pack, 'zh-CN')
    const params = resolveEffectiveParams(pack, { cfpTotal: BUDGET })
    const issues = service.validate(pack.goldenSample, params, context)
    expect(issues.filter(i => i.severity === 'error')).toEqual([])
    expect(issues.map(i => i.ruleId)).not.toContain('plan/func-cfps-recommended-range')
  })

  it('cfp-per-func-band: per-function values outside the band are errors', async () => {
    const pack = await packOf('cosmic-plan')
    const service = getDocService(pack, 'zh-CN')
    const artifact = JSON.parse(JSON.stringify(pack.goldenSample)) as { functions: Array<{ estimatedCfps: number }> }
    artifact.functions[0]!.estimatedCfps = 35
    const issues = service.validate(artifact, { cfpPerFunc: { value: 30, min: 20, max: 30 }, cfpTotal: BUDGET })
    expect(issues.map(i => i.ruleId)).toContain('plan/cfp-per-func-band')
    expect(issues.find(i => i.ruleId === 'plan/cfp-per-func-band')!.message).toContain('[20, 30]')
  })

  it('cfp-total-band: totals outside [value×down, value×up] are errors', async () => {
    const pack = await packOf('cosmic-plan')
    const service = getDocService(pack, 'zh-CN')
    const issues = service.validate(pack.goldenSample, { cfpTotal: { value: 100, downFactor: 0.9, upFactor: 1.2 } })
    expect(issues.map(i => i.ruleId)).toContain('plan/cfp-total-band')
    expect(issues.find(i => i.ruleId === 'plan/cfp-total-band')!.message).toContain('[90, 120]')
  })

  it('band rules skip when their params are absent (programmatic misuse defense)', async () => {
    const pack = await packOf('cosmic-plan')
    const service = getDocService(pack, 'zh-CN')
    const issues = service.validate(pack.goldenSample, {})
    expect(issues.map(i => i.ruleId)).not.toContain('plan/cfp-per-func-band')
    expect(issues.map(i => i.ruleId)).not.toContain('plan/cfp-total-band')
  })
})
