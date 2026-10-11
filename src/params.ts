import type { Pack, ParamSpec } from './pack.ts'

/**
 * Effective pack params = declared defaults, optionally seeded from a base
 * (the receipt-recorded as-run params on revalidation), overridden by
 * call-time values. Declaration is the allowlist: unknown override names and
 * spec-violating values fail loud with problem + cause + fix and the
 * available list (docs/designs/dynamic-parameters.md).
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
    const seeded = base !== undefined && base[name] !== undefined ? base[name] : spec.default
    assertValueMatches(spec, name, seeded, pack.manifest.name, base !== undefined && base[name] !== undefined)
    effective[name] = seeded
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
    : typeof value === spec.type
  if (!typeOk) {
    throw new Error(`${where} must be a ${spec.type} (got ${typeof value === 'string' ? JSON.stringify(value) : String(value)}; fix: pass a ${spec.type} value or omit it to use the declared default)`)
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
