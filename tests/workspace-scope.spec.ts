import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPacks } from '../src/pack-loader.ts'
import { artifactHashOf } from '../src/receipt.ts'
import { defineDocChainStatusTool, defineDocGenerateTool, defineDocValidateTool } from '../src/tools.ts'
import { seedContext } from './support.ts'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))
const signal = new AbortController().signal

/** Scripted LLM port that replies with the given texts in order (stays on the last one); records call count. */
function scriptedLlm(replies: string[]): { llm: unknown; calls: () => number } {
  let n = 0
  return {
    calls: () => n,
    llm: {
      stream: async function* () {
        const reply = replies[Math.min(n, replies.length - 1)]
        n++
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: 'stop' }
      },
    },
  }
}

/** Minimal fixture pack: schema-free ({} validates), no rules, workspace-scope by manifest override. */
async function writeFixturePack(root: string, name: string, manifest: Record<string, unknown>): Promise<string> {
  const dir = join(root, name)
  await mkdir(join(dir, 'rules'), { recursive: true })
  await mkdir(join(dir, 'prompts'), { recursive: true })
  await mkdir(join(dir, 'templates'), { recursive: true })
  await mkdir(join(dir, 'samples'), { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name, version: '1.0.0', description: `${name} fixture`, consumes: [], languages: ['zh-CN'], ...manifest }), 'utf8')
  await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
  await writeFile(join(dir, 'rules', 'zh-CN.json'), '[]', 'utf8')
  await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'p {{materials}} {{upstream}} {{params}}', 'utf8')
  await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
  await writeFile(join(dir, 'samples', 'golden.json'), '{}', 'utf8')
  return dir
}

async function makeDeps(llm: unknown) {
  const all = await loadPacks(packsRoot, {})
  return {
    packs: all,
    config: {
      provider: 'p',
      model: 'test-model',
      workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-scope-')),
      maxIterations: 3,
      promptTokenBudget: 60_000,
    } as never,
    ctx: { llm },
  }
}

const PLAN_ARGS = {
  pack: 'cosmic-plan',
  topic: 'topic-a',
  materials: ['#!inline\n素材'],
  language: 'zh-CN',
  upstream: ['context/context.json'],
  artifactName: 'plan',
  params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
  confirm: true,
}

async function generatePlan(deps: Awaited<ReturnType<typeof makeDeps>>, reply: unknown, extra: Record<string, unknown> = {}) {
  await seedContext(deps)
  const { llm } = scriptedLlm([JSON.stringify(reply)])
  deps.ctx.llm = llm
  return defineDocGenerateTool(deps).execute({ ...PLAN_ARGS, ...extra } as never, { signal } as never) as Promise<Record<string, unknown>>
}

describe('manifest scope/reuse declaration (pack-loader)', () => {
  it('builtin packs default to topic scope without reuse', async () => {
    const packs = await loadPacks(packsRoot, {})
    expect(packs.size).toBeGreaterThan(0)
    for (const pack of packs.values()) {
      expect(['workspace', 'topic']).toContain(pack.manifest.scope)
    }
    expect(packs.get('cosmic-context')!.manifest).toMatchObject({ scope: 'workspace', reuse: true })
    // The sync pack is the deliberate workspace-without-reuse exception (sync is an action).
    expect(packs.get('cosmic-context-sync')!.manifest).toMatchObject({ scope: 'workspace', reuse: false })
    expect(packs.get('cosmic-plan')!.manifest).toMatchObject({ scope: 'topic', reuse: false, materialsRoot: 'input' })
    // The per-topic chain stages now declare reuse: every input class is anchor-verified.
    expect(packs.get('cosmic-req')!.manifest).toMatchObject({ reuse: true })
    expect(packs.get('cosmic-func')!.manifest).toMatchObject({ reuse: true })
    expect(packs.get('cosmic-tech')!.manifest).toMatchObject({ reuse: true })
  })

  it('a workspace-scope pack defaults reuse to true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-wsfix-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(root, {})
    expect(packs.get('ws-pack')!.manifest.scope).toBe('workspace')
    expect(packs.get('ws-pack')!.manifest.reuse).toBe(true)
  })

  it('an explicit reuse declaration wins over the scope default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-wsfix-'))
    await writeFixturePack(root, 'ws-noreuse', { scope: 'workspace', reuse: false })
    const packs = await loadPacks(root, {})
    expect(packs.get('ws-noreuse')!.manifest.reuse).toBe(false)
  })

  it('fails loud on a non-boolean requiresTopic and on workspace-scope requiresTopic', async () => {
    const badType = await mkdtemp(join(tmpdir(), 'docwright-badrt-'))
    await writeFixturePack(badType, 'rt', { requiresTopic: 'yes' })
    await expect(loadPacks(badType, {})).rejects.toThrow(/manifest\.requiresTopic must be a boolean/)
    const badScope = await mkdtemp(join(tmpdir(), 'docwright-wsrt-'))
    await writeFixturePack(badScope, 'ws-rt', { scope: 'workspace', requiresTopic: true })
    await expect(loadPacks(badScope, {})).rejects.toThrow(/requiresTopic is meaningless on a workspace-scope pack/)
  })

  it('validates manifest.materialsRoot and keeps a valid declaration', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'docwright-mr-'))
    await writeFixturePack(bad, 'mr-abs', { materialsRoot: '/etc' })
    await expect(loadPacks(bad, {})).rejects.toThrow(/manifest\.materialsRoot must be a workspace-relative directory path/)
    const esc = await mkdtemp(join(tmpdir(), 'docwright-mr2-'))
    await writeFixturePack(esc, 'mr-esc', { materialsRoot: 'a/../..b' })
    await expect(loadPacks(esc, {})).rejects.toThrow(/manifest\.materialsRoot must be a workspace-relative directory path/)
    const ok = await mkdtemp(join(tmpdir(), 'docwright-mr3-'))
    await writeFixturePack(ok, 'mr-ok', { materialsRoot: 'input' })
    expect((await loadPacks(ok, {})).get('mr-ok')!.manifest.materialsRoot).toBe('input')
  })

  it('fails loud on an out-of-domain scope and a non-boolean reuse', async () => {
    const badScope = await mkdtemp(join(tmpdir(), 'docwright-badscope-'))
    await writeFixturePack(badScope, 'galactic', { scope: 'galactic' })
    await expect(loadPacks(badScope, {})).rejects.toThrow(/manifest\.scope must be "workspace" or "topic"/)
    const badReuse = await mkdtemp(join(tmpdir(), 'docwright-badreuse-'))
    await writeFixturePack(badReuse, 'yesreuse', { reuse: 'yes' })
    await expect(loadPacks(badReuse, {})).rejects.toThrow(/manifest\.reuse must be a boolean/)
  })
})

describe('requiresTopic enforcement (doc_generate)', () => {
  it('requirement-scoped packs refuse to generate without a topic', async () => {
    const deps = await makeDeps({})
    const args = { ...PLAN_ARGS }
    delete (args as Record<string, unknown>).topic
    await expect(defineDocGenerateTool(deps).execute(args as never, { signal } as never))
      .rejects.toThrow(/scopes its artifacts to one topic: pass topic/)
  })

  it('topic is a plain-segment name even when the pack requires it', async () => {
    const deps = await makeDeps({})
    await expect(defineDocGenerateTool(deps).execute({ ...PLAN_ARGS, topic: '../escape' } as never, { signal } as never))
      .rejects.toThrow(/topic must be a single directory name/)
  })
})

describe('topic parameter (doc_generate roots)', () => {
  it('relocates the output root to <topic>/output/ and the materials dir to <topic>/input/ (plan declares input)', async () => {
    const deps = await makeDeps((await loadPacks(packsRoot, {})).get('cosmic-plan')!.goldenSample)
    const root = (deps.config as { workspaceRoot: string }).workspaceRoot
    await mkdir(join(root, 'req-a', 'input'), { recursive: true })
    await writeFile(join(root, 'req-a', 'input', 'mat.txt'), '话题素材', 'utf8')
    await seedContext(deps)
    deps.ctx.llm = scriptedLlm([JSON.stringify((await loadPacks(packsRoot, {})).get('cosmic-plan')!.goldenSample)]).llm
    const out = await defineDocGenerateTool(deps).execute({ ...PLAN_ARGS, materials: ['mat.txt'], topic: 'req-a' } as never, { signal } as never) as { artifactPath: string }
    expect(out.artifactPath).toBe(join(root, 'req-a', 'output', 'plan.json'))
    // The material was read from the topic references dir (generation succeeded on it alone).
  })

  it('rejects a topic that is not a plain path segment', async () => {
    const deps = await makeDeps({})
    for (const bad of ['../escape', 'a/b', '.hidden', '..']) {
      await expect(defineDocGenerateTool(deps).execute({ ...PLAN_ARGS, topic: bad } as never, { signal } as never))
        .rejects.toThrow(/topic must be a single directory name/)
    }
  })

  it('workspace-scope packs ignore the topic and write to <workspace>/context/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-wsdir-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: await mkdtemp(join(tmpdir(), 'docwright-wsws-')) } as never, ctx: { llm: scriptedLlm(['{"ok":true}']).llm } }
    for (const args of [{ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' }, { pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx', topic: 'req-a' }]) {
      const out = await defineDocGenerateTool(deps).execute(args as never, { signal } as never) as { artifactPath: string }
      expect(out.artifactPath).toBe(join((deps.config as { workspaceRoot: string }).workspaceRoot, 'context', 'ctx.json'))
    }
  })
})

describe('workspace reuse pre-check (doc_generate)', () => {
  it('returns the green hash-intact artifact without calling the LLM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-reuse-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-reuse-ws-'))
    const first = scriptedLlm(['{"v":1}'])
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: first.llm } }
    const gen = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { artifactPath: string; reused?: boolean }
    expect(gen.reused).toBeUndefined()
    expect(first.calls()).toBe(1)

    const deps2 = { ...deps, ctx: { llm: scriptedLlm(['{"v":2}']).llm } }
    const again = await defineDocGenerateTool(deps2).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { artifactPath: string; reused?: boolean; receipt: { isValid: boolean } }
    expect(again.reused).toBe(true)
    expect(again.artifactPath).toBe(gen.artifactPath)
    expect(again.receipt.isValid).toBe(true)
    // No LLM was available-spent: the fresh port would have replied {"v":2}.
    const artifact = JSON.parse(await readFile(gen.artifactPath, 'utf8')) as { v: number }
    expect(artifact.v).toBe(1)
  })

  it('regenerates when the artifact was edited, the receipt is red, or force is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-reuse2-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-reuse2-ws-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: scriptedLlm(['{"v":1}']).llm } }
    const gen = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { artifactPath: string }

    // Edited artifact → hash mismatch → regenerate.
    await writeFile(gen.artifactPath, '{"v":999}\n', 'utf8')
    const callA = scriptedLlm(['{"v":2}'])
    deps.ctx.llm = callA.llm
    const regenerated = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { reused?: boolean }
    expect(regenerated.reused).toBeUndefined()
    expect(callA.calls()).toBe(1)

    // Red receipt → regenerate.
    const receiptPath = gen.artifactPath.replace(/\.json$/, '.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as { isValid: boolean }
    receipt.isValid = false
    await writeFile(receiptPath, JSON.stringify(receipt), 'utf8')
    const callB = scriptedLlm(['{"v":3}'])
    deps.ctx.llm = callB.llm
    const redRerun = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { reused?: boolean }
    expect(redRerun.reused).toBeUndefined()
    expect(callB.calls()).toBe(1)

    // Green and intact, but force: true → rebuild anyway.
    const callC = scriptedLlm(['{"v":3}'])
    deps.ctx.llm = callC.llm
    const forced = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx', force: true } as never, { signal } as never) as { reused?: boolean }
    expect(forced.reused).toBeUndefined()
    expect(callC.calls()).toBe(1)
  })

  it('a receipt from another pack version never reuses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-reuse3-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-reuse3-ws-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: scriptedLlm(['{"v":1}']).llm } }
    const gen = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { artifactPath: string }
    const receiptPath = gen.artifactPath.replace(/\.json$/, '.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as { packVersion: string }
    receipt.packVersion = '0.0.1-old'
    await writeFile(receiptPath, JSON.stringify(receipt), 'utf8')
    const call = scriptedLlm(['{"v":1}'])
    deps.ctx.llm = call.llm
    const stale = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { reused?: boolean }
    expect(stale.reused).toBeUndefined()
    expect(call.calls()).toBe(1)
  })
})

  it('skips artifacts without a readable sidecar during the scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-reuse4-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-reuse4-ws-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: scriptedLlm(['{"v":1}']).llm } }
    await mkdir(join(wsRoot, 'context'), { recursive: true })
    await writeFile(join(wsRoot, 'context', 'bare.json'), '{"v":0}\n', 'utf8')
    const out = await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never) as { reused?: boolean; artifactPath: string }
    expect(out.reused).toBeUndefined()
    expect(out.artifactPath).toBe(join(wsRoot, 'context', 'ctx.json'))
  })

describe('upstream riders (verifyUpstreamReceipts)', () => {
  it('lets an installed-pack green artifact ride along a chain edge and anchors both', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-rider-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-rider-ws-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: scriptedLlm(['{"ok":true}']).llm } }
    await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never)
    await generatePlan(deps, (await loadPacks(packsRoot, {})).get('cosmic-plan')!.goldenSample)
    const reqPack = packs.get('cosmic-req')!
    deps.ctx.llm = scriptedLlm([JSON.stringify(reqPack.goldenSample)]).llm
    const out = await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', topic: 'topic-a', materials: [], language: 'zh-CN',
      upstream: ['topic-a/output/plan.json', 'context/ctx.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never) as { receipt: { isValid: boolean; upstreamHashes: Array<{ pack: string }> } }
    expect(out.receipt.isValid).toBe(true)
    expect(out.receipt.upstreamHashes.map(a => a.pack)).toEqual(['cosmic-plan', 'ws-pack'])
  })

  it('accepts CJK and inner spaces in topic names; still rejects path separators', async () => {
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-cjk-'))
    const packs = await loadPacks(packsRoot, {})
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: {} } }
    const numbered = JSON.parse(JSON.stringify(packs.get('cosmic-plan')!.goldenSample)) as { functions: Array<{ funcId: string }> }
    numbered.functions[0]!.funcId = 'KERQ-352-01'
    numbered.functions[1]!.funcId = 'KERQ-352-02'
    await seedContext(deps)
    deps.ctx.llm = scriptedLlm([JSON.stringify(numbered)]).llm
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-plan', topic: 'KERQ-352 收藏夹', materials: ['#!inline\nx'], language: 'zh-CN',
      upstream: ['context/context.json'], params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } }, confirm: true,
    } as never, { signal } as never)
    const reqPack = packs.get('cosmic-req')!
    const reqReply = JSON.parse(JSON.stringify(reqPack.goldenSample)) as { funcId: string }
    reqReply.funcId = 'KERQ-352-01'
    deps.ctx.llm = scriptedLlm([JSON.stringify(reqReply)]).llm
    const out = await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', materials: [], language: 'zh-CN', topic: 'KERQ-352 收藏夹',
      upstream: ['KERQ-352 收藏夹/output/PLAN-KERQ-352.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never) as { receipt: { isValid: boolean } }
    expect(out.receipt.isValid).toBe(true)
    await expect(defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', materials: [], language: 'zh-CN', topic: 'a/b',
      upstream: ['a/b/output/plan.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)).rejects.toThrow(/topic must be a single directory name/)
  })

  it('fails loud when no upstream artifact is of a consumed type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-rider2-'))
    await writeFixturePack(root, 'ws-pack', { scope: 'workspace' })
    const packs = await loadPacks(packsRoot, { extra: [root] })
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-rider2-ws-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: scriptedLlm(['{"ok":true}']).llm } }
    await defineDocGenerateTool(deps).execute({ pack: 'ws-pack', materials: ['#!inline\nx'], language: 'zh-CN', artifactName: 'ctx' } as never, { signal } as never)
    await expect(defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', topic: 'topic-a', materials: [], language: 'zh-CN', artifactName: 'req',
      upstream: ['context/ctx.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)).rejects.toThrow(/none of the upstream artifacts is of a consumed type/)
  })
  it('fails loud when an upstream receipt records no pack', async () => {
    const packs = await loadPacks(packsRoot, {})
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-rider3-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: {} } }
    await mkdir(join(wsRoot, 'output'), { recursive: true })
    await writeFile(join(wsRoot, 'output', 'plan.json'), JSON.stringify(packs.get('cosmic-plan')!.goldenSample), 'utf8')
    await writeFile(join(wsRoot, 'output', 'packless.json'), '{"x":1}\n', 'utf8')
    await writeFile(join(wsRoot, 'output', 'packless.receipt.json'), JSON.stringify({ isValid: true, artifactHash: artifactHashOf({ x: 1 }) }), 'utf8')
    await expect(defineDocValidateTool(deps).execute({
      artifactPath: 'output/plan.json', pack: 'cosmic-req', upstream: ['output/packless.json'],
      params: { targetIndex: 1 },
    } as never, { signal } as never)).rejects.toThrow(/records no pack/)
  })
})

describe('doc_chain_status output-root inference', () => {
  it('scopes the coverage scan to the directory holding the plan', async () => {
    const packs = await loadPacks(packsRoot, {})
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-chain-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: {} } }
    await generatePlan(deps, packs.get('cosmic-plan')!.goldenSample, { topic: 'req-a' })
    const reqPack = packs.get('cosmic-req')!
    deps.ctx.llm = scriptedLlm([JSON.stringify(reqPack.goldenSample)]).llm
    await defineDocGenerateTool(deps).execute({
      pack: 'cosmic-req', materials: [], language: 'zh-CN', topic: 'req-a',
      upstream: ['req-a/output/plan.json'], params: { targetIndex: 1 }, confirm: true,
    } as never, { signal } as never)
    // A decoy req artifact in the workspace-level output/ must not leak into the topic scan.
    await mkdir(join(wsRoot, 'output'), { recursive: true })
    const golden = JSON.stringify(reqPack.goldenSample)
    await writeFile(join(wsRoot, 'output', 'stray.json'), golden, 'utf8')
    await writeFile(join(wsRoot, 'output', 'stray.receipt.json'), JSON.stringify({ pack: 'cosmic-req', isValid: true }), 'utf8')
    const status = await defineDocChainStatusTool(deps).execute({ plan: 'req-a/output/plan.json' } as never, { signal } as never) as { coverage: Record<string, { covered: number; total: number }> }
    expect(status.coverage['cosmic-req']).toEqual({ covered: 1, total: 2 })
  })

  it('doc_validate replay works inside a topic directory', async () => {
    const packs = await loadPacks(packsRoot, {})
    const wsRoot = await mkdtemp(join(tmpdir(), 'docwright-topicval-'))
    const deps = { packs, config: { provider: 'p', model: 'm', workspaceRoot: wsRoot } as never, ctx: { llm: {} } }
    await generatePlan(deps, packs.get('cosmic-plan')!.goldenSample, { topic: 'req-a' })
    const checked = await defineDocValidateTool(deps).execute({ artifactPath: 'req-a/output/plan.json', pack: 'cosmic-plan', upstream: ['context/context.json'] } as never, { signal } as never) as { hashMatches: boolean; receipt: { isValid: boolean } }
    expect(checked.hashMatches).toBe(true)
    expect(checked.receipt.isValid).toBe(true)
  })
})
