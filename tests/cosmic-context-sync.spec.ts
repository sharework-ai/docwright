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

let cache: { sync: Pack; context: Pack; plan: Pack } | undefined
async function packs(): Promise<{ sync: Pack; context: Pack; plan: Pack }> {
  if (cache === undefined) {
    const all = await loadPacks(packsRoot, {})
    cache = { sync: all.get('cosmic-context-sync')!, context: all.get('cosmic-context')!, plan: all.get('cosmic-plan')! }
  }
  return cache
}

/** The sync upstream fixture: the old context golden + the topic's plan golden. */
function chainUpstream(context: Pack, plan: Pack): RuleContext {
  return { upstream: [context.goldenSample, plan.goldenSample] }
}

function validateOf(pack: Pack, lang: string, artifact: unknown, params?: Readonly<Record<string, unknown>>, context?: RuleContext): readonly Issue[] {
  return new DocService(pack, lang).validate(artifact, params, context)
}

function issueRuleIds(issues: readonly Issue[]): Set<string> {
  return new Set(issues.map(i => i.ruleId))
}

function mutate(artifact: unknown, change: (draft: Record<string, unknown>) => void): Record<string, unknown> {
  const draft = structuredClone(artifact) as Record<string, unknown>
  change(draft)
  return draft
}

describe('cosmic-context-sync pack shape', () => {
  it('declares workspace scope without reuse and consumes context + plan', async () => {
    const { sync } = await packs()
    expect(sync.manifest.scope).toBe('workspace')
    expect(sync.manifest.reuse).toBe(false)
    expect(sync.manifest.consumes).toEqual(['cosmic-context', 'cosmic-plan'])
    expect(sync.functionRules.map(r => r.id)).toEqual([
      'context/module-code-unique',
      'context/module-depth',
      'context/module-id-convention',
      'context/assumptions-review',
      'context-sync/coverage',
      'context-sync/preserve',
    ])
  })

  it('prompts carry the three slots in both languages and name the merge semantics', async () => {
    const { sync } = await packs()
    for (const lang of sync.manifest.languages) {
      const prompt = sync.prompts.get(lang) ?? ''
      expect(prompt).toContain('{{materials}}')
      expect(prompt).toContain('{{upstream}}')
      expect(prompt).toContain('{{params}}')
      expect(prompt).toContain('moduleIdConventionForLevelN')
    }
  })
})

describe('cosmic-context-sync golden sample', () => {
  it('passes all-green in both languages against the context+plan fixture', async () => {
    const { sync, context, plan } = await packs()
    for (const lang of sync.manifest.languages) {
      const issues = validateOf(sync, lang, sync.goldenSample, { moduleLevels: 2 }, chainUpstream(context, plan))
      expect(issues, `${lang}: ${JSON.stringify(issues)}`).toEqual([])
    }
  })

  it('coverage: a dropped plan module is an error; missing upstream is loud', async () => {
    const { sync, context, plan } = await packs()
    const dropped = mutate(sync.goldenSample, d => {
      const children = ((d.modules as Array<{ children?: unknown[] }>)[0]!.children) as Array<{ name: string }>
      d.modules[0]!.children = children.filter(child => child.name !== '添加收藏')
    })
    expect(issueRuleIds(validateOf(sync, 'zh-CN', dropped, { moduleLevels: 2 }, chainUpstream(context, plan)))).toContain('context-sync/coverage')
    // Without the plan upstream the rule fails loud instead of silently passing.
    expect(issueRuleIds(validateOf(sync, 'zh-CN', sync.goldenSample, { moduleLevels: 2 }))).toContain('context-sync/coverage')
  })

  it('preserve: a lost old-context module is a warning, not an error', async () => {
    const { sync, context, plan } = await packs()
    const lost = mutate(sync.goldenSample, d => {
      // Drop the product-center subtree (no plan modules inside it).
      d.modules = (d.modules as unknown[]).slice(0, 1)
    })
    const issues = validateOf(sync, 'zh-CN', lost, { moduleLevels: 2 }, chainUpstream(context, plan))
    expect(issueRuleIds(issues)).toContain('context-sync/preserve')
    expect(issues.find(i => i.ruleId === 'context-sync/preserve')?.severity).toBe('warning')
    // Coverage still enforces the plan side even when the old side shrinks.
    expect(issueRuleIds(issues)).not.toContain('context-sync/coverage')
  })
})

describe('cosmic-context-sync deterministic generation', () => {
  it('syncs the topic plan back into context/ with both upstream anchors', async () => {
    const { sync, plan } = await packs()
    const deps = {
      packs: (await loadPacks(packsRoot, {})) as never,
      config: { provider: 'p', model: 'm', workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-sync-')), maxIterations: 3, promptTokenBudget: 60_000 } as never,
      ctx: { llm: scriptedLlm([JSON.stringify(plan.goldenSample)]) },
    }
    await seedContext(deps as never)
    // The topic plan lands under <topic>/output/.
    deps.ctx.llm = scriptedLlm([JSON.stringify(plan.goldenSample)])
    await defineDocGenerateTool(deps as never).execute({
      pack: 'cosmic-plan', materials: ['#!inline\n需求素材'], language: 'zh-CN', artifactName: 'plan', topic: 'req-2026-001', upstream: ['context/context.json'], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, confirm: true,
    } as never, { signal } as never)
    // Sync: workspace scope ignores the topic; both upstreams are anchored.
    deps.ctx.llm = scriptedLlm([JSON.stringify((await packs()).sync.goldenSample)])
    const out = await defineDocGenerateTool(deps as never).execute({
      pack: 'cosmic-context-sync', materials: [], language: 'zh-CN', artifactName: 'context', topic: 'req-2026-001',
      upstream: ['context/context.json', 'req-2026-001/output/plan.json'],
    } as never, { signal } as never) as { artifactPath: string; reused?: boolean; receipt: { isValid: boolean; upstreamHashes: Array<{ pack: string }>; params?: Record<string, unknown> } }
    expect(out.artifactPath).toBe(join((deps.config as { workspaceRoot: string }).workspaceRoot, 'context', 'context.json'))
    expect(out.reused).toBeUndefined() // reuse: false — sync is an action, never short-circuited
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.upstreamHashes.map(a => a.pack)).toEqual(['cosmic-context', 'cosmic-plan'])
    expect(out.receipt.params).toMatchObject({ moduleLevels: 2 })
  })
})
