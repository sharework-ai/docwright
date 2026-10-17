import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DocService } from '../src/doc-service.ts'
import type { Issue } from '../src/issue.ts'
import type { Pack, RuleContext } from '../src/pack.ts'
import { loadPacks } from '../src/pack-loader.ts'
import { defineDocGenerateTool } from '../src/tools.ts'
import { scriptedLlm, seedContext, signal } from './support.ts'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))

let cache: { context: Pack; plan: Pack } | undefined
async function packs(): Promise<{ context: Pack; plan: Pack }> {
  if (cache === undefined) {
    const all = await loadPacks(packsRoot, {})
    cache = { context: all.get('cosmic-context')!, plan: all.get('cosmic-plan')! }
  }
  return cache
}

/** Effective default params for the plan (moduleLevels arrives from the context receipt). */
function planParams(pack: Pack): Record<string, unknown> {
  return { cfpPerFunc: { value: 30, min: 10, max: 100 }, cfpPerSubProc: 2.5, cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 }, moduleLevels: 2, ...Object.fromEntries(Object.entries(pack.manifest.params ?? {}).map(([name, spec]) => [name, spec.default]).filter(([, v]) => v !== undefined)) }
}

function validateOf(pack: Pack, lang: string, artifact: unknown, params?: Readonly<Record<string, unknown>>, context?: RuleContext): readonly Issue[] {
  return new DocService(pack, lang).validate(artifact, params, context)
}

function issueRuleIds(issues: readonly Issue[]): Set<string> {
  return new Set(issues.map(i => i.ruleId))
}

function hasSchemaError(issues: readonly Issue[]): boolean {
  return issues.some(i => i.ruleId.startsWith('schema/'))
}

function mutate(artifact: unknown, change: (draft: Record<string, unknown>) => void): Record<string, unknown> {
  const draft = structuredClone(artifact) as Record<string, unknown>
  change(draft)
  return draft
}

/** The upstream rule context: a green context artifact rides as the chain head. */
function contextUpstream(artifact: unknown): RuleContext {
  return { upstream: [artifact] }
}

describe('cosmic-context pack shape', () => {
  it('declares the workspace scope, reuse, and the shared moduleLevels param', async () => {
    const { context } = await packs()
    expect(context.manifest.scope).toBe('workspace')
    expect(context.manifest.reuse).toBe(true)
    expect(context.manifest.consumes).toEqual([])
    expect(context.manifest.languages).toEqual(['zh-CN', 'en-US'])
    expect(Object.keys(context.manifest.params ?? {})).toEqual(['topicNoPattern', 'moduleLevels'])
    expect(context.manifest.params!.topicNoPattern!.required).toBe(true)
    expect(context.manifest.params!.topicNoPattern!.confirm ?? false).toBe(false)
    expect(context.manifest.params!.moduleLevels!.default).toBe(2)
    expect(context.functionRules.map(r => r.id)).toEqual([
      'context/module-code-unique',
      'context/module-depth',
      'context/module-id-convention',
      'context/assumptions-review',
    ])
  })

  it('prompts carry the materials, upstream, and params slots in both languages', async () => {
    const { context } = await packs()
    for (const lang of context.manifest.languages) {
      const prompt = context.prompts.get(lang) ?? ''
      expect(prompt).toContain('{{materials}}')
      expect(prompt).toContain('{{upstream}}')
      expect(prompt).toContain('{{params}}')
    }
  })
})

describe('cosmic-context golden sample', () => {
  it('passes all-green in both languages under the default moduleLevels', async () => {
    const { context } = await packs()
    for (const lang of context.manifest.languages) {
      const issues = validateOf(context, lang, context.goldenSample, { moduleLevels: 2 })
      expect(issues.filter(i => i.severity === 'error'), `${lang}: ${JSON.stringify(issues)}`).toEqual([])
      expect(issues, `${lang}: ${JSON.stringify(issues)}`).toEqual([])
    }
  })

  it('generates deterministically into context/ and reuses on the next call', async () => {
    const { context } = await packs()
    const deps = {
      packs: (await loadPacks(packsRoot, {})) as never,
      config: { provider: 'p', model: 'm', workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-ctx-')), maxIterations: 3, promptTokenBudget: 60_000 } as never,
      ctx: { llm: scriptedLlm([JSON.stringify(context.goldenSample)]) },
    }
    const out = await defineDocGenerateTool(deps as never).execute({ pack: 'cosmic-context', materials: ['#!inline\n素材'], language: 'zh-CN', artifactName: 'context', confirm: true } as never, { signal } as never) as { artifactPath: string; receipt: { isValid: boolean; packVersion: string } }
    expect(out.artifactPath).toContain(`${deps.config.workspaceRoot}/context/`)
    expect(out.receipt.isValid).toBe(true)
    // The golden plan validates against the generated context via the chain rule.
    const { plan } = await packs()
    const fs = await import('node:fs/promises')
    const generated = JSON.parse(await fs.readFile(out.artifactPath, 'utf8')) as unknown
    const issues = validateOf(plan, 'zh-CN', plan.goldenSample, planParams(plan), { upstream: [generated] })
    expect(issues.filter(i => i.severity === 'error')).toEqual([])
  })
})

describe('cosmic-context mutations (guardrail-is-real)', () => {
  it('module-code-unique: a duplicated code anywhere in the tree is caught', async () => {
    const { context } = await packs()
    const draft = mutate(context.goldenSample, d => {
      ;((d.modules as Array<{ children?: Array<{ code: string }> }>)[1]!.children as Array<{ code: string }>)[0]!.code = 'USR'
    })
    expect(issueRuleIds(validateOf(context, 'zh-CN', draft, { moduleLevels: 2 }))).toContain('context/module-code-unique')
  })

  it('module-depth: the tree depth must equal the effective moduleLevels param', async () => {
    const { context } = await packs()
    // Golden depth is 2: requesting 3 or declaring 1 both fail.
    expect(issueRuleIds(validateOf(context, 'zh-CN', context.goldenSample, { moduleLevels: 3 }))).toContain('context/module-depth')
    expect(issueRuleIds(validateOf(context, 'zh-CN', context.goldenSample, { moduleLevels: 1 }))).toContain('context/module-depth')
    expect(issueRuleIds(validateOf(context, 'zh-CN', context.goldenSample, { moduleLevels: 2 }))).not.toContain('context/module-depth')
    // A deeper tree under levels=2 fails: rule-invisible via schema (L3 is legal structure).
    const deeper = mutate(context.goldenSample, d => {
      ;((d.modules as Array<{ children?: unknown[] }>)[0]!.children as Array<{ children?: Array<Record<string, unknown>> }>)[0]!.children = [
        { name: '三级叶子', code: 'LEAF', responsibility: '三级模块职责描述' },
      ]
    })
    expect(issueRuleIds(validateOf(context, 'zh-CN', deeper, { moduleLevels: 2 }))).toContain('context/module-depth')
    expect(issueRuleIds(validateOf(context, 'zh-CN', deeper, { moduleLevels: 3 }))).not.toContain('context/module-depth')
  })

  it('module-id-convention: every level in use declares its convention', async () => {
    const { context } = await packs()
    const missingL2 = mutate(context.goldenSample, d => { delete d.moduleIdConventionForLevel2 })
    expect(issueRuleIds(validateOf(context, 'zh-CN', missingL2, { moduleLevels: 2 }))).toContain('context/module-id-convention')
    // The golden with the convention intact stays clean.
    expect(issueRuleIds(validateOf(context, 'zh-CN', context.goldenSample, { moduleLevels: 2 }))).not.toContain('context/module-id-convention')
  })

  it('assumptions-review: non-empty assumptions raise the review warning without errors', async () => {
    const { context } = await packs()
    const draft = mutate(context.goldenSample, d => { d.assumptions = ['素材未覆盖支付模块，按惯例假定为自研'] })
    const issues = validateOf(context, 'zh-CN', draft, { moduleLevels: 2 })
    expect(issueRuleIds(issues)).toContain('context/assumptions-review')
    expect(issues.find(i => i.ruleId === 'context/assumptions-review')?.severity).toBe('warning')
    expect(issues.filter(i => i.severity === 'error')).toEqual([])
  })

  it('schema: wrong docType, invalid role kind, and malformed codes are rejected', async () => {
    const { context } = await packs()
    expect(hasSchemaError(validateOf(context, 'zh-CN', mutate(context.goldenSample, d => { d.docType = 'plan' }), { moduleLevels: 2 }))).toBe(true)
    expect(hasSchemaError(validateOf(context, 'zh-CN', mutate(context.goldenSample, d => { (d.roles as Array<{ kind: string }>)[0]!.kind = 'robot' }), { moduleLevels: 2 }))).toBe(true)
    const badCode = mutate(context.goldenSample, d => {
      ;(d.modules as Array<{ code: string }>)[0]!.code = 'TOOLONGCODE'
    })
    expect(hasSchemaError(validateOf(context, 'zh-CN', badCode, { moduleLevels: 2 }))).toBe(true)
    // A fourth level is not expressible: L3 nodes reject children outright.
    const fourLevels = mutate(context.goldenSample, d => {
      ;((d.modules as Array<{ children?: Array<{ children?: Array<Record<string, unknown>> }> }>)[0]!.children as Array<{ children?: Array<Record<string, unknown>> }>)[0]!.children = [
        { name: '叶子', code: 'LEAF', responsibility: '职责', children: [{ name: '第五级', code: 'FIFTH', responsibility: '越界' }] },
      ]
    })
    expect(hasSchemaError(validateOf(context, 'zh-CN', fourLevels, { moduleLevels: 3 }))).toBe(true)
  })

  it('every ERROR issue carries a suggestion across all mutations', async () => {
    const { context } = await packs()
    const drafts = [
      mutate(context.goldenSample, d => {
        ;((d.modules as Array<{ children?: Array<{ code: string }> }>)[1]!.children as Array<{ code: string }>)[0]!.code = 'USR'
      }),
      mutate(context.goldenSample, d => { delete d.moduleIdConventionForLevel2 }),
      mutate(context.goldenSample, d => { d.docType = 'plan' }),
    ]
    const all = drafts.flatMap(draft => [...validateOf(context, 'zh-CN', draft, { moduleLevels: 2 }), ...validateOf(context, 'en-US', draft, { moduleLevels: 2 })])
    const errors = all.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    for (const issue of errors) expect(issue.suggestion.length, `${issue.ruleId}: ${issue.message}`).toBeGreaterThan(0)
  })
})

describe('plan/context-alignment (chain head reconciliation)', () => {
  it('fails loud without a context upstream and with a non-context upstream', async () => {
    const { context, plan } = await packs()
    expect(issueRuleIds(validateOf(plan, 'zh-CN', plan.goldenSample, planParams(plan)))).toContain('plan/context-alignment')
    const notContext: RuleContext = { upstream: [{ docType: 'plan' }] }
    expect(issueRuleIds(validateOf(plan, 'zh-CN', plan.goldenSample, planParams(plan), notContext))).toContain('plan/context-alignment')
    void context
  })

  it('a modified function must reference an existing module name', async () => {
    const { context, plan } = await packs()
    const draft = mutate(plan.goldenSample, d => {
      ;(d.functions as Array<{ changeKind: string }>)[0]!.changeKind = 'modified'
    })
    expect(issueRuleIds(validateOf(plan, 'zh-CN', draft, planParams(plan), contextUpstream(context.goldenSample)))).toContain('plan/context-alignment')
    // Pointing the modified function at an existing module name passes the rule.
    const existing = mutate(draft, d => {
      ;(d.functions as Array<{ l2Name: string }>)[0]!.l2Name = '用户管理'
    })
    expect(issueRuleIds(validateOf(plan, 'zh-CN', existing, planParams(plan), contextUpstream(context.goldenSample)))).not.toContain('plan/context-alignment')
  })

  it('an added function must not collide with an existing code and follows the level convention', async () => {
    const { context, plan } = await packs()
    const colliding = mutate(plan.goldenSample, d => {
      ;(d.functions as Array<{ l2Name: string }>)[0]!.l2Name = '认证授权' // an existing context module name
    })
    expect(issueRuleIds(validateOf(plan, 'zh-CN', colliding, planParams(plan), contextUpstream(context.goldenSample)))).toContain('plan/context-alignment')
    // The golden's added modules use fresh names: the rule stays green.
    expect(issueRuleIds(validateOf(plan, 'zh-CN', plan.goldenSample, planParams(plan), contextUpstream(context.goldenSample)))).not.toContain('plan/context-alignment')
  })

  it('plan/name-hierarchy: l2Name/l3Name requiredness and the funcId segment floor follow moduleLevels', async () => {
    const { context, plan } = await packs()
    // levels=3: the golden (no l3Name) fails; adding l3Name fixes it.
    expect(issueRuleIds(validateOf(plan, 'zh-CN', plan.goldenSample, { ...planParams(plan), moduleLevels: 3 }, contextUpstream(context.goldenSample)))).toContain('plan/name-hierarchy')
    const withL3 = mutate(plan.goldenSample, d => {
      const functions = d.functions as Array<{ l3Name?: string; funcId: string }>
      functions[0]!.l3Name = '收藏夹整理'
      functions[0]!.funcId = 'USR-FAV-A1'
      functions[1]!.l3Name = '收藏记录清理'
      functions[1]!.funcId = 'USR-DEL-B2'
    })
    expect(issueRuleIds(validateOf(plan, 'zh-CN', withL3, { ...planParams(plan), moduleLevels: 3 }, contextUpstream(context.goldenSample)))).not.toContain('plan/name-hierarchy')
    // levels=1: a single-segment funcId with only l1Name passes.
    const flat = mutate(plan.goldenSample, d => {
      d.functions = [{ changeKind: 'modified', funcId: 'USR', l1Name: '一级名称', funcDesc: '长'.repeat(80), estimatedCfps: 35 }]
      d.totalCfps = 35
    })
    expect(issueRuleIds(validateOf(plan, 'zh-CN', flat, { ...planParams(plan), moduleLevels: 1 }, contextUpstream(context.goldenSample)))).not.toContain('plan/name-hierarchy')
    // levels=2 vs a single-segment funcId: the segment floor fires.
    expect(issueRuleIds(validateOf(plan, 'zh-CN', flat, { ...planParams(plan), moduleLevels: 2 }, contextUpstream(context.goldenSample)))).toContain('plan/name-hierarchy')
  })

  it('changeKind outside added|modified is rejected by the schema', async () => {
    const { context, plan } = await packs()
    expect(hasSchemaError(validateOf(plan, 'zh-CN', mutate(plan.goldenSample, d => { delete (d.functions as Array<Record<string, unknown>>)[0]!.changeKind }), planParams(plan), contextUpstream(context.goldenSample)))).toBe(true)
    expect(hasSchemaError(validateOf(plan, 'zh-CN', mutate(plan.goldenSample, d => { (d.functions as Array<{ changeKind: string }>)[0]!.changeKind = 'renamed' }), planParams(plan), contextUpstream(context.goldenSample)))).toBe(true)
  })

  it('deterministic chain: context seed then plan generation goes green with an anchored receipt', async () => {
    const { plan } = await packs()
    const deps = {
      packs: (await loadPacks(packsRoot, {})) as never,
      config: { provider: 'p', model: 'm', workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-ctxchain-')), maxIterations: 3, promptTokenBudget: 60_000 } as never,
      ctx: { llm: scriptedLlm([JSON.stringify(plan.goldenSample)]) },
    }
    const contextRef = await seedContext(deps as never)
    expect(contextRef).toBe('context/context.json')
    const out = await defineDocGenerateTool(deps as never).execute({
      pack: 'cosmic-plan', topic: 'topic-a', materials: ['#!inline\n需求素材'], language: 'zh-CN', artifactName: 'plan', upstream: [contextRef], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, confirm: true,
    } as never, { signal } as never) as { receipt: { isValid: boolean; upstreamHashes: Array<{ pack: string }>; params?: Record<string, unknown> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.upstreamHashes[0]!.pack).toBe('cosmic-context')
    // moduleLevels inherited from the context receipt into the plan's as-run params.
    expect(out.receipt.params).toMatchObject({ moduleLevels: 2 })
  })
})
