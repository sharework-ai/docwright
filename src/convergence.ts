import { DEFAULT_DECLINING_ROUNDS, DEFAULT_EPSILON, DEFAULT_MAX_REPEATS, DEFAULT_SCORE_WEIGHTS, DEFAULT_STAGNANT_ROUNDS, type Config } from './config.ts'
import type { Issue } from './issue.ts'
import type { Pack, ScoreFn } from './pack.ts'

/**
 * Convergence scoring for the repair loop's early-exit policy
 * (docs/designs/convergence-detection.md). Three layers, selected here:
 * pack score > built-in severity-weighted score > loose fingerprint fallback.
 * Scores are 0-100, higher is better; they only decide WHEN to give up —
 * green stays defined as 0 error issues.
 */

export type ScoringKind = 'score' | 'fingerprint'

export interface Scoring {
  readonly kind: ScoringKind
  /** Present iff kind is 'score'. */
  readonly scorer?: ScoreFn
  readonly stagnantRounds: number
  readonly decliningRounds: number
  readonly maxRepeats: number
  readonly epsilon: number
}

/** Built-in default score: severity-weighted, clamped to 0-100. */
export function defaultScore(issues: readonly Issue[], weights: { error: number; warning: number; info: number } = DEFAULT_SCORE_WEIGHTS): number {
  let errors = 0
  let warnings = 0
  let infos = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors++
    else if (issue.severity === 'warning') warnings++
    else infos++
  }
  return Math.max(0, Math.min(100, 100 - weights.error * errors - weights.warning * warnings - weights.info * infos))
}

/** Out-of-range or crashing pack scores fail loud (same path as a crashing rule). */
function wrapScore(raw: ScoreFn, packName: string): ScoreFn {
  return (artifact, issues) => {
    let value: number
    try {
      value = raw(artifact, issues)
    } catch (error) {
      throw new Error(`pack/score (${packName}) crashed: ${(error as Error).message}`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`pack/score (${packName}) returned ${String(value)}; expected a finite 0-100 number`)
    }
    return value
  }
}

/** Build the loop's scoring strategy from the pack and config (call-time: `mode: "score"` fails here if the pack ships no score). */
export function createScoring(pack: Pack, config: Config): Scoring {
  const o = config.oscillation ?? {}
  const mode = o.mode ?? 'auto'
  const stagnantRounds = o.stagnantRounds ?? DEFAULT_STAGNANT_ROUNDS
  const decliningRounds = o.decliningRounds ?? DEFAULT_DECLINING_ROUNDS
  const maxRepeats = o.maxRepeats ?? DEFAULT_MAX_REPEATS
  const epsilon = o.epsilon ?? DEFAULT_EPSILON
  const weights = {
    error: o.defaultScore?.error ?? DEFAULT_SCORE_WEIGHTS.error,
    warning: o.defaultScore?.warning ?? DEFAULT_SCORE_WEIGHTS.warning,
    info: o.defaultScore?.info ?? DEFAULT_SCORE_WEIGHTS.info,
  }
  if (mode === 'fingerprint') {
    return { kind: 'fingerprint', stagnantRounds, decliningRounds, maxRepeats, epsilon }
  }
  if (pack.score !== undefined) {
    return { kind: 'score', scorer: wrapScore(pack.score, pack.manifest.name), stagnantRounds, decliningRounds, maxRepeats, epsilon }
  }
  if (mode === 'score') {
    throw new Error(`pack "${pack.manifest.name}" exports no functions.js score but config oscillation.mode is "score" (fix: export score(artifact, issues) => 0-100 from rules/functions.js, or use mode "auto")`)
  }
  return {
    kind: 'score',
    scorer: (_artifact, issues) => defaultScore(issues, weights),
    stagnantRounds,
    decliningRounds,
    maxRepeats,
    epsilon,
  }
}
