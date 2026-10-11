import z from '@deepseek-ai/schemastery'

/** Single source of truth for tunable defaults (config.ts, not call sites). */
export const DEFAULT_MAX_ITERATIONS = 5
export const DEFAULT_PROMPT_TOKEN_BUDGET = 60_000
export const DEFAULT_MATERIALS_ROOT = 'references'
export const DEFAULT_OUTPUT_ROOT = 'output'

/** Upstream pack-version mismatch policy for chained generation. */
export type UpstreamVersionPolicy = 'strict' | 'warn'
export const DEFAULT_UPSTREAM_VERSION_POLICY: UpstreamVersionPolicy = 'strict'

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
  provider: z.string(),
  model: z.string(),
})
