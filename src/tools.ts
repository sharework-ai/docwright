import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_UPSTREAM_VERSION_POLICY, type Config, type UpstreamVersionPolicy } from './config.ts'
import { generateDocument, getDocService } from './doc-service.ts'
import { createLlmPort } from './llm-port.ts'
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
    throw new Error(`unknown pack "${name}" (available: ${[...deps.packs.keys()].sort().join(', ')})`)
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
    throw new Error('hanzeep config needs provider and model for doc_generate; set them in cordis.yml (cause: LLM route unset; fix: add provider+model to the hanzeep config block)')
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

export type ValidateToolResult = {
  readonly artifactPath: string
  readonly receipt: Receipt
  /** true: hash matches sidecar; false: artifact changed after generation; null: no sidecar receipt. */
  readonly hashMatches: boolean | null
  /** true: sidecar receipt records another pack version (stale — regenerate); false: versions match; null: no sidecar receipt. */
  readonly packVersionStale: boolean | null
}

export function defineDocGenerateTool(deps: ToolDeps) {
  return defineTool({
    name: 'doc_generate',
    description: 'Generate a structured document via the pack\'s closed loop (generate → validate → repair until green). '
      + 'Returns artifactPath, markdownPath, and the validation receipt. '
      + 'Materials are paths relative to the materials root (default <workspace>/references/) or inline text starting with "#!inline"; '
      + 'artifacts land under the output root (default <workspace>/output/).',
    parameters: {
      pack: { type: 'string', required: true, description: 'Pack name (e.g. cosmic-plan)' },
      materials: { type: 'array', required: true, items: { type: 'string' }, description: 'Material references: paths relative to the materials root (default references/ under the workspace) or #!inline text' },
      language: { type: 'string', description: 'Output language (default: config defaultLanguage)' },
      upstream: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths to upstream artifacts for chained packs; each must carry a green sidecar receipt (hash-verified, and recording the installed pack version unless config upstreamVersionPolicy is "warn")' },
      artifactName: { type: 'string', description: 'Output base name, plain [A-Za-z0-9._-] basename (default: <pack>-<timestamp>)' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: { pack: string; materials: unknown[]; language?: string; upstream?: unknown[]; artifactName?: string }, exec) {
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
      if (pack.manifest.consumes.length > 0) {
        if (upstream === undefined || upstream.length === 0) {
          throw new Error(`pack "${pack.manifest.name}" consumes upstream artifacts [${pack.manifest.consumes.join(', ')}]; pass their workspace paths via the upstream parameter`)
        }
        const policy = deps.config.upstreamVersionPolicy ?? DEFAULT_UPSTREAM_VERSION_POLICY
        const verified = await verifyUpstreamReceipts(workspaceRoot, upstream, pack, deps.packs, policy)
        upstreamTexts = verified.texts
        upstreamAnchors = verified.anchors
        upstreamWarnings = verified.warnings.length > 0 ? verified.warnings : undefined
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
        artifactName,
        workspaceRoot,
        outputRoot,
        config: deps.config,
        llm,
        signal: exec.signal,
        // Round data lives in the receipt returned with the tool result;
        // dedicated session events are tracked in TODOS.md.
        onRound: () => {},
      })
      return (upstreamWarnings === undefined ? result : { ...result, upstreamWarnings }) as unknown as GenerateToolResult
    },
  })
}

export function defineDocValidateTool(deps: ToolDeps) {
  return defineTool({
    name: 'doc_validate',
    description: 'Re-validate an existing document artifact against its pack ruleset and compare its hash with the sidecar receipt. '
      + 'Deterministic, no LLM. Returns a fresh receipt; hashMatches=false means the artifact changed after generation; hashMatches=null means no prior receipt exists. '
      + 'packVersionStale=true means the sidecar receipt was written by a different pack version — the artifact predates the installed pack and its green receipt certifies the OLD rules; regenerate it.',
    parameters: {
      artifactPath: { type: 'string', required: true, description: 'Workspace-relative path to the artifact JSON' },
      pack: { type: 'string', required: true, description: 'Pack name the artifact belongs to' },
      language: { type: 'string', description: 'Language whose ruleset to run; defaults to the receipt-recorded language, then config defaultLanguage' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: { artifactPath: string; pack: string; language?: string }, exec) {
      const pack = resolvePack(deps, args.pack)
      const workspaceRoot = effectiveWorkspaceRoot(exec as SessionWorkspaceCarrier | undefined, deps.config.workspaceRoot)
      const artifactPath = confinePath(workspaceRoot, args.artifactPath, 'artifactPath')
      const raw = await readFile(artifactPath, 'utf8')
      let artifact: unknown
      try {
        artifact = JSON.parse(raw)
      } catch (error) {
        throw new Error(`artifact ${args.artifactPath} is not valid JSON: ${(error as Error).message}; regenerate via doc_generate or fix the file`)
      }

      // Tamper evidence: compare the canonical hash against the sidecar
      // receipt written at generation time (absent for bundled samples).
      let storedReceipt: { artifactHash?: string; language?: string; packVersion?: string } | undefined
      let hashMatches: boolean | null = null
      try {
        const parsed: unknown = JSON.parse(await readFile(`${artifactPath.replace(/\.json$/, '')}.receipt.json`, 'utf8'))
        storedReceipt = typeof parsed === 'object' && parsed !== null ? parsed as { artifactHash?: string; language?: string; packVersion?: string } : undefined
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
      const issues = service.validate(artifact)
      const counts = severityCounts(issues)
      const isValid = counts.errors === 0
      const receipt = service.buildReceipt({
        artifact,
        isValid,
        unresolved: issues,
        iterations: 0,
        rounds: [{ round: 0, errorCount: counts.errors, warningCount: counts.warnings }],
        model: 'revalidate',
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
 * the stale upstream, `warn` proceeds and reports it.
 */
export async function verifyUpstreamReceipts(
  workspaceRoot: string,
  upstreamPaths: readonly string[],
  pack: Pack,
  packs: ReadonlyMap<string, Pack>,
  policy: UpstreamVersionPolicy,
): Promise<{ texts: string[]; anchors: UpstreamAnchor[]; warnings: string[] }> {
  const texts: string[] = []
  const anchors: UpstreamAnchor[] = []
  const warnings: string[] = []
  for (const ref of upstreamPaths) {
    const artifactPath = confinePath(workspaceRoot, ref, 'upstream')
    const receiptPath = `${artifactPath.replace(/\.json$/, '')}.receipt.json`
    let raw: string
    let stored: { pack?: string; packVersion?: string; artifactHash?: string; isValid?: boolean } | undefined
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
  }
  return { texts, anchors, warnings }
}
