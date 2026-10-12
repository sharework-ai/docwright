import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DocService } from '../src/doc-service.ts'
import type { Issue } from '../src/issue.ts'
import type { Pack, RuleContext } from '../src/pack.ts'
import { resolveEffectiveParams } from '../src/params.ts'
import { loadPacks } from '../src/pack-loader.ts'
import { defineDocGenerateTool, defineDocValidateTool } from '../src/tools.ts'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))
const signal = new AbortController().signal

let cache: { tech: Pack; func: Pack; req: Pack; plan: Pack } | undefined
async function packs(): Promise<{ tech: Pack; func: Pack; req: Pack; plan: Pack }> {
  if (cache === undefined) {
    const all = await loadPacks(packsRoot, {})
    cache = { tech: all.get('cosmic-tech')!, func: all.get('cosmic-func')!, req: all.get('cosmic-req')!, plan: all.get('cosmic-plan')! }
  }
  return cache
}

/** The upstream func fixture: cosmic-func's golden, which the tech golden references. */
function funcContext(func: Pack): RuleContext {
  return { upstream: [func.goldenSample] }
}

function validateOf(pack: Pack, lang: string, artifact: unknown, params?: Readonly<Record<string, unknown>>, context?: RuleContext): readonly Issue[] {
  return new DocService(pack, lang).validate(artifact, resolveEffectiveParams(pack, params), context)
}

function issueRuleIds(issues: readonly Issue[]): Set<string> {
  return new Set(issues.map(i => i.ruleId))
}

/** Deep clone helper for mutations. */
function mutate(artifact: unknown, change: (draft: Record<string, unknown>) => void): Record<string, unknown> {
  const draft = structuredClone(artifact) as Record<string, unknown>
  change(draft)
  return draft
}

type Movement = { description: string; dataMovementType: string; dataGroup: string; dataProperties: string[]; cfp: number }

/** A legal read movement that can be appended after any sequence (R may repeat and follow anything). */
function extraRead(n: number): Movement {
  return { description: `系统读取补充校对所需的数据组 ${n}`, dataMovementType: 'R', dataGroup: `补充数据组${n}`, dataProperties: ['字段甲', '字段乙'], cfp: 1 }
}

/** Scripted LLM port that replies with the given texts in order (stays on the last one). */
function scriptedLlm(replies: string[]) {
  let n = 0
  return {
    stream: async function* () {
      const reply = replies[Math.min(n, replies.length - 1)]
      n++
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'finish', reason: 'stop' }
    },
  }
}

async function makeDeps(llm: unknown) {
  const all = await loadPacks(packsRoot, {})
  return {
    packs: all,
    config: {
      provider: 'p',
      model: 'test-model',
      workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-tech-chain-')),
      maxIterations: 3,
      promptTokenBudget: 60_000,
    } as never,
    ctx: { llm },
  }
}

/** Generates the plan→req→func chain so a tech doc_generate/validate call has a green upstream on disk. */
async function generateFuncChain(deps: { ctx: { llm: unknown } }, func: Pack, req: Pack, plan: Pack): Promise<void> {
  deps.ctx.llm = scriptedLlm([JSON.stringify(plan.goldenSample)])
  await defineDocGenerateTool(deps).execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'plan' } as never, { signal } as never)
  deps.ctx.llm = scriptedLlm([JSON.stringify(req.goldenSample)])
  await defineDocGenerateTool(deps).execute({
    pack: 'cosmic-req', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'req', upstream: ['output/plan.json'],
  } as never, { signal } as never)
  deps.ctx.llm = scriptedLlm([JSON.stringify(func.goldenSample)])
  await defineDocGenerateTool(deps).execute({
    pack: 'cosmic-func', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'func', upstream: ['output/req.json'],
  } as never, { signal } as never)
}

describe('cosmic-tech pack shape', () => {
  it('declares the chain, the two budget params, and the ten function rules', async () => {
    const { tech } = await packs()
    expect(tech.manifest.consumes).toEqual(['cosmic-func'])
    expect(tech.manifest.languages).toEqual(['zh-CN', 'en-US'])
    expect(Object.keys(tech.manifest.params ?? {}).sort()).toEqual(['cfpMaxRatio', 'cfpMinRatio'])
    expect(tech.functionRules.map(r => r.id)).toEqual([
      'tech/func-alignment',
      'tech/movement-count',
      'tech/movement-split-advice',
      'tech/first-movement-entry',
      'tech/no-consecutive-ewx',
      'tech/entry-after-exit',
      'tech/movement-duplicate',
      'tech/subprocess-desc-keywords',
      'tech/data-properties-count',
      'tech/cfp-total-vs-budget',
      'tech/cfp-budget-advice',
    ])
  })

  it('prompts carry the materials, upstream, and params slots in both languages', async () => {
    const { tech } = await packs()
    for (const lang of tech.manifest.languages) {
      const prompt = tech.prompts.get(lang) ?? ''
      expect(prompt).toContain('{{materials}}')
      expect(prompt).toContain('{{upstream}}')
      expect(prompt).toContain('{{params}}')
    }
  })
})

describe('cosmic-tech golden sample', () => {
  it('passes all-green in both languages against the upstream func fixture', async () => {
    const { tech, func } = await packs()
    for (const lang of tech.manifest.languages) {
      const issues = validateOf(tech, lang, tech.goldenSample, undefined, funcContext(func))
      expect(issues, `${lang}: ${JSON.stringify(issues)}`).toEqual([])
    }
  })
})

describe('cosmic-tech mutation tests (guardrail-is-real)', () => {
  it('schema violation: missing subProcesses is caught', async () => {
    const { tech, func } = await packs()
    const draft = mutate(tech.goldenSample, d => { delete (d.processes as Array<Record<string, unknown>>)[0]!.subProcesses })
    const ids = [...issueRuleIds(validateOf(tech, 'zh-CN', draft, undefined, funcContext(func)))]
    expect(ids.some(id => id.startsWith('schema/'))).toBe(true)
  })

  it('func-id-format: a malformed funcId is caught', async () => {
    const { tech, func } = await packs()
    const draft = mutate(tech.goldenSample, d => { d.funcId = 'bad id!' })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', draft, undefined, funcContext(func)))).toContain('tech/func-id-format')
  })

  it('func-alignment: anchor mismatches, missing process coverage, and missing upstream are all caught', async () => {
    const { tech, func } = await packs()
    const wrongIndex = mutate(tech.goldenSample, d => { d.index = 2 })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', wrongIndex, undefined, funcContext(func)))).toContain('tech/func-alignment')
    const wrongId = mutate(tech.goldenSample, d => { d.funcId = 'USR-DEL' })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', wrongId, undefined, funcContext(func)))).toContain('tech/func-alignment')
    const wrongCfps = mutate(tech.goldenSample, d => { d.desiredCfps = 40 })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', wrongCfps, undefined, funcContext(func)))).toContain('tech/func-alignment')
    // A renamed tech process leaves an upstream func process uncovered.
    const renamed = mutate(tech.goldenSample, d => { (d.processes as Array<{ name: string }>)[0]!.name = '收藏条目' })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', renamed, undefined, funcContext(func)))).toContain('tech/func-alignment')
    // No upstream in the context (e.g. doc_validate without the upstream argument): loud, not silent.
    expect(issueRuleIds(validateOf(tech, 'zh-CN', tech.goldenSample))).toContain('tech/func-alignment')
    // Upstream that is not a func artifact: same loud failure.
    const notFunc: RuleContext = { upstream: [{ docType: 'tech' }] }
    expect(issueRuleIds(validateOf(tech, 'zh-CN', tech.goldenSample, undefined, notFunc))).toContain('tech/func-alignment')
  })

  it('movement-count: 1, 2, and 7 movements are all rejected', async () => {
    const { tech, func } = await packs()
    const ctx = funcContext(func)
    const single = mutate(tech.goldenSample, d => {
      const procs = d.processes as Array<{ subProcesses: Movement[] }>
      procs[0]!.subProcesses = procs[0]!.subProcesses.slice(0, 1)
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', single, undefined, ctx))).toContain('tech/movement-count')
    const pair = mutate(tech.goldenSample, d => {
      const procs = d.processes as Array<{ subProcesses: Movement[] }>
      procs[0]!.subProcesses = procs[0]!.subProcesses.slice(0, 2)
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', pair, undefined, ctx))).toContain('tech/movement-count')
    const seven = mutate(tech.goldenSample, d => {
      const procs = d.processes as Array<{ subProcesses: Movement[] }>
      procs[0]!.subProcesses = [...procs[0]!.subProcesses, extraRead(1), extraRead(2), extraRead(3)]
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', seven, undefined, ctx))).toContain('tech/movement-count')
  })

  it('movement-split-advice: 5 movements earn an info advice, not an error', async () => {
    const { tech, func } = await packs()
    const five = mutate(tech.goldenSample, d => {
      (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses = [
        ...(d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses,
        extraRead(1),
      ]
    })
    const issues = validateOf(tech, 'zh-CN', five, undefined, funcContext(func))
    const advice = issues.find(i => i.ruleId === 'tech/movement-split-advice')
    expect(advice?.severity).toBe('info')
    expect(issueRuleIds(issues)).not.toContain('tech/movement-count')
  })

  it('first-movement-entry: a process not opened by E is caught', async () => {
    const { tech, func } = await packs()
    const draft = mutate(tech.goldenSample, d => {
      (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses[0]!.dataMovementType = 'R'
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', draft, undefined, funcContext(func)))).toContain('tech/first-movement-entry')
  })

  it('no-consecutive-ewx: adjacent W W is caught', async () => {
    const { tech, func } = await packs()
    // Golden process 1 opens E,W,R,X; flipping the third movement to W yields E,W,W,X.
    const draft = mutate(tech.goldenSample, d => {
      const movements = (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses
      movements[2]!.dataMovementType = 'W'
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', draft, undefined, funcContext(func)))).toContain('tech/no-consecutive-ewx')
  })

  it('entry-after-exit: a non-first E preceded by R is caught', async () => {
    const { tech, func } = await packs()
    const draft = mutate(tech.goldenSample, d => {
      const movements = (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses
      movements[2]!.dataMovementType = 'E'
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', draft, undefined, funcContext(func)))).toContain('tech/entry-after-exit')
  })

  it('movement-duplicate: an identical repeated movement is flagged as warning', async () => {
    const { tech, func } = await packs()
    // Golden process 1 is E,W,R,X; cloning the R movement's identity onto the
    // final X yields E,W,R,R with two identical R|商品档案 movements.
    const draft = mutate(tech.goldenSample, d => {
      const movements = (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses
      movements[3]!.dataMovementType = 'R'
      movements[3]!.dataGroup = movements[2]!.dataGroup
      movements[3]!.dataProperties = [...movements[2]!.dataProperties]
    })
    const issues = validateOf(tech, 'zh-CN', draft, undefined, funcContext(func))
    expect(issueRuleIds(issues)).toContain('tech/movement-duplicate')
    expect(issues.find(i => i.ruleId === 'tech/movement-duplicate')?.severity).toBe('warning')
  })

  it('subprocess-desc-keywords: a technical word in a description is flagged as warning', async () => {
    const { tech, func } = await packs()
    const draft = mutate(tech.goldenSample, d => {
      (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses[0]!.description = '系统解析用户提交的收藏请求'
    })
    const issues = validateOf(tech, 'zh-CN', draft, undefined, funcContext(func))
    expect(issueRuleIds(issues)).toContain('tech/subprocess-desc-keywords')
    expect(issues.find(i => i.ruleId === 'tech/subprocess-desc-keywords')?.severity).toBe('warning')
  })

  it('data-properties-count: a single data property is flagged as warning', async () => {
    const { tech, func } = await packs()
    const draft = mutate(tech.goldenSample, d => {
      (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses[0]!.dataProperties = ['用户ID']
    })
    const issues = validateOf(tech, 'zh-CN', draft, undefined, funcContext(func))
    expect(issueRuleIds(issues)).toContain('tech/data-properties-count')
    expect(issues.find(i => i.ruleId === 'tech/data-properties-count')?.severity).toBe('warning')
  })

  it('cfp-total-vs-budget: totals outside the ratio band are errors and the params shift the band', async () => {
    const { tech, func } = await packs()
    const ctx = funcContext(func)
    // Golden total is 36; cfpMaxRatio 1 collapses the ceiling to 35 → error.
    expect(issueRuleIds(validateOf(tech, 'zh-CN', tech.goldenSample, { cfpMaxRatio: 1 }, ctx))).toContain('tech/cfp-total-vs-budget')
    // Below the floor: three processes of 4 movements = 12 CFPs < 31.5.
    const skinny = mutate(tech.goldenSample, d => { d.processes = (d.processes as unknown[]).slice(0, 3) })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', skinny, undefined, ctx))).toContain('tech/cfp-total-vs-budget')
    // Above the ceiling: pad movements up to 52 CFPs, staying ≤6 per process.
    const fat = mutate(tech.goldenSample, d => {
      const procs = d.processes as Array<{ subProcesses: Movement[] }>
      procs[0]!.subProcesses = [...procs[0]!.subProcesses, extraRead(1), extraRead(2)]
      procs[1]!.subProcesses = [...procs[1]!.subProcesses, extraRead(3), extraRead(4)]
      procs[2]!.subProcesses = [...procs[2]!.subProcesses, extraRead(5), extraRead(6)]
      procs[3]!.subProcesses = [...procs[3]!.subProcesses, extraRead(7), extraRead(8)]
      d.processes = [...(d.processes as unknown[]), ...Array.from({ length: 4 }, (_, i) => ({ ...procs[4], index: 10 + i, name: `补充核对${i}`, subProcesses: [extraRead(10 + i), extraRead(20 + i), extraRead(30 + i), extraRead(40 + i)] }))]
    })
    expect(issueRuleIds(validateOf(tech, 'zh-CN', fat, undefined, ctx))).toContain('tech/cfp-total-vs-budget')
  })

  it('cfp-budget-advice: totals inside the band but off the budget are warnings', async () => {
    const { tech, func } = await packs()
    const ctx = funcContext(func)
    // 45 CFPs: inside [0.9, 1.5]×35 but above the 1.2 warning threshold (42).
    const over = mutate(tech.goldenSample, d => {
      const procs = d.processes as Array<{ subProcesses: Movement[] }>
      procs[0]!.subProcesses = [...procs[0]!.subProcesses, extraRead(1), extraRead(2)]
      procs[1]!.subProcesses = [...procs[1]!.subProcesses, extraRead(3), extraRead(4)]
      procs[2]!.subProcesses = [...procs[2]!.subProcesses, extraRead(5), extraRead(6)]
      procs[3]!.subProcesses = [...procs[3]!.subProcesses, extraRead(7), extraRead(8)]
      procs[4]!.subProcesses = [...procs[4]!.subProcesses, extraRead(9)]
    })
    const issues = validateOf(tech, 'zh-CN', over, undefined, ctx)
    expect(issueRuleIds(issues)).toContain('tech/cfp-budget-advice')
    expect(issues.find(i => i.ruleId === 'tech/cfp-budget-advice')?.severity).toBe('warning')
    expect(issueRuleIds(issues)).not.toContain('tech/cfp-total-vs-budget')
    // The golden (36) sits in the clean [35, 42] band: no advice.
    expect(issueRuleIds(validateOf(tech, 'zh-CN', tech.goldenSample, undefined, ctx))).not.toContain('tech/cfp-budget-advice')
  })

  it('every ERROR issue carries a suggestion across all mutations', async () => {
    const { tech, func } = await packs()
    const ctx = funcContext(func)
    const drafts = [
      mutate(tech.goldenSample, d => { delete (d.processes as Array<Record<string, unknown>>)[0]!.subProcesses }),
      mutate(tech.goldenSample, d => { d.funcId = 'bad id!' }),
      mutate(tech.goldenSample, d => { d.funcId = 'USR-DEL' }),
      mutate(tech.goldenSample, d => { (d.processes as Array<{ name: string }>)[0]!.name = '收藏条目' }),
      mutate(tech.goldenSample, d => {
        const procs = d.processes as Array<{ subProcesses: Movement[] }>
        procs[0]!.subProcesses = procs[0]!.subProcesses.slice(0, 1)
      }),
      mutate(tech.goldenSample, d => {
        (d.processes as Array<{ subProcesses: Movement[] }>)[0]!.subProcesses[0]!.dataMovementType = 'R'
      }),
    ]
    const all = drafts.flatMap(draft => [...validateOf(tech, 'zh-CN', draft, undefined, ctx), ...validateOf(tech, 'en-US', draft, undefined, ctx)])
    const errors = all.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    for (const issue of errors) expect(issue.suggestion.length, `${issue.ruleId}: ${issue.message}`).toBeGreaterThan(0)
  })
})

describe('cosmic-tech chained generation (deterministic LLM)', () => {
  it('generates a green artifact in the full plan→req→func→tech chain and records the upstream anchor', async () => {
    const { tech, func, req, plan } = await packs()
    const deps = await makeDeps(undefined)
    await generateFuncChain(deps, func, req, plan)
    deps.ctx.llm = scriptedLlm([JSON.stringify(tech.goldenSample)])
    const out = await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-tech', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'tech', upstream: ['output/func.json'],
    } as never, { signal } as never) as { receipt: { isValid: boolean; upstreamHashes: Array<{ pack: string; artifactHash: string }>; params?: Record<string, unknown> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.upstreamHashes).toHaveLength(1)
    expect(out.receipt.upstreamHashes[0]!.pack).toBe('cosmic-func')
    // As-run params (defaults) are recorded for replay.
    expect(out.receipt.params).toMatchObject({ cfpMinRatio: 0.9, cfpMaxRatio: 1.5 })
  })

  it('repairs a cross-artifact violation in a later round (func-alignment feeds the loop)', async () => {
    const { tech, func, req, plan } = await packs()
    const deps = await makeDeps(undefined)
    await generateFuncChain(deps, func, req, plan)
    const wrong = mutate(tech.goldenSample, d => { d.desiredCfps = 40 })
    deps.ctx.llm = scriptedLlm([JSON.stringify(wrong), JSON.stringify(tech.goldenSample)])
    const out = await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-tech', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'tech', upstream: ['output/func.json'],
    } as never, { signal } as never) as { receipt: { isValid: boolean; iterations: number; rounds: Array<{ errorCount: number }> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.iterations).toBe(2)
    expect(out.receipt.rounds[0]!.errorCount).toBeGreaterThan(0)
    expect(out.receipt.rounds[1]!.errorCount).toBe(0)
  })

  it('doc_validate replays with upstream; without upstream the chained rule fails loud', async () => {
    const { tech, func, req, plan } = await packs()
    const deps = await makeDeps(undefined)
    await generateFuncChain(deps, func, req, plan)
    deps.ctx.llm = scriptedLlm([JSON.stringify(tech.goldenSample)])
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-tech', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'tech', upstream: ['output/func.json'],
    } as never, { signal } as never)

    const withUpstream = await defineDocValidateTool(deps).execute({
      artifactPath: 'output/tech.json', pack: 'cosmic-tech', upstream: ['output/func.json'],
    } as never, { signal } as never) as { receipt: { isValid: boolean }; hashMatches: boolean }
    expect(withUpstream.receipt.isValid).toBe(true)
    expect(withUpstream.hashMatches).toBe(true)

    const without = await defineDocValidateTool(deps).execute({
      artifactPath: 'output/tech.json', pack: 'cosmic-tech',
    } as never, { signal } as never) as { receipt: { isValid: boolean; rules: Array<{ id: string; status: string }> } }
    expect(without.receipt.isValid).toBe(false)
    expect(without.receipt.rules.find(r => r.ruleId === 'tech/func-alignment')?.status).toBe('fail')
  })
})
