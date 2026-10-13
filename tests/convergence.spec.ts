import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScoring, defaultScore } from '../src/convergence.ts'
import { generateDocument } from '../src/doc-service.ts'
import type { LlmPort } from '../src/llm-port.ts'
import type { Issue } from '../src/issue.ts'
import { loadPacks } from '../src/pack-loader.ts'
import { fileURLToPath } from 'node:url'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))

const err = (message: string): Issue[] => [{ ruleId: 'r/x', severity: 'error', jsonPath: '$', message, suggestion: 's' }]

function fakePack(over: Record<string, unknown> = {}): never {
  return { manifest: { name: 'p', version: '1', description: 'd', consumes: [], languages: ['zh-CN'] }, ...over } as never
}

function fakeConfig(oscillation?: Record<string, unknown>): never {
  return { provider: 'p', model: 'm', oscillation } as never
}

describe('defaultScore (built-in severity-weighted, 0-100)', () => {
  it('scores clean as 100 and weighs severities', () => {
    expect(defaultScore([])).toBe(100)
    expect(defaultScore(err('a'))).toBe(90)
    expect(defaultScore([
      { ruleId: 'a', severity: 'error', jsonPath: '$', message: 'x' },
      { ruleId: 'b', severity: 'warning', jsonPath: '$', message: 'y' },
      { ruleId: 'c', severity: 'info', jsonPath: '$', message: 'z' },
    ])).toBe(86)
  })

  it('clamps to the 0..100 band', () => {
    expect(defaultScore(err('a').concat(err('b'), err('c'), err('d'), err('e'), err('f'), err('g'), err('h'), err('i'), err('j'), err('k'), err('l')))).toBe(0)
    expect(defaultScore([], { error: -1, warning: 0, info: 0 })).toBe(100)
  })

  it('honors configured weights', () => {
    expect(defaultScore(err('a'), { error: 5, warning: 0, info: 0 })).toBe(95)
  })
})

describe('createScoring strategy matrix', () => {
  it('auto uses the pack score when exported, wrapped for range checks', () => {
    const scoring = createScoring(fakePack({ score: () => 42 }), fakeConfig())
    expect(scoring.kind).toBe('score')
    expect(scoring.scorer!({}, [])).toBe(42)
  })

  it('auto falls back to the built-in default scorer', () => {
    const scoring = createScoring(fakePack(), fakeConfig())
    expect(scoring.kind).toBe('score')
    expect(scoring.scorer!({}, err('a'))).toBe(90)
  })

  it('mode "score" without a pack export fails loud at call time', () => {
    expect(() => createScoring(fakePack(), fakeConfig({ mode: 'score' }))).toThrow(/no functions\.js score.*mode is "score"/)
  })

  it('mode "score" with a pack export uses the pack scorer', () => {
    const scoring = createScoring(fakePack({ score: () => 7 }), fakeConfig({ mode: 'score' }))
    expect(scoring.scorer!({}, [])).toBe(7)
  })

  it('mode "fingerprint" skips scoring entirely', () => {
    const scoring = createScoring(fakePack({ score: () => 7 }), fakeConfig({ mode: 'fingerprint' }))
    expect(scoring.kind).toBe('fingerprint')
    expect(scoring.scorer).toBeUndefined()
  })

  it('a crashing pack score fails loud with the pack/score label', () => {
    const scoring = createScoring(fakePack({ score: () => { throw new Error('boom') } }), fakeConfig())
    expect(() => scoring.scorer!({}, [])).toThrow(/pack\/score \(p\) crashed: boom/)
  })

  it('an out-of-range pack score fails loud', () => {
    const scoring = createScoring(fakePack({ score: () => 101 }), fakeConfig())
    expect(() => scoring.scorer!({}, [])).toThrow(/returned 101.*0-100/)
    const nan = createScoring(fakePack({ score: () => Number.NaN }), fakeConfig())
    expect(() => nan.scorer!({}, [])).toThrow(/0-100/)
  })

  it('reads custom stagnation/decline/repeat/epsilon/weights from config', () => {
    const scoring = createScoring(fakePack(), fakeConfig({ stagnantRounds: 2, decliningRounds: 4, maxRepeats: 5, epsilon: 1, defaultScore: { error: 25, warning: 1, info: 1 } }))
    expect(scoring).toMatchObject({ stagnantRounds: 2, decliningRounds: 4, maxRepeats: 5, epsilon: 1 })
    expect(scoring.scorer!({}, err('a'))).toBe(75)
  })
})

describe('pack loader: functions.js score export', () => {
  async function writePack(root: string, name: string, functionsSource: string): Promise<void> {
    const dir = join(root, name)
    for (const sub of ['rules', 'prompts', 'templates', 'samples']) await mkdir(join(dir, sub), { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name, version: '1', description: 'd', consumes: [], languages: ['zh-CN'] }), 'utf8')
    await writeFile(join(dir, 'schema.json'), '{"type":"object"}', 'utf8')
    await writeFile(join(dir, 'rules', 'zh-CN.json'), '[]', 'utf8')
    await writeFile(join(dir, 'rules', 'functions.js'), functionsSource, 'utf8')
    await writeFile(join(dir, 'prompts', 'zh-CN.md'), 'T {{materials}}', 'utf8')
    await writeFile(join(dir, 'templates', 'zh-CN.hbs'), 't', 'utf8')
    await writeFile(join(dir, 'samples', 'golden.json'), '{}', 'utf8')
  }

  it('loads a valid score export onto the pack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-score-'))
    await writePack(root, 'scored', 'export const rules = []\nexport function score() { return 50 }\n')
    const packs = await loadPacks(root, {})
    expect(typeof packs.get('scored')?.score).toBe('function')
  })

  it('fails loud when score is exported but is not a function', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docwright-score-bad-'))
    await writePack(root, 'bad-score', 'export const rules = []\nexport const score = 42\n')
    await expect(loadPacks(root, {})).rejects.toThrow(/`score` export must be a function/)
  })
})

describe('generateDocument integration: reason + round scores land in the red receipt', () => {
  it('records terminationReason and per-round scores on exhaustion', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'docwright-conv-e2e-'))
    const packs = await loadPacks(packsRoot, {})
    const pack = packs.get('cosmic-plan')!
    const calls: string[] = []
    const llm: LlmPort = { async complete({ user }) { calls.push(user); return 'not json at all' } }
    const input = {
      pack,
      language: 'zh-CN',
      materials: ['#!inline\n素材'],
      materialsRoot: join(ws, 'references'),
      artifactName: 'conv-e2e',
      workspaceRoot: ws,
      outputRoot: join(ws, 'output'),
      params: { cfpTotal: { value: 70, downFactor: 0.9, upFactor: 1.2 } },
      config: { provider: 'p', model: 'm', maxIterations: 5 } as never,
      llm,
      onRound: () => {},
    }
    await expect(generateDocument(input as never)).rejects.toThrow(/exhausted/)
    const receipt = JSON.parse(await readFile(join(ws, 'output', 'conv-e2e.receipt.json'), 'utf8')) as {
      isValid: boolean
      terminationReason?: string
      rounds: Array<{ score?: number }>
    }
    expect(receipt.isValid).toBe(false)
    // Constant unparseable output → constant default score → stagnation
    expect(receipt.terminationReason).toBe('stagnation')
    expect(receipt.rounds.length).toBeGreaterThanOrEqual(2)
    for (const round of receipt.rounds) expect(typeof round.score).toBe('number')
  })
})
