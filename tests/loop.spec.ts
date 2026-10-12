import { describe, expect, it } from 'vitest'
import { INTERNAL_INVALID_OUTPUT, INTERNAL_LLM_ERROR, runRepairLoop } from '../src/loop.ts'
import type { LlmPort } from '../src/llm-port.ts'
import type { Issue } from '../src/issue.ts'
import { sha256 } from '../src/receipt.ts'

/** Scripted LLM fake: pops replies in order (deterministic loop tests). */
function fakeLlm(replies: string[], opts: { throws?: Error } = {}): LlmPort & { calls: string[] } {
  const calls: string[] = []
  let n = 0
  return {
    calls,
    async complete({ user }) {
      calls.push(user)
      if (opts.throws !== undefined) throw opts.throws
      const reply = replies[Math.min(n, replies.length - 1)]
      n++
      return reply ?? ''
    },
  }
}

const goodDoc = { functions: [{ funcId: 'F001', funcDesc: 'x'.repeat(80) }] }
const badDoc = { functions: [{ funcId: 'F001', funcDesc: 'short' }] }

function validateGood(doc: unknown): readonly Issue[] {
  return (doc as { functions?: Array<{ funcDesc?: string }> }).functions?.[0]?.funcDesc === 'x'.repeat(80) ? [] : [{ ruleId: 'plan/min-length', severity: 'error', jsonPath: '$.functions[0].funcDesc', message: 'too short', suggestion: 'lengthen' }]
}

const base = { promptTemplate: 'GEN {{materials}}', materials: ['需求素材'], maxIterations: 5, promptTokenBudget: 60_000, model: 'test' }

describe('repair loop', () => {
  it('goes green in one round when the first attempt validates', async () => {
    const llm = fakeLlm([JSON.stringify(goodDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood }, () => {})
    expect(result.status).toBe('green')
    if (result.status === 'green') expect(result.iterations).toBe(1)
  })

  it('repairs a bad first attempt and reports both rounds', async () => {
    const llm = fakeLlm([JSON.stringify(badDoc), JSON.stringify(goodDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood }, () => {})
    expect(result.status).toBe('green')
    if (result.status === 'green') {
      expect(result.iterations).toBe(2)
      expect(result.rounds).toHaveLength(2)
      expect(result.rounds[0]!.errorCount).toBe(1)
      expect(result.rounds[1]!.errorCount).toBe(0)
    }
    // Repair prompt must carry the issue and the instruction
    expect(llm.calls[1]).toContain('validation-issues')
    expect(llm.calls[1]).toContain('Fix ONLY the listed issues')
  })

  it('records each round promptHash as sha256 of the exact prompt sent', async () => {
    const llm = fakeLlm([JSON.stringify(badDoc), JSON.stringify(goodDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood }, () => {})
    expect(result.status).toBe('green')
    if (result.status === 'green') {
      expect(result.rounds[0]!.promptHash).toBe(sha256(llm.calls[0]!))
      expect(result.rounds[1]!.promptHash).toBe(sha256(llm.calls[1]!))
      // Repair changes the prompt, so the two rounds cannot share a hash.
      expect(result.rounds[0]!.promptHash).not.toBe(result.rounds[1]!.promptHash)
    }
  })

  it('records the attempted prompt hash on an llm-error round', async () => {
    const llm = fakeLlm([], { throws: new Error('HTTP 429') })
    const result = await runRepairLoop({ ...base, llm, validate: validateGood }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') {
      expect(result.reason).toBe('llm-error')
      expect(result.rounds[0]!.promptHash).toBe(sha256(llm.calls[0]!))
    }
  })

  it('maps unparseable output to internal/invalid-output', async () => {
    const llm = fakeLlm(['not json at all', JSON.stringify(goodDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: () => [] }, () => {})
    expect(result.status).toBe('green')
    if (result.status === 'green') expect(result.iterations).toBe(2)
  })

  it('maps adapter throws to internal/llm-error and keeps the draft', async () => {
    const llm = fakeLlm([], { throws: new Error('HTTP 429') })
    const result = await runRepairLoop({ ...base, llm, validate: validateGood }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') {
      expect(result.unresolved[0]!.ruleId).toBe(INTERNAL_LLM_ERROR)
      expect(result.reason).toBe('llm-error')
    }
  })

  it('terminates on fingerprint-repeat after three identical rounds (loose fallback)', async () => {
    const llm = fakeLlm([JSON.stringify(badDoc), JSON.stringify(badDoc), JSON.stringify(badDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') {
      expect(result.iterations).toBe(3)
      expect(result.reason).toBe('fingerprint-repeat')
      expect(result.unresolved.some(i => i.ruleId === 'plan/min-length')).toBe(true)
    }
  })

  it('exhausts after maxIterations with distinct issues', async () => {
    let n = 0
    const llm: LlmPort = { async complete() { n++; return JSON.stringify({ functions: [{ funcId: `F${n}`, funcDesc: 'short' }] }) } }
    // Distinct fingerprints per round: ruleId varies with the artifact's funcId
    const validateDistinct = (doc: unknown): readonly Issue[] => {
      const id = (doc as { functions?: Array<{ funcId?: string }> }).functions?.[0]?.funcId ?? 'none'
      return [{ ruleId: `plan/vary-${id}`, severity: 'error', jsonPath: `$.functions[0].funcDesc`, message: 'too short', suggestion: 'lengthen' }]
    }
    const result = await runRepairLoop({ ...base, llm, validate: validateDistinct }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') expect(result.iterations).toBe(5)
  })

  it('fails loud when the prompt exceeds the token budget', async () => {
    const llm = fakeLlm([JSON.stringify(goodDoc)])
    await expect(runRepairLoop({ ...base, llm, promptTokenBudget: 2, validate: validateGood }, () => {})).rejects.toThrow(/token budget/)
  })

  it('reports invalid-output when every reply is unparseable', async () => {
    const llm = fakeLlm(['garbage', 'garbage2'])
    const result = await runRepairLoop({ ...base, llm, validate: () => [] }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') expect(result.unresolved[0]!.ruleId).toBe(INTERNAL_INVALID_OUTPUT)
  })
})

describe('convergence scoring (score mode)', () => {
  function scoreScoring(scores: number[], over: Record<string, unknown> = {}): { scoring: import('../src/convergence.ts').Scoring; seen: number[] } {
    const seen: number[] = []
    let n = 0
    return {
      seen,
      scoring: {
        kind: 'score',
        scorer: () => {
          const s = scores[Math.min(n, scores.length - 1)]!
          n++
          seen.push(s)
          return s
        },
        stagnantRounds: 3,
        decliningRounds: 3,
        maxRepeats: 3,
        epsilon: 0,
        ...over,
      },
    }
  }

  it('terminates on stagnation after three rounds without beating the best score', async () => {
    const { scoring } = scoreScoring([50, 50, 50, 50])
    const llm = fakeLlm([JSON.stringify(badDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood, scoring }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') {
      expect(result.reason).toBe('stagnation')
      expect(result.iterations).toBe(4)
      expect(result.rounds.map(r => r.score)).toEqual([50, 50, 50, 50])
    }
  })

  it('terminates on strict decline before stagnation', async () => {
    const { scoring } = scoreScoring([90, 80, 70, 60])
    const llm = fakeLlm([JSON.stringify(badDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood, scoring }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') {
      expect(result.reason).toBe('decline')
      expect(result.iterations).toBe(4)
    }
  })

  it('tolerates a single-round dip when a later round beats the best', async () => {
    const { scoring } = scoreScoring([30, 25, 32])
    const llm = fakeLlm([JSON.stringify(badDoc), JSON.stringify(badDoc), JSON.stringify(badDoc), JSON.stringify(goodDoc)])
    const result = await runRepairLoop({ ...base, llm, validate: validateGood, scoring }, () => {})
    expect(result.status).toBe('green')
    if (result.status === 'green') expect(result.iterations).toBe(4)
  })

  it('honors epsilon: sub-epsilon gains do not reset stagnation', async () => {
    const { scoring } = scoreScoring([50, 53, 60], { epsilon: 5 })
    const llm = fakeLlm([JSON.stringify(badDoc)])
    const result = await runRepairLoop({ ...base, maxIterations: 8, llm, validate: validateGood, scoring }, () => {})
    expect(result.status).toBe('exhausted')
    if (result.status === 'exhausted') {
      // r1: 50 best; r2: 53 ≤ 50+5 → stagnant 1; r3: 60 > 55 → best, stagnant 0;
      // r4-r6: 60 flat → stagnant 3 → terminate on round 6
      expect(result.reason).toBe('stagnation')
      expect(result.iterations).toBe(6)
    }
  })
})
