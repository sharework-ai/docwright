import type { Pack, ParamSpec } from './pack.ts'
import { canonicalJson, type Json } from './receipt.ts'

/**
 * Effective pack params = declared defaults (or inherited upstream values),
 * overridden by call-time values. Declaration is the allowlist: unknown
 * override names and spec-violating values fail loud with problem + cause +
 * fix and the available list (docs/designs/dynamic-parameters.md).
 *
 * Resolution order per declared param: explicit call override > upstream
 * receipt base (chain inheritance) > extracted value (doc_extract_params,
 * quote-verified against the call's materials) > declared default >
 * required-missing fail loud > optional params without default are omitted.
 * Required params declare no default — the value must come from the caller
 * (ask the user), the chain head's receipt, or a proven extraction.
 */
export function resolveEffectiveParams(
  pack: Pack,
  overrides: Readonly<Record<string, unknown>> | undefined,
  base?: Readonly<Record<string, unknown>> | undefined,
  extracted?: ExtractionView | undefined,
): Record<string, unknown> {
  const declared = pack.manifest.params ?? {}
  const names = Object.keys(declared).sort()
  const effective: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(declared)) {
    if (overrides !== undefined && overrides[name] !== undefined) {
      assertValueMatches(spec, name, overrides[name], pack.manifest.name, false)
      effective[name] = overrides[name]
      continue
    }
    if (base !== undefined && base[name] !== undefined) {
      assertValueMatches(spec, name, base[name], pack.manifest.name, true)
      effective[name] = base[name]
      continue
    }
    const extractedValue = extracted?.values[name]
    if (extractedValue !== undefined) {
      assertValueMatches(spec, name, extractedValue.value, pack.manifest.name, false)
      effective[name] = extractedValue.value
      continue
    }
    if (spec.default !== undefined) {
      assertValueMatches(spec, name, spec.default, pack.manifest.name, false)
      effective[name] = spec.default
      continue
    }
    if (spec.required === true) {
      throw new Error(`missing required pack param "${name}" for pack "${pack.manifest.name}" (declared without a default; cause: this value must come from the caller; fix: ask the user for the value and pass it via params, e.g. {"${name}": ...})`)
    }
    // Optional without default: stays unset — the receipt simply omits it.
  }
  if (overrides !== undefined) {
    for (const [name, value] of Object.entries(overrides)) {
      const spec: ParamSpec | undefined = declared[name]
      if (spec === undefined) {
        throw new Error(`unknown pack param "${name}" for pack "${pack.manifest.name}" (available: ${names.length > 0 ? names.join(', ') : 'none declared'}; cause: params must be declared in the pack manifest; fix: use a declared param or extend manifest.params)`)
      }
      assertValueMatches(spec, name, value, pack.manifest.name, false)
      effective[name] = value
    }
  }
  return effective
}

/** Shared value validation for every resolution tier (explicit / receipt / extracted / default). */
export function assertValueMatches(spec: ParamSpec, name: string, value: unknown, packName: string, fromReceipt: boolean): void {
  const where = `pack "${packName}" param "${name}"${fromReceipt ? ' (receipt-recorded)' : ''}`
  const typeOk = spec.type === 'number'
    ? typeof value === 'number' && Number.isFinite(value)
    : spec.type === 'object'
      ? typeof value === 'object' && value !== null && !Array.isArray(value)
      : typeof value === spec.type
  if (!typeOk) {
    const article = spec.type === 'object' ? 'an' : 'a'
    throw new Error(`${where} must be ${article} ${spec.type} (got ${describeValue(value)}; fix: pass a ${spec.type} value or omit it to use the declared default)`)
  }
  if (spec.enum !== undefined && !spec.enum.includes(value as never)) {
    throw new Error(`${where} must be one of [${spec.enum.map(v => JSON.stringify(v)).join(', ')}]`)
  }
  if (spec.type === 'number') {
    const n = value as number
    if (spec.min !== undefined && n < spec.min) throw new Error(`${where} must be >= ${spec.min}`)
    if (spec.max !== undefined && n > spec.max) throw new Error(`${where} must be <= ${spec.max}`)
  }
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/** A quote-verified extracted value (the engine re-checks the quote against the call's materials). */
export interface ExtractedParamValue {
  readonly value: Json
  /** Verbatim material excerpt proving the value (whitespace-normalized containment). */
  readonly quote: string
  /** Canonical ref of the material the quote was found in. */
  readonly ref: string
}

/** A "not found" extraction outcome; a suggestion is model-proposed and never auto-applied — endorsement goes through explicit params. */
export interface ExtractionNotFound {
  readonly suggestion?: Json
  readonly rationale?: string
}

/**
 * Extraction tier handed to resolution and preview, already re-verified
 * against the CURRENT call's materials (changed materials invalidate
 * unproven entries — docs/designs/params-and-chain-contract.md).
 */
export interface ExtractionView {
  readonly values: Readonly<Record<string, ExtractedParamValue>>
  readonly notFound: Readonly<Record<string, ExtractionNotFound>>
}

/** One row of the pendingConfirmation param table (docs/designs/params-and-chain-contract.md). */
export type ParamRow = {
  readonly name: string
  readonly type: string
  /**
   * Effective value; omitted while `source` is "unset". An explicitly
   * `undefined` property is not lossless JSON, and the gate result rides the
   * dsh tool-output snapshot verbatim — one such property poisons the whole
   * result (INVALID_TOOL_OUTPUT before the model ever sees the table).
   */
  readonly value?: Json
  /** Where the effective value came from: the call, the upstream receipt, a proven extraction, the declared default, or nothing yet. */
  readonly source: 'explicit' | 'upstream' | 'extracted' | 'default' | 'unset'
  /** Present when source is "extracted": the verbatim material excerpt proving the value. */
  readonly quote?: string
  /** Present when source is "extracted": the canonical material ref the quote was found in. */
  readonly extractionRef?: string
  /** Present on an unset row whose extraction reported notFound with a model-proposed suggestion (endorse = pass it via params). */
  readonly suggestion?: Json
  readonly suggestionRationale?: string
  readonly required: boolean
  readonly confirm: boolean
  readonly overridable: boolean
  readonly description: string
}

/** Call-time params that differ (canonical JSON) from the upstream-recorded values. */
export type ParamDrift = {
  readonly name: string
  readonly from: Json
  readonly to: Json
}

export type ParamPreview = {
  readonly rows: readonly ParamRow[]
  readonly missingRequired: readonly string[]
  readonly drift: readonly ParamDrift[]
}

/**
 * Non-throwing resolution view for the confirmation gate: the table the
 * agent presents to the user, the required params still missing, and any
 * drift of explicit params against the upstream-recorded values.
 */
export function previewParams(
  pack: Pack,
  overrides: Readonly<Record<string, unknown>> | undefined,
  base?: Readonly<Record<string, unknown>> | undefined,
  extracted?: ExtractionView | undefined,
): ParamPreview {
  const rows: ParamRow[] = []
  const missingRequired: string[] = []
  const drift: ParamDrift[] = []
  for (const [name, spec] of Object.entries(pack.manifest.params ?? {})) {
    let value: Json | undefined
    let source: ParamRow['source']
    let quote: string | undefined
    let extractionRef: string | undefined
    if (overrides !== undefined && overrides[name] !== undefined) {
      value = overrides[name] as Json
      source = 'explicit'
    } else if (base !== undefined && base[name] !== undefined) {
      value = base[name] as Json
      source = 'upstream'
    } else if (extracted?.values[name] !== undefined) {
      const v = extracted.values[name]!
      value = v.value
      source = 'extracted'
      quote = v.quote
      extractionRef = v.ref
    } else if (spec.default !== undefined) {
      value = spec.default as Json
      source = 'default'
    } else {
      value = undefined
      source = 'unset'
      if (spec.required === true) missingRequired.push(name)
    }
    // Only explicit values can drift against the receipt base: extracted
    // values sit BELOW the base in the resolution order and never take
    // effect when the base records the param.
    if (source === 'explicit' && base !== undefined && base[name] !== undefined && canonicalJson(base[name]) !== canonicalJson(value)) {
      drift.push({ name, from: base[name] as Json, to: value as Json })
    }
    const notFound = source === 'unset' ? extracted?.notFound[name] : undefined
    rows.push({
      name, type: spec.type,
      ...(value === undefined ? {} : { value: value as Json }),
      source,
      ...(quote === undefined ? {} : { quote }),
      ...(extractionRef === undefined ? {} : { extractionRef }),
      ...(notFound?.suggestion === undefined ? {} : { suggestion: notFound.suggestion }),
      ...(notFound?.rationale === undefined ? {} : { suggestionRationale: notFound.rationale }),
      required: spec.required === true, confirm: spec.confirm === true, overridable: spec.overridable === true, description: spec.description,
    })
  }
  return { rows, missingRequired, drift }
}
