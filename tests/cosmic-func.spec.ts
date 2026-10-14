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

let cache: { func: Pack; req: Pack; plan: Pack } | undefined
async function packs(): Promise<{ func: Pack; req: Pack; plan: Pack }> {
  if (cache === undefined) {
    const all = await loadPacks(packsRoot, {})
    cache = { func: all.get('cosmic-func')!, req: all.get('cosmic-req')!, plan: all.get('cosmic-plan')! }
  }
  return cache
}

/** The upstream req fixture: cosmic-req's golden, which the func golden references (index 1 / USR-FAV / 35 CFP). */
function reqContext(req: Pack): RuleContext {
  return { upstream: [req.goldenSample] }
}

function validateOf(pack: Pack, lang: string, artifact: unknown, context?: RuleContext): readonly Issue[] {
  return new DocService(pack, lang).validate(artifact, resolveEffectiveParams(pack, { targetIndex: 1 }), context)
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
      workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-func-chain-')),
      maxIterations: 3,
      promptTokenBudget: 60_000,
    } as never,
    ctx: { llm },
  }
}

describe('cosmic-func pack shape', () => {
  it('declares the chain and the four function rules', async () => {
    const { func } = await packs()
    expect(func.manifest.consumes).toEqual(['cosmic-req'])
    expect(func.manifest.languages).toEqual(['zh-CN', 'en-US'])
    expect(Object.keys(func.manifest.params ?? {}).sort()).toEqual(['cfpPerFunc', 'cfpPerSubProc', 'cfpTotal', 'targetIndex'])
    expect(func.functionRules.map(r => r.id)).toEqual([
      'func/originator-receiver-distinct',
      'func/process-name-unique',
      'func/process-index-sequence',
      'func/req-alignment',
    ])
  })

  it('prompts carry the materials and upstream slots in both languages', async () => {
    const { func } = await packs()
    for (const lang of func.manifest.languages) {
      const prompt = func.prompts.get(lang) ?? ''
      expect(prompt).toContain('{{materials}}')
      expect(prompt).toContain('{{upstream}}')
    }
  })
})

describe('cosmic-func golden sample', () => {
  it('passes all-green in both languages against the upstream req fixture', async () => {
    const { func, req } = await packs()
    for (const lang of func.manifest.languages) {
      const issues = validateOf(func, lang, func.goldenSample, reqContext(req))
      expect(issues, `${lang}: ${JSON.stringify(issues)}`).toEqual([])
    }
  })
})

describe('cosmic-func mutation tests (guardrail-is-real)', () => {
  it('schema violation: missing processes is caught', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { delete d.processes })
    const ids = [...issueRuleIds(validateOf(func, 'zh-CN', draft, reqContext(req)))]
    expect(ids.some(id => id.startsWith('schema/'))).toBe(true)
  })

  it('process-name-forbidden-keywords: a design word in a process name is caught', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { (d.processes as Array<{ name: string }>)[0]!.name = '校验收藏资格' })
    const issues = validateOf(func, 'zh-CN', draft, reqContext(req))
    expect(issueRuleIds(issues)).toContain('func/process-name-forbidden-keywords')
    expect(issues.find(i => i.ruleId === 'func/process-name-forbidden-keywords')?.severity).toBe('error')
  })

  it('process-name-suffix: a generic suffix is flagged as info', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { (d.processes as Array<{ name: string }>)[0]!.name = '收藏管理' })
    const issues = validateOf(func, 'zh-CN', draft, reqContext(req))
    expect(issueRuleIds(issues)).toContain('func/process-name-suffix')
    expect(issues.find(i => i.ruleId === 'func/process-name-suffix')?.severity).toBe('info')
  })

  it('process-name-warning-keywords: a technical word in a process name is flagged as warning', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { (d.processes as Array<{ name: string }>)[0]!.name = '解析收藏数据' })
    const issues = validateOf(func, 'zh-CN', draft, reqContext(req))
    expect(issueRuleIds(issues)).toContain('func/process-name-warning-keywords')
    expect(issues.find(i => i.ruleId === 'func/process-name-warning-keywords')?.severity).toBe('warning')
  })

  it('originator-receiver-distinct: an identical originator and receiver is caught', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { (d.processes as Array<{ receiver: string }>)[0]!.receiver = '注册用户' })
    expect(issueRuleIds(validateOf(func, 'zh-CN', draft, reqContext(req)))).toContain('func/originator-receiver-distinct')
  })

  it('originator/receiver-forbidden-keywords: storage facilities cannot be functional users', async () => {
    const { func, req } = await packs()
    const originator = mutate(func.goldenSample, d => { (d.processes as Array<{ originator: string }>)[0]!.originator = '收藏数据库' })
    const originatorIssues = validateOf(func, 'zh-CN', originator, reqContext(req))
    expect(issueRuleIds(originatorIssues)).toContain('func/originator-forbidden-keywords')
    expect(originatorIssues.find(i => i.ruleId === 'func/originator-forbidden-keywords')?.severity).toBe('error')
    const receiver = mutate(func.goldenSample, d => { (d.processes as Array<{ receiver: string }>)[0]!.receiver = '文件存储服务' })
    const receiverIssues = validateOf(func, 'zh-CN', receiver, reqContext(req))
    expect(issueRuleIds(receiverIssues)).toContain('func/receiver-forbidden-keywords')
    expect(receiverIssues.find(i => i.ruleId === 'func/receiver-forbidden-keywords')?.severity).toBe('error')
  })

  it('process-name-unique: a duplicated process name is caught', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { (d.processes as Array<{ name: string }>)[1]!.name = '收藏商品' })
    expect(issueRuleIds(validateOf(func, 'zh-CN', draft, reqContext(req)))).toContain('func/process-name-unique')
  })

  it('process-index-sequence: a broken index sequence is caught', async () => {
    const { func, req } = await packs()
    const draft = mutate(func.goldenSample, d => { (d.processes as Array<{ index: number }>)[2]!.index = 9 })
    expect(issueRuleIds(validateOf(func, 'zh-CN', draft, reqContext(req)))).toContain('func/process-index-sequence')
  })

  it('req-alignment: index/funcId/desiredCfps mismatches and missing upstream are all caught', async () => {
    const { func, req } = await packs()
    const wrongIndex = mutate(func.goldenSample, d => { d.index = 2 })
    expect(issueRuleIds(validateOf(func, 'zh-CN', wrongIndex, reqContext(req)))).toContain('func/req-alignment')
    const wrongId = mutate(func.goldenSample, d => { d.funcId = 'USR-DEL' })
    expect(issueRuleIds(validateOf(func, 'zh-CN', wrongId, reqContext(req)))).toContain('func/req-alignment')
    const wrongCfps = mutate(func.goldenSample, d => { d.desiredCfps = 40 })
    expect(issueRuleIds(validateOf(func, 'zh-CN', wrongCfps, reqContext(req)))).toContain('func/req-alignment')
    // No upstream in the context (e.g. doc_validate without the upstream argument): loud, not silent.
    expect(issueRuleIds(validateOf(func, 'zh-CN', func.goldenSample))).toContain('func/req-alignment')
    // Upstream that is not a req artifact: same loud failure.
    const notReq: RuleContext = { upstream: [{ docType: 'func' }] }
    expect(issueRuleIds(validateOf(func, 'zh-CN', func.goldenSample, notReq))).toContain('func/req-alignment')
  })

  it('every ERROR issue carries a suggestion across all mutations', async () => {
    const { func, req } = await packs()
    const ctx = reqContext(req)
    const drafts = [
      mutate(func.goldenSample, d => { delete d.processes }),
      mutate(func.goldenSample, d => { (d.processes as Array<{ name: string }>)[0]!.name = '校验收藏资格' }),
      mutate(func.goldenSample, d => { (d.processes as Array<{ receiver: string }>)[0]!.receiver = '注册用户' }),
      mutate(func.goldenSample, d => { (d.processes as Array<{ name: string }>)[1]!.name = '收藏商品' }),
      mutate(func.goldenSample, d => { (d.processes as Array<{ index: number }>)[2]!.index = 9 }),
      mutate(func.goldenSample, d => { d.funcId = 'USR-DEL' }),
    ]
    const all = drafts.flatMap(draft => [...validateOf(func, 'zh-CN', draft, ctx), ...validateOf(func, 'en-US', draft, ctx)])
    const errors = all.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    for (const issue of errors) expect(issue.suggestion.length, `${issue.ruleId}: ${issue.message}`).toBeGreaterThan(0)
  })
})

describe('cosmic-func chained generation (deterministic LLM)', () => {
  it('generates a green artifact in the plan→req→func chain and records the upstream anchor', async () => {
    const { plan, req, func } = await packs()
    const deps = await makeDeps(scriptedLlm([JSON.stringify(plan.goldenSample)]))
    await defineDocGenerateTool(deps).execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, confirm: true, artifactName: 'plan' } as never, { signal } as never)
    deps.ctx.llm = scriptedLlm([JSON.stringify(req.goldenSample)])
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'req', upstream: ['output/plan.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)
    deps.ctx.llm = scriptedLlm([JSON.stringify(func.goldenSample)])
    const out = await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-func', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'func', upstream: ['output/req.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never) as { receipt: { isValid: boolean; upstreamHashes: Array<{ pack: string; artifactHash: string }> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.upstreamHashes).toHaveLength(1)
    expect(out.receipt.upstreamHashes[0]!.pack).toBe('cosmic-req')
  })

  it('repairs a cross-artifact violation in a later round (req-alignment feeds the loop)', async () => {
    const { plan, req, func } = await packs()
    const deps = await makeDeps(scriptedLlm([JSON.stringify(plan.goldenSample)]))
    await defineDocGenerateTool(deps).execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, confirm: true, artifactName: 'plan' } as never, { signal } as never)
    deps.ctx.llm = scriptedLlm([JSON.stringify(req.goldenSample)])
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'req', upstream: ['output/plan.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)
    const wrong = mutate(func.goldenSample, d => { d.desiredCfps = 40 })
    deps.ctx.llm = scriptedLlm([JSON.stringify(wrong), JSON.stringify(func.goldenSample)])
    const out = await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-func', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'func', upstream: ['output/req.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never) as { receipt: { isValid: boolean; iterations: number; rounds: Array<{ errorCount: number }> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.iterations).toBe(2)
    expect(out.receipt.rounds[0]!.errorCount).toBeGreaterThan(0)
    expect(out.receipt.rounds[1]!.errorCount).toBe(0)
  })

  it('doc_validate replays with upstream; without upstream the chained rule fails loud', async () => {
    const { plan, req, func } = await packs()
    const deps = await makeDeps(scriptedLlm([JSON.stringify(plan.goldenSample)]))
    await defineDocGenerateTool(deps).execute({ pack: 'cosmic-plan', materials: ['#!inline\nx'], language: 'zh-CN', params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, confirm: true, artifactName: 'plan' } as never, { signal } as never)
    deps.ctx.llm = scriptedLlm([JSON.stringify(req.goldenSample)])
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'req', upstream: ['output/plan.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)
    deps.ctx.llm = scriptedLlm([JSON.stringify(func.goldenSample)])
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-func', materials: ['#!inline\n收藏功能需求素材'], language: 'zh-CN', artifactName: 'func', upstream: ['output/req.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)

    const withUpstream = await defineDocValidateTool(deps).execute({
      artifactPath: 'output/func.json', pack: 'cosmic-func', upstream: ['output/req.json'],
    } as never, { signal } as never) as { receipt: { isValid: boolean }; hashMatches: boolean }
    expect(withUpstream.receipt.isValid).toBe(true)
    expect(withUpstream.hashMatches).toBe(true)

    const without = await defineDocValidateTool(deps).execute({
      artifactPath: 'output/func.json', pack: 'cosmic-func',
    } as never, { signal } as never) as { receipt: { isValid: boolean; rules: Array<{ id: string; status: string }> } }
    expect(without.receipt.isValid).toBe(false)
    expect(without.receipt.rules.find(r => r.ruleId === 'func/req-alignment')?.status).toBe('fail')
  })
})
