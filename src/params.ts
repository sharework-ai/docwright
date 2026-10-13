import type { Pack, ParamSpec } from './pack.ts'
import { canonicalJson, type Json } from './receipt.ts'

/**
 * Effective pack params = declared defaults (or inherited upstream values),
 * overridden by call-time values. Declaration is the allowlist: unknown
 * override names and spec-violating values fail loud with problem + cause +
 * fix and the available list (docs/designs/dynamic-parameters.md).
 *
 * Resolution order per declared param: explicit call override > upstream
 * receipt base (chain inheritance) > declared default > required-missing
 * fail loud > optional params without default are omitted. Required params
 * declare no default — the value must come from the caller (ask the user)
 * or from the chain head's receipt.
 */
export function resolveEffectiveParams(
  pack: Pack,
  overrides: Readonly<Record<string, unknown>> | undefined,
  base?: Readonly<Record<string, unknown>> | undefined,
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

function assertValueMatches(spec: ParamSpec, name: string, value: unknown, packName: string, fromReceipt: boolean): void {
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

/** One row of the pendingConfirmation param table (docs/designs/params-and-chain-contract.md). */
export type ParamRow = {
  readonly name: string
  readonly type: string
  readonly value: Json
  /** Where the effective value came from: the call, the upstream receipt, the declared default, or nothing yet. */
  readonly source: 'explicit' | 'upstream' | 'default' | 'unset'
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
): ParamPreview {
  const rows: ParamRow[] = []
  const missingRequired: string[] = []
  const drift: ParamDrift[] = []
  for (const [name, spec] of Object.entries(pack.manifest.params ?? {})) {
    let value: Json | undefined
    let source: ParamRow['source']
    if (overrides !== undefined && overrides[name] !== undefined) {
      value = overrides[name] as Json
      source = 'explicit'
    } else if (base !== undefined && base[name] !== undefined) {
      value = base[name] as Json
      source = 'upstream'
    } else if (spec.default !== undefined) {
      value = spec.default as Json
      source = 'default'
    } else {
      value = undefined
      source = 'unset'
      if (spec.required === true) missingRequired.push(name)
    }
    if (source === 'explicit' && base !== undefined && base[name] !== undefined && canonicalJson(base[name]) !== canonicalJson(value)) {
      drift.push({ name, from: base[name] as Json, to: value as Json })
    }
    rows.push({ name, type: spec.type, value: value as Json, source, required: spec.required === true, confirm: spec.confirm === true, overridable: spec.overridable === true, description: spec.description })
  }
  return { rows, missingRequired, drift }
}
