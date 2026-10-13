import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPacks } from '../src/pack-loader.ts'
import { defineDocGenerateTool, defineDocValidateTool } from '../src/tools.ts'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))
const signal = new AbortController().signal
const BUDGET = { value: 70, downFactor: 0.9, upFactor: 1.2 }

async function makeDeps() {
  const packs = await loadPacks(packsRoot, {})
  const plan = packs.get('cosmic-plan')!
  return {
    packs,
    plan,
    config: { provider: 'p', model: 'm', workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-seal-')), maxIterations: 2, promptTokenBudget: 60_000 },
    ctx: {
      llm: {
        stream: async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: JSON.stringify(plan.goldenSample) }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(plan.goldenSample) } }
          yield { type: 'finish', reason: 'stop' }
        },
      },
    },
  }
}

describe('seal: doc_validate re-issues the sidecar receipt on green', () => {
  it('an externally edited artifact that revalidates green gets a fresh sidecar and rejoins the chain', async () => {
    const deps = await makeDeps()
    const gen = defineDocGenerateTool(deps as never)
    await gen.execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: BUDGET }, confirm: true, artifactName: 'a' } as never, { signal } as never)
    const root = (deps.config as { workspaceRoot: string }).workspaceRoot
    // External edit: a hand-crafted valid plan (green under the same budget).
    const edited = JSON.parse(await readFile(join(root, 'output', 'a.json'), 'utf8')) as { functions: Array<{ funcId: string; funcDesc: string }> }
    edited.functions[0]!.funcDesc = edited.functions[0]!.funcDesc + '（人工复核后补充审计说明，保持长度达标与内容一致。）'
    await writeFile(join(root, 'output', 'a.json'), JSON.stringify(edited, null, 2), 'utf8')
    void edited

    const tool = defineDocValidateTool(deps as never)
    const first = await tool.execute({ artifactPath: 'output/a.json', pack: 'cosmic-plan', language: 'zh-CN', params: { cfpTotal: BUDGET } } as never, { signal } as never) as { sealed?: boolean; hashMatches: boolean | null; receipt: { isValid: boolean; artifactHash: string } }
    expect(first.receipt.isValid).toBe(true)
    expect(first.sealed).toBe(true)
    // hashMatches still reports the pre-seal tamper evidence…
    expect(first.hashMatches).toBe(false)
    // …and the sidecar now certifies the current content.
    const onDisk = JSON.parse(await readFile(join(root, 'output', 'a.receipt.json'), 'utf8')) as { artifactHash: string; isValid: boolean }
    expect(onDisk.isValid).toBe(true)
    expect(onDisk.artifactHash).toBe(first.receipt.artifactHash)
    const second = await tool.execute({ artifactPath: 'output/a.json', pack: 'cosmic-plan', language: 'zh-CN', params: { cfpTotal: BUDGET } } as never, { signal } as never) as { hashMatches: boolean | null; sealed?: boolean }
    expect(second.hashMatches).toBe(true)
    expect(second.sealed).toBe(true)
  })

  it('a red validation never touches the sidecar', async () => {
    const deps = await makeDeps()
    const gen = defineDocGenerateTool(deps as never)
    await gen.execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: BUDGET }, confirm: true, artifactName: 'b' } as never, { signal } as never)
    const root = (deps.config as { workspaceRoot: string }).workspaceRoot
    const before = await readFile(join(root, 'output', 'b.receipt.json'), 'utf8')
    const tampered = JSON.parse(await readFile(join(root, 'output', 'b.json'), 'utf8')) as { totalCfps: number }
    tampered.totalCfps = 999
    await writeFile(join(root, 'output', 'b.json'), JSON.stringify(tampered, null, 2), 'utf8')
    const tool = defineDocValidateTool(deps as never)
    const out = await tool.execute({ artifactPath: 'output/b.json', pack: 'cosmic-plan', language: 'zh-CN', params: { cfpTotal: BUDGET } } as never, { signal } as never) as { sealed?: boolean; receipt: { isValid: boolean } }
    expect(out.receipt.isValid).toBe(false)
    expect(out.sealed).toBeUndefined()
    expect(await readFile(join(root, 'output', 'b.receipt.json'), 'utf8')).toBe(before)
  })

  it('sealing a receiptless sample creates the sidecar', async () => {
    const deps = await makeDeps()
    const root = (deps.config as { workspaceRoot: string }).workspaceRoot
    const { copyFile } = await import('node:fs/promises')
    await copyFile(join(packsRoot, 'cosmic-plan', 'samples', 'golden.json'), join(root, 'sample.json'))
    const tool = defineDocValidateTool(deps as never)
    const out = await tool.execute({ artifactPath: 'sample.json', pack: 'cosmic-plan', language: 'zh-CN', params: { cfpTotal: BUDGET } } as never, { signal } as never) as { sealed?: boolean; hashMatches: boolean | null }
    expect(out.sealed).toBe(true)
    expect(out.hashMatches).toBeNull()
    const sidecar = JSON.parse(await readFile(join(root, 'sample.receipt.json'), 'utf8')) as { isValid: boolean }
    expect(sidecar.isValid).toBe(true)
  })
})

describe('API conveniences: optional materials and artifact summary', () => {
  it('a chained pack generates with upstream alone (no materials)', async () => {
    const deps = await makeDeps()
    const gen = defineDocGenerateTool(deps as never)
    await gen.execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: BUDGET }, confirm: true, artifactName: 'plan' } as never, { signal } as never)
    deps.ctx.llm.stream = async function* () {
      const req = deps.packs.get('cosmic-req')!
      const reply = JSON.stringify(req.goldenSample)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'finish', reason: 'stop' }
    }
    const out = await gen.execute({
      pack: 'cosmic-req', language: 'zh-CN', upstream: ['output/plan.json'], params: { targetIndex: 1 }, confirm: true, artifactName: 'req',
    } as never, { signal } as never) as { receipt: { isValid: boolean }; summary: { functions?: number; totalCfps?: number } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.summary).toEqual({})
  })

  it('a root pack with neither materials nor upstream fails loud with both options', async () => {
    const deps = await makeDeps()
    const gen = defineDocGenerateTool(deps as never)
    await expect(gen.execute({ pack: 'cosmic-plan', language: 'zh-CN', params: { cfpTotal: BUDGET }, confirm: true } as never, { signal } as never)).rejects.toThrow(/materials must not be empty: provide at least one material reference.*or pass upstream artifacts/)
  })

  it('generate and validate results carry the artifact summary', async () => {
    const deps = await makeDeps()
    const gen = defineDocGenerateTool(deps as never)
    const out = await gen.execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: BUDGET }, confirm: true, artifactName: 's' } as never, { signal } as never) as { summary: { functions?: number; totalCfps?: number; processes?: number } }
    expect(out.summary.functions).toBe(2)
    expect(out.summary.totalCfps).toBe(70)
    expect(out.summary.processes).toBeUndefined()
    const val = await defineDocValidateTool(deps as never).execute({ artifactPath: 'output/s.json', pack: 'cosmic-plan', language: 'zh-CN', params: { cfpTotal: BUDGET } } as never, { signal } as never) as { summary: { functions?: number } }
    expect(val.summary.functions).toBe(2)
  })
})
