import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_UPSTREAM_VERSION_POLICY, type Config, type UpstreamVersionPolicy } from './config.ts'
import { generateDocument, getDocService, parseUpstreamArtifacts } from './doc-service.ts'
import { createLlmPort } from './llm-port.ts'
import { previewParams, resolveEffectiveParams, type ParamDrift, type ParamRow } from './params.ts'
import type { Pack } from './pack.ts'
import { effectiveWorkspaceRoot, normalizeWindowsPath, resolveRootWithin, type SessionWorkspaceCarrier } from './paths.ts'
import { artifactHashOf, type Receipt, type UpstreamAnchor } from './receipt.ts'
import { severityCounts } from './issue.ts'

/**
 * Model-facing tools. `doc_generate` walks the closed loop; `doc_validate`
 * re-runs the pack ruleset over a stored artifact and compares its canonical
 * hash with the sidecar receipt — tamper-evident replay of the all-green
 * state. `hashMatches: null` means no sidecar receipt exists (e.g. the
 * bundled golden sample). Both tools surface pack-version staleness: a
 * receipt written by another pack version certifies the OLD ruleset, so
 * doc_validate flags it (`packVersionStale`) and chained consumption is
 * governed by the `upstreamVersionPolicy` config.
 */

export interface ToolDeps {
  readonly packs: ReadonlyMap<string, Pack>
  readonly config: Config
  readonly ctx: object & { llm?: unknown }
}

/** Normalize a model-supplied params bag; anything but a JSON object fails loud. */
function normalizeParams(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`params must be a JSON object of { name: value } (got ${Array.isArray(raw) ? 'an array' : typeof raw}; fix: pass declared param names as keys, e.g. {"cfpUpper": 45})`)
  }
  return raw as Record<string, unknown>
}

/** Resolve and lexically confine a user-supplied path to the workspace root. */
function confinePath(workspaceRoot: string, ref: string, what: string): string {
  const root = resolve(workspaceRoot)
  const abs = resolve(root, normalizeWindowsPath(ref))
  const rel = relative(root, abs)
  if (rel === '..' || rel.startsWith('../')) {
    throw new Error(`${what} path escapes the workspace root: ${ref} (root: ${root})`)
  }
  return abs
}

function resolvePack(deps: ToolDeps, name: string): Pack {
  const pack = deps.packs.get(name)
  if (pack === undefined) {
    throw new Error(`unknown pack "${name}"; discover installed packs via doc_packs (available: ${[...deps.packs.keys()].sort().join(', ')})`)
  }
  return pack
}

function resolveLanguage(deps: ToolDeps, pack: Pack, language?: string): string {
  const configured = deps.config.defaultLanguage
  const chosen = language !== undefined && language.length > 0
    ? language
    : configured !== undefined && configured.length > 0 ? configured : ''
  const final = chosen.length > 0 ? chosen : pack.manifest.languages[0] ?? ''
  if (final.length === 0) throw new Error('no language available: set the tool language or config defaultLanguage')
  if (!pack.manifest.languages.includes(final)) {
    throw new Error(`pack "${pack.manifest.name}" does not support language "${final}" (supported: ${pack.manifest.languages.join(', ')})`)
  }
  return final
}

function requireRoute(deps: ToolDeps): { provider: string; model: string } {
  const { provider, model } = deps.config
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new Error('docwright config needs provider and model for doc_generate; set them in cordis.yml (cause: LLM route unset; fix: add provider+model to the docwright config block)')
  }
  return { provider, model }
}

export type GenerateToolResult = {
  readonly artifactPath: string
  readonly markdownPath: string
  readonly receipt: Receipt
  /** Present under upstreamVersionPolicy: "warn" when an upstream receipt records a different pack version. */
  readonly upstreamWarnings?: string[]
}

/**
 * Confirmation gate result (docs/designs/params-and-chain-contract.md): the
 * effective param table to present to the user before executing. Zero LLM
 * cost — the call is refused before any route/model work until the caller
 * re-invokes with confirm: true.
 */
export type PendingConfirmationResult = {
  readonly pendingConfirmation: true
  readonly pack: string
  readonly language: string
  readonly paramTable: ParamRow[]
  readonly missingRequired: string[]
  readonly paramDrift?: ParamDrift[]
  readonly driftImpact?: string
  readonly hint: string
}

/** doc_generate returns either the generation result or the confirmation gate. */
export type DocGenerateResult = GenerateToolResult | PendingConfirmationResult

export type ValidateToolResult = {
  readonly artifactPath: string
  readonly receipt: Receipt
  /** true: hash matches sidecar; false: artifact changed after generation; null: no sidecar receipt. */
  readonly hashMatches: boolean | null
  /** true: sidecar receipt records another pack version (stale — regenerate); false: versions match; null: no sidecar receipt. */
  readonly packVersionStale: boolean | null
}

/**
 * Pull-based capability discovery: the model calls this before doc_generate
 * to learn which packs are installed and pick the right one. Tool descriptions
 * stay static — the registry lives here, not in copy (docs/designs/capability-discovery.md).
 */
export function defineDocPacksTool(deps: ToolDeps) {
  return defineTool({
    name: 'doc_packs',
    description: 'List installed document packs: name, one-line description, supported languages, and consumed upstream types. '
      + 'Call this before doc_generate to pick the right pack for the document the user wants.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return [...deps.packs.values()].map(p => ({
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        languages: [...p.manifest.languages],
        consumes: [...p.manifest.consumes],
        params: Object.entries(p.manifest.params ?? {}).map(([name, spec]) => ({
          name,
          type: spec.type,
          description: spec.description,
          ...(spec.default !== undefined ? { default: spec.default } : {}),
          required: spec.required === true,
          confirm: spec.confirm === true,
          overridable: spec.overridable === true,
        })),
      }))
    },
  })
}

/** Merged inheritance base from the upstream receipts' as-run params. */
function mergeUpstreamParams(records: readonly { params: Record<string, unknown> | undefined }[]): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {}
  for (const record of records) {
    if (record.params !== undefined) Object.assign(merged, record.params)
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function shortValue(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/**
 * Deterministic revalidation of the upstream artifacts under drifted param
 * values (paramDriftPolicy "revalidate"): each upstream artifact is checked
 * by its OWN pack service with the drifted values intersected to that pack's
 * declared params. Returns human-readable failures; [] means all green.
 */
function revalidateUpstreamUnderParams(
  records: readonly { pack: string; language: string | undefined; params: Record<string, unknown> | undefined; artifact: unknown }[],
  packs: ReadonlyMap<string, Pack>,
  overrides: Readonly<Record<string, unknown>>,
): string[] {
  const failures: string[] = []
  for (const record of records) {
    // verifyUpstreamReceipts already rejected records whose pack is not installed.
    const upstreamPack = packs.get(record.pack)!
    const declared = Object.keys(upstreamPack.manifest.params ?? {})
    const picked = Object.fromEntries(Object.entries(overrides).filter(([name]) => declared.includes(name)))
    let effective: Record<string, unknown>
    try {
      // Drifted values on top of the receipt-recorded as-run params: the
      // artifact is re-checked under the chain's own baseline plus the drift.
      effective = resolveEffectiveParams(upstreamPack, picked, record.params)
    } catch (error) {
      failures.push(`${record.pack}: ${(error as Error).message}`)
      continue
    }
    const language = record.language !== undefined && upstreamPack.manifest.languages.includes(record.language)
      ? record.language
      : upstreamPack.manifest.languages[0]!
    const issues = getDocService(upstreamPack, language).validate(record.artifact, effective, undefined)
    const errorRules = [...new Set(issues.filter(i => i.severity === 'error').map(i => i.ruleId))]
    if (errorRules.length > 0) failures.push(`${record.pack}: ${errorRules.join(', ')}`)
  }
  return failures
}

const CONFIRM_HINT = 'Present the paramTable to the user (values, sources, missing required entries, drift impact); then re-call with the same arguments plus confirm: true to execute.'

export function defineDocGenerateTool(deps: ToolDeps) {
  return defineTool({
    name: 'doc_generate',
    description: 'Generate a structured document via the pack\'s closed loop (generate → validate → repair until green). '
      + 'Call doc_packs first to see which packs are installed, then pass its name as pack. '
      + 'Returns artifactPath, markdownPath, and the validation receipt. '
      + 'Materials are paths relative to the materials root (default <workspace>/references/) or inline text starting with "#!inline"; '
      + 'if the workspace references/ folder holds project-context material (system architecture, module map, numbering conventions), include it. '
      + 'Artifacts land under the output root (default <workspace>/output/). '
      + 'Pack-declared tunables can be overridden via params; required params (no default) must be provided. '
      + 'Passing params — or generating a pack with confirm-flagged params whose values are not yet confirmed upstream — returns a pendingConfirmation param table first: present it to the user, then re-call with confirm: true. '
      + 'maxRounds caps this call\'s loop rounds.',
    parameters: {
      pack: { type: 'string', required: true, description: 'Pack name; discover installed packs with doc_packs (e.g. cosmic-plan)' },
      materials: { type: 'array', required: true, items: { type: 'string' }, description: 'Material references: paths relative to the materials root (default references/ under the workspace) or #!inline text' },
      language: { type: 'string', description: 'Output language (default: config defaultLanguage)' },
      upstream: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths to upstream artifacts for chained packs; each must carry a green sidecar receipt (hash-verified, and recording the installed pack version unless config upstreamVersionPolicy is "warn")' },
      artifactName: { type: 'string', description: 'Output base name, plain [A-Za-z0-9._-] basename (default: <pack>-<timestamp>)' },
      maxRounds: { type: 'number', description: 'Round cap for this call (e.g. when the user asks to try more rounds); clamped to config maxRoundsCeiling' },
      params: { type: 'json', description: 'Overrides for pack-declared tunables (discovered via doc_packs), e.g. {"cfpTotal": {"value": 100, "downFactor": 0.9, "upFactor": 1.2}}; unknown names, out-of-range values, and missing required params fail loud; explicit params always trigger the confirmation gate' },
      confirm: { type: 'boolean', description: 'Execute after the pendingConfirmation param table was presented to and approved by the user' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: { pack: string; materials: unknown[]; language?: string; upstream?: unknown[]; artifactName?: string; maxRounds?: number; params?: unknown; confirm?: boolean }, exec) {
      const pack = resolvePack(deps, args.pack)
      const language = resolveLanguage(deps, pack, args.language)
      const materials = args.materials as string[]
      const upstream = args.upstream as string[] | undefined
      const workspaceRoot = effectiveWorkspaceRoot(exec as SessionWorkspaceCarrier | undefined, deps.config.workspaceRoot)
      const materialsRoot = resolveRootWithin(workspaceRoot, deps.config.materialsRoot, 'materialsRoot')
      const outputRoot = resolveRootWithin(workspaceRoot, deps.config.outputRoot, 'outputRoot')
      let upstreamTexts: string[] | undefined
      let upstreamAnchors: UpstreamAnchor[] | undefined
      let upstreamWarnings: readonly string[] | undefined
      let upstreamRecords: readonly { pack: string; language: string | undefined; params: Record<string, unknown> | undefined; artifact: unknown }[] = []
      if (pack.manifest.consumes.length > 0) {
        if (upstream === undefined || upstream.length === 0) {
          throw new Error(`pack "${pack.manifest.name}" consumes upstream artifacts [${pack.manifest.consumes.join(', ')}]; pass their workspace paths via the upstream parameter`)
        }
        const policy = deps.config.upstreamVersionPolicy ?? DEFAULT_UPSTREAM_VERSION_POLICY
        const verified = await verifyUpstreamReceipts(workspaceRoot, upstream, pack, deps.packs, policy)
        upstreamTexts = verified.texts
        upstreamAnchors = verified.anchors
        upstreamWarnings = verified.warnings.length > 0 ? verified.warnings : undefined
        upstreamRecords = verified.records
      }
      // Confirmation gate (docs/designs/params-and-chain-contract.md): zero
      // LLM cost — resolved before the route check. Explicit params always
      // gate; confirm-flagged params gate until confirmed at the chain head,
      // after which downstream stages inherit the recorded values.
      const overrides = normalizeParams(args.params)
      const paramsProvided = overrides !== undefined && Object.keys(overrides).length > 0
      const paramsBase = mergeUpstreamParams(upstreamRecords)
      const preview = previewParams(pack, overrides, paramsBase)
      const confirmNames = Object.entries(pack.manifest.params ?? {}).filter(([, spec]) => spec.confirm === true).map(([name]) => name)
      const satisfiedUpstream = confirmNames.length > 0 && paramsBase !== undefined && confirmNames.every(name => paramsBase[name] !== undefined)
      if ((paramsProvided || (confirmNames.length > 0 && !satisfiedUpstream)) && args.confirm !== true) {
        let driftImpact: string | undefined
        if (preview.drift.length > 0) {
          const policy = pack.manifest.paramDriftPolicy ?? 'regenerate'
          if (policy === 'regenerate') {
            driftImpact = `paramDriftPolicy is "regenerate": confirming these params requires regenerating the upstream artifacts first; the call will be refused until then.`
          } else {
            const failures = revalidateUpstreamUnderParams(upstreamRecords, deps.packs, overrides ?? {})
            driftImpact = failures.length === 0
              ? 'paramDriftPolicy is "revalidate": upstream artifacts revalidated green under the new params; safe to continue.'
              : `paramDriftPolicy is "revalidate": upstream artifacts fail under the new params (${failures.join('; ')}); the call will be refused.`
          }
        }
        const driftFields = preview.drift.length > 0
          ? { paramDrift: [...preview.drift], ...(driftImpact === undefined ? {} : { driftImpact }) }
          : {}
        return {
          pendingConfirmation: true,
          pack: pack.manifest.name,
          language,
          paramTable: [...preview.rows],
          missingRequired: [...preview.missingRequired],
          ...driftFields,
          hint: CONFIRM_HINT,
        } satisfies PendingConfirmationResult as unknown as DocGenerateResult
      }
      if (preview.missingRequired.length > 0) {
        throw new Error(`missing required pack params for "${pack.manifest.name}": ${preview.missingRequired.join(', ')} (declared without defaults; cause: these values must come from the caller; fix: ask the user for the value(s) and pass them via params)`)
      }
      if (preview.drift.length > 0) {
        const policy = pack.manifest.paramDriftPolicy ?? 'regenerate'
        if (policy === 'regenerate') {
          const detail = preview.drift.map(d => `${d.name}: ${shortValue(d.from)} → ${shortValue(d.to)}`).join('; ')
          throw new Error(`params drift from the upstream receipts (${detail}); pack "${pack.manifest.name}" paramDriftPolicy is "regenerate" — regenerate the upstream artifacts under the new params first, then re-run this call`)
        }
        const failures = revalidateUpstreamUnderParams(upstreamRecords, deps.packs, overrides ?? {})
        if (failures.length > 0) {
          throw new Error(`upstream artifacts fail validation under the new params (${failures.join('; ')}); pack "${pack.manifest.name}" paramDriftPolicy is "revalidate" — regenerate the upstream under the new params or revert the param change`)
        }
      }
      const route = requireRoute(deps)
      const llm = createLlmPort(deps.ctx as never, route)
      const artifactName = args.artifactName ?? `${pack.manifest.name}-${Date.now()}`
      const result = await generateDocument({
        pack,
        language,
        materials,
        materialsRoot,
        upstream: upstreamTexts,
        upstreamAnchors,
        maxRounds: args.maxRounds,
        params: overrides,
        paramsBase,
        artifactName,
        workspaceRoot,
        outputRoot,
        config: deps.config,
        llm,
        signal: exec.signal,
        // Round data (incl. per-round prompt hash) lives in the receipt, which
        // rides the tool result content into the session log verbatim. A
        // dedicated session event type stays deferred: dsh has no write-side
        // knob to mark plugin event types ignorable (see TODOS.md).
        onRound: () => {},
      })
      return (upstreamWarnings === undefined ? result : { ...result, upstreamWarnings }) as unknown as DocGenerateResult
    },
  })
}

export function defineDocValidateTool(deps: ToolDeps) {
  return defineTool({
    name: 'doc_validate',
    description: 'Re-validate an existing document artifact against its pack ruleset and compare its hash with the sidecar receipt. '
      + 'Deterministic, no LLM. Call doc_packs to see which packs are installed. '
      + 'Returns a fresh receipt; hashMatches=false means the artifact changed after generation; hashMatches=null means no prior receipt exists. '
      + 'packVersionStale=true means the sidecar receipt was written by a different pack version — the artifact predates the installed pack and its green receipt certifies the OLD rules; regenerate it.',
    parameters: {
      artifactPath: { type: 'string', required: true, description: 'Workspace-relative path to the artifact JSON' },
      pack: { type: 'string', required: true, description: 'Pack name the artifact belongs to' },
      language: { type: 'string', description: 'Language whose ruleset to run; defaults to the receipt-recorded language, then config defaultLanguage' },
      params: { type: 'json', description: 'Optional pack-param overrides; defaults to the receipt-recorded as-run params (revalidate by the original standards)' },
      upstream: { type: 'array', items: { type: 'string' }, description: 'For chained packs: workspace-relative paths to the same upstream artifacts used at generation (green-receipt verified); required to replay chained-pack rules like plan-alignment checks' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: { artifactPath: string; pack: string; language?: string; params?: unknown; upstream?: unknown[] }, exec) {
      const pack = resolvePack(deps, args.pack)
      const workspaceRoot = effectiveWorkspaceRoot(exec as SessionWorkspaceCarrier | undefined, deps.config.workspaceRoot)
      const artifactPath = confinePath(workspaceRoot, args.artifactPath, 'artifactPath')
      const upstreamRefs = args.upstream as string[] | undefined
      const verifiedUpstream = upstreamRefs !== undefined && upstreamRefs.length > 0 && pack.manifest.consumes.length > 0
        ? await verifyUpstreamReceipts(workspaceRoot, upstreamRefs, pack, deps.packs, deps.config.upstreamVersionPolicy ?? DEFAULT_UPSTREAM_VERSION_POLICY)
        : undefined
      const raw = await readFile(artifactPath, 'utf8')
      let artifact: unknown
      try {
        artifact = JSON.parse(raw)
      } catch (error) {
        throw new Error(`artifact ${args.artifactPath} is not valid JSON: ${(error as Error).message}; regenerate via doc_generate or fix the file`)
      }

      // Tamper evidence: compare the canonical hash against the sidecar
      // receipt written at generation time (absent for bundled samples).
      let storedReceipt: { artifactHash?: string; language?: string; packVersion?: string; params?: Record<string, unknown> } | undefined
      let hashMatches: boolean | null = null
      try {
        const parsed: unknown = JSON.parse(await readFile(`${artifactPath.replace(/\.json$/, '')}.receipt.json`, 'utf8'))
        storedReceipt = typeof parsed === 'object' && parsed !== null ? parsed as { artifactHash?: string; language?: string; packVersion?: string; params?: Record<string, unknown> } : undefined
        hashMatches = storedReceipt?.artifactHash === artifactHashOf(artifact)
      } catch {
        storedReceipt = undefined
      }

      // Staleness: a receipt from another pack version certifies the OLD
      // ruleset — green under it does not mean compliant with the installed
      // pack. Receipts without a recorded version count as stale.
      const packVersionStale: boolean | null = storedReceipt === undefined
        ? null
        : (storedReceipt.packVersion ?? '') !== pack.manifest.version

      // Language: explicit param (must match the recorded one) > receipt-recorded > config default > pack first.
      const recorded = storedReceipt?.language
      if (args.language !== undefined && args.language.length > 0 && recorded !== undefined && args.language !== recorded) {
        throw new Error(`language "${args.language}" does not match the receipt-recorded language "${recorded}"; omit the parameter to revalidate as recorded`)
      }
      const language = args.language !== undefined && args.language.length > 0
        ? args.language
        : recorded !== undefined && recorded.length > 0 ? recorded! : undefined
      const resolvedLang = resolveLanguage(deps, pack, language)

      const service = getDocService(pack, resolvedLang)
      // Replay by the receipt-recorded as-run params (original standards);
      // explicit args.params override them for what-if validation.
      const receiptParams = storedReceipt?.params !== undefined && typeof storedReceipt.params === 'object'
        ? storedReceipt.params as Record<string, unknown>
        : undefined
      const effectiveParams = resolveEffectiveParams(pack, normalizeParams(args.params), receiptParams)
      // Chained replay: verified upstream artifacts feed rules like plan-alignment.
      const upstreamArtifacts = parseUpstreamArtifacts(verifiedUpstream?.texts)
      const ruleContext = upstreamArtifacts === undefined ? undefined : { upstream: upstreamArtifacts }
      const issues = service.validate(artifact, effectiveParams, ruleContext)
      const counts = severityCounts(issues)
      const isValid = counts.errors === 0
      const receipt = service.buildReceipt({
        artifact,
        isValid,
        unresolved: issues,
        iterations: 0,
        rounds: [{ round: 0, errorCount: counts.errors, warningCount: counts.warnings }],
        model: 'revalidate',
        ...(verifiedUpstream !== undefined ? { upstream: verifiedUpstream.anchors } : {}),
        ...(Object.keys(effectiveParams).length > 0 ? { params: effectiveParams } : {}),
      })
      return { artifactPath, receipt, hashMatches, packVersionStale } as unknown as ValidateToolResult
    },
  })
}

/**
 * Chain integrity: each upstream reference is a workspace path whose artifact
 * must carry a GREEN sidecar receipt with a matching canonical hash and a
 * pack type the consumer declares in `consumes`. Red drafts, tampered
 * artifacts, and wrong-type documents never feed downstream packs. A receipt
 * recording another pack version certifies the OLD ruleset: `strict` rejects
 * the stale upstream, `warn` proceeds and reports it. Records additionally
 * carry each receipt's language and as-run params — the inheritance base for
 * chain-shared params (docs/designs/params-and-chain-contract.md).
 */
export interface UpstreamRecord {
  readonly pack: string
  readonly packVersion: string
  readonly artifactHash: string
  readonly language: string | undefined
  readonly params: Record<string, unknown> | undefined
  readonly artifact: unknown
}

export async function verifyUpstreamReceipts(
  workspaceRoot: string,
  upstreamPaths: readonly string[],
  pack: Pack,
  packs: ReadonlyMap<string, Pack>,
  policy: UpstreamVersionPolicy,
): Promise<{ texts: string[]; anchors: UpstreamAnchor[]; warnings: string[]; records: UpstreamRecord[] }> {
  const texts: string[] = []
  const anchors: UpstreamAnchor[] = []
  const warnings: string[] = []
  const records: UpstreamRecord[] = []
  for (const ref of upstreamPaths) {
    const artifactPath = confinePath(workspaceRoot, ref, 'upstream')
    const receiptPath = `${artifactPath.replace(/\.json$/, '')}.receipt.json`
    let raw: string
    let stored: { pack?: string; packVersion?: string; artifactHash?: string; isValid?: boolean; language?: string; params?: Record<string, unknown> } | undefined
    try {
      raw = await readFile(artifactPath, 'utf8')
    } catch (error) {
      throw new Error(`upstream artifact not readable: ${ref} (${(error as Error).message})`)
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(receiptPath, 'utf8'))
      stored = typeof parsed === 'object' && parsed !== null ? parsed as typeof stored : undefined
    } catch {
      stored = undefined
    }
    if (stored === undefined) {
      throw new Error(`upstream artifact ${ref} has no sidecar receipt; generate it with doc_generate first (cause: chain integrity requires a green receipt; fix: run doc_generate on the upstream pack)`)
    }
    if (stored.isValid !== true) {
      throw new Error(`upstream artifact ${ref} has a RED receipt; red drafts must never feed downstream packs (fix: repair or regenerate the upstream document until green)`)
    }
    let artifact: unknown
    try {
      artifact = JSON.parse(raw)
    } catch {
      throw new Error(`upstream artifact ${ref} is not valid JSON`)
    }
    if (stored.artifactHash !== artifactHashOf(artifact)) {
      throw new Error(`upstream artifact ${ref} was modified after generation (hash mismatch vs receipt); regenerate it before consuming`)
    }
    if (stored.pack === undefined || !pack.manifest.consumes.includes(stored.pack)) {
      throw new Error(`upstream artifact ${ref} is of pack "${stored.pack ?? 'unknown'}" but "${pack.manifest.name}" consumes [${pack.manifest.consumes.join(', ')}]`)
    }
    // Version staleness is judged against the INSTALLED version of the
    // upstream pack (version lines are independent per pack): a receipt from
    // an older upstream version certifies the OLD ruleset.
    const upstreamPack = packs.get(stored.pack)
    if (upstreamPack === undefined) {
      throw new Error(`upstream artifact ${ref} is of pack "${stored.pack}" but no such pack is installed (fix: install the pack or correct the consumer's consumes list)`)
    }
    const upstreamVersion = stored.packVersion ?? 'unknown'
    if (upstreamVersion !== upstreamPack.manifest.version) {
      const detail = `upstream artifact ${ref} was generated by "${stored.pack}" v${upstreamVersion} but the installed pack is v${upstreamPack.manifest.version}; its green receipt does not certify the current pack rules`
      if (policy === 'strict') {
        throw new Error(`${detail} (fix: regenerate the upstream via doc_generate, or set config upstreamVersionPolicy: "warn" to allow stale upstreams)`)
      }
      warnings.push(detail)
    }
    texts.push(JSON.stringify(artifact))
    anchors.push({ pack: stored.pack, packVersion: stored.packVersion ?? 'unknown', artifactHash: stored.artifactHash ?? '' })
    records.push({
      pack: stored.pack,
      packVersion: stored.packVersion ?? 'unknown',
      artifactHash: stored.artifactHash ?? '',
      language: typeof stored.language === 'string' && stored.language.length > 0 ? stored.language : undefined,
      params: typeof stored.params === 'object' && stored.params !== null ? stored.params as Record<string, unknown> : undefined,
      artifact,
    })
  }
  return { texts, anchors, warnings, records }
}
