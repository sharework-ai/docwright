import z from '@deepseek-ai/schemastery'

/** Single source of truth for tunable defaults (config.ts, not call sites). */
export const DEFAULT_MAX_ITERATIONS = 5
export const DEFAULT_PROMPT_TOKEN_BUDGET = 60_000
export const DEFAULT_MATERIALS_ROOT = 'references'
export const DEFAULT_OUTPUT_ROOT = 'output'
/** Convergence defaults (docs/designs/convergence-detection.md). */
export const DEFAULT_STAGNANT_ROUNDS = 3
export const DEFAULT_DECLINING_ROUNDS = 3
export const DEFAULT_MAX_REPEATS = 3
export const DEFAULT_EPSILON = 0
export const DEFAULT_SCORE_WEIGHTS = { error: 10, warning: 3, info: 1 } as const
/** Absolute round cap no override can pierce (docs/designs/dynamic-parameters.md). */
export const DEFAULT_MAX_ROUNDS_CEILING = 10

/** Upstream pack-version mismatch policy for chained generation. */
export type UpstreamVersionPolicy = 'strict' | 'warn'
export const DEFAULT_UPSTREAM_VERSION_POLICY: UpstreamVersionPolicy = 'strict'

/** Confirmation-gate policy: 'none' never gates (headless/CI), 'standard' gates on param changes or unconfirmed confirm-params, 'strict' gates every call with a param table to show (docs/designs/params-and-chain-contract.md). */
export type ConfirmPolicy = 'none' | 'standard' | 'strict'
export const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = 'standard'

/** Convergence/oscillation tuning; every field optional, defaults above. */
export interface OscillationConfig {
  /** 'auto' (default): pack score if exported else built-in default score; 'score' forces the pack score; 'fingerprint' uses the loose fallback only. */
  mode?: 'auto' | 'score' | 'fingerprint'
  /** Terminate after this many consecutive rounds without beating the best score. */
  stagnantRounds?: number
  /** Terminate after this many consecutive strictly-decreasing rounds. */
  decliningRounds?: number
  /** Fingerprint fallback: terminate after this many consecutive identical fingerprints. */
  maxRepeats?: number
  /** Minimum improvement that counts as progress. */
  epsilon?: number
  /** Severity weights for the built-in default score. */
  defaultScore?: { error?: number; warning?: number; info?: number }
}

/** Plugin configuration, overridable from cordis.yml (no hardcoded tunables). */
export interface Config {
  /** Extra pack directories merged over the built-in packs/ (same-name wins). */
  packsDir?: string
  /** Workspace root when no session workspace drives the call (default: cwd). */
  workspaceRoot?: string
  /** Root material references resolve against (default: <workspace>/references). */
  materialsRoot?: string
  /** Root artifacts are written to (default: <workspace>/output). */
  outputRoot?: string
  /** Default language; falls back to the first pack's first language when unset. */
  defaultLanguage?: string
  /** Repair-loop round cap. */
  maxIterations?: number
  /** Rough token budget for one repair prompt; oversized artifacts fail loud. */
  promptTokenBudget?: number
  /** Chained upstream pack-version mismatch: 'strict' rejects stale upstreams, 'warn' proceeds and surfaces upstreamWarnings (default strict). */
  upstreamVersionPolicy?: UpstreamVersionPolicy
  /** Confirmation-gate policy: 'none' never gates (headless/CI; required params still fail loud), 'standard' gates on param changes or unconfirmed confirm-params (default), 'strict' gates every call that has a param table to show. Per-call tool arg overrides this. */
  confirmPolicy?: ConfirmPolicy
  /** Repair-loop convergence tuning (termination is early-exit only; green stays 0 errors). */
  oscillation?: OscillationConfig
  /** Absolute round cap for doc_generate; tool args and pack defaults clamp to it (hard ceiling, host-operator owned). */
  maxRoundsCeiling?: number
  /** Provider/model route for the LLM seam; required at first generate call. */
  provider?: string
  model?: string
}

export const Config: z<Config> = z.object({
  packsDir: z.string(),
  workspaceRoot: z.string(),
  materialsRoot: z.string(),
  outputRoot: z.string(),
  defaultLanguage: z.string(),
  maxIterations: z.number().default(DEFAULT_MAX_ITERATIONS),
  promptTokenBudget: z.number().default(DEFAULT_PROMPT_TOKEN_BUDGET),
  upstreamVersionPolicy: z.union(['strict', 'warn']).default(DEFAULT_UPSTREAM_VERSION_POLICY),
  confirmPolicy: z.union(['none', 'standard', 'strict']).default(DEFAULT_CONFIRM_POLICY),
  oscillation: z.object({
    mode: z.union(['auto', 'score', 'fingerprint']).default('auto'),
    stagnantRounds: z.number().default(DEFAULT_STAGNANT_ROUNDS),
    decliningRounds: z.number().default(DEFAULT_DECLINING_ROUNDS),
    maxRepeats: z.number().default(DEFAULT_MAX_REPEATS),
    epsilon: z.number().default(DEFAULT_EPSILON),
    defaultScore: z.object({
      error: z.number().default(DEFAULT_SCORE_WEIGHTS.error),
      warning: z.number().default(DEFAULT_SCORE_WEIGHTS.warning),
      info: z.number().default(DEFAULT_SCORE_WEIGHTS.info),
    }),
  }),
  maxRoundsCeiling: z.number().default(DEFAULT_MAX_ROUNDS_CEILING),
  provider: z.string(),
  model: z.string(),
})
