import { createHash } from 'node:crypto'

/**
 * Sidecar validation receipt (`<artifact>.receipt.json`): the all-green state
 * as a portable artifact. Tamper-EVIDENT, not tamper-proof (no signature):
 * `doc_validate` re-hashes the artifact and re-runs the embedded ruleset
 * snapshot, so accidental edits go red; a determined attacker can forge both.
 */

/** JSON value used inside receipt snapshots. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export const RECEIPT_FORMAT_VERSION = 1

export type ReceiptRound = {
  readonly round: number
  readonly errorCount: number
  readonly warningCount: number
  /** Convergence score of the round (score mode only, 0-100). */
  readonly score?: number
}

export type ReceiptRuleResult = {
  readonly ruleId: string
  readonly severity: string
  readonly status: 'pass' | 'fail'
  readonly count: number
}

/** Chain anchor: which upstream artifact this document was built from. */
export type UpstreamAnchor = {
  readonly pack: string
  readonly packVersion: string
  readonly artifactHash: string
}

export type Receipt = {
  readonly formatVersion: number
  readonly pack: string
  readonly packVersion: string
  readonly language: string
  readonly artifactHash: string
  readonly schemaHash: string
  /** Declarative rules JSON as-run; function rules contribute their source hash. */
  readonly rulesetSnapshot: { readonly declarative: Record<string, Json>[]; readonly functionsSourceHash: string }
  /** Chain anchors for consumed upstream artifacts ([] for root packs and revalidation). */
  readonly upstreamHashes: UpstreamAnchor[]
  readonly iterations: number
  readonly rounds: ReceiptRound[]
  readonly rules: ReceiptRuleResult[]
  readonly isValid: boolean
  /** Why the loop gave up; absent on green receipts (docs/designs/convergence-detection.md). */
  readonly terminationReason?: 'stagnation' | 'decline' | 'fingerprint-repeat' | 'max-iterations' | 'llm-error'
  readonly generatedAt: string
  readonly model: string
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Canonical JSON hashing: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    )
  }
  return value
}

export function artifactHashOf(artifact: unknown): string {
  return sha256(canonicalJson(artifact))
}
