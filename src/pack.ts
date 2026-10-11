import type { Issue, Severity } from './issue.ts'

/**
 * Hybrid pack: declarative JSON rules for simple families plus a JS function
 * manifest for cross-field rules (CFP sums, uniqueness across arrays).
 * Decided at the /autoplan final gate (UC2) after the spectral-core probe.
 */

/** Declarative rule families; each targets one field across an array scope. Numeric bounds may reference pack params. */
export type DeclarativeRule =
  | { id: string; severity: Severity; given: string; field: string; kind: 'minLength'; min: number | ParamRef; suggestion: string }
  | { id: string; severity: Severity; given: string; field: string; kind: 'maxLength'; max: number | ParamRef; suggestion: string }
  | { id: string; severity: Severity; given: string; field: string; kind: 'forbiddenKeywords'; keywords: readonly string[]; suggestion: string }
  | { id: string; severity: Severity; given: string; field: string; kind: 'pattern'; pattern: string; mustMatch: boolean; suggestion: string }

/** JS rule: receives the whole artifact, returns issues. Pack-author authored. */
export interface FunctionRule {
  readonly id: string
  readonly severity: Severity
  readonly suggestion: string
  check(artifact: unknown): RuleIssue[]
}

/** Shape function rules may return (structural subset of Issue). */
export interface RuleIssue {
  readonly jsonPath: string
  readonly message: string
  readonly snapshot?: string
}

/**
 * Pack-provided convergence score (layer 1 of the termination policy):
 * a 0-100 quality estimate, higher is better. Receives the artifact and the
 * round's issues so cross-field and rule-aware scoring are both possible.
 * Never decides green — 0 errors does; it only informs early termination.
 */
export type ScoreFn = (artifact: unknown, issues: readonly Issue[]) => number

/**
 * Reference to a pack-declared parameter, usable in declarative-rule numeric
 * bounds (minLength.min / maxLength.max). Resolved per call from the
 * effective params; unknown names fail at pack load time.
 */
export interface ParamRef {
  readonly param: string
}

export function isParamRef(value: unknown): value is ParamRef {
  return typeof value === 'object' && value !== null && typeof (value as { param?: unknown }).param === 'string'
}

/** Declaration of one pack tunable (manifest `params`); declaration IS the allowlist. */
export interface ParamSpec {
  readonly type: 'number' | 'string' | 'boolean'
  readonly default: number | string | boolean
  readonly enum?: readonly (number | string | boolean)[] | undefined
  /** Numeric bounds (number-typed params only); the default must satisfy them. */
  readonly min?: number | undefined
  readonly max?: number | undefined
  readonly description: string
}

/** Pack manifest (`manifest.json`); version gates breaking pack changes. */
export interface PackManifest {
  readonly name: string
  readonly version: string
  /** One line naming the document this pack generates; `doc_packs` shows it to the model. */
  readonly description: string
  /** Artifact type names this pack consumes (chained generation); root packs use []. */
  readonly consumes: readonly string[]
  /** IETF-ish language tags the pack provides prompts/templates/keyword rules for. */
  readonly languages: readonly string[]
  /** Optional per-pack round-count default for the repair loop (clamped by config maxRoundsCeiling). */
  readonly maxRounds?: number | undefined
  /** Declared tunables; declaration is the allowlist — undeclared names are rejected at call time. */
  readonly params?: Readonly<Record<string, ParamSpec>> | undefined
}

/** A loaded, resolved pack ready for the loop. */
export interface Pack {
  readonly manifest: PackManifest
  /** JSON Schema (draft-07 or 2020-12) the artifact must satisfy. */
  readonly schema: Record<string, unknown>
  /** Declarative rules; language-scoped keyword rules keyed per language. */
  readonly rules: ReadonlyMap<string, readonly DeclarativeRule[]>
  readonly functionRules: readonly FunctionRule[]
  /** Optional convergence scorer exported from rules/functions.js (0-100). */
  readonly score?: ScoreFn | undefined
  /** sha256 of rules/functions.js source bytes; '' when the pack ships none. */
  readonly functionsSourceHash: string
  /** Generator prompt per language; `{{materials}}`, `{{upstream}}` slots. */
  readonly prompts: ReadonlyMap<string, string>
  /** Handlebars template per language rendering the artifact to Markdown. */
  readonly templates: ReadonlyMap<string, string>
  /** Audited reference document that must pass all-green. */
  readonly goldenSample: unknown
  /** Working directory the pack was loaded from (diagnostics). */
  readonly dir: string
}
