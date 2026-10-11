import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_ROUNDS_CEILING, DEFAULT_PROMPT_TOKEN_BUDGET, type Config } from './config.ts'
import { createScoring } from './convergence.ts'
import type { Issue } from './issue.ts'
import type { LlmPort } from './llm-port.ts'
import { runRepairLoop } from './loop.ts'
import type { Pack } from './pack.ts'
import { resolveEffectiveParams } from './params.ts'
import { createRuleEngine, rollupRules } from './rule-engine.ts'
import { readMaterials } from './materials.ts'
import { assembleGeneratorPrompt, estimateTokens } from './prompt.ts'
import { createSchemaCheck } from './schema-check.ts'
import { artifactHashOf, RECEIPT_FORMAT_VERSION, sha256, type Json, type Receipt, type UpstreamAnchor } from './receipt.ts'
import { createRenderer } from './render.ts'

/**
 * Pack-scoped doc service shared by the two tools. Instances are cached per
 * (pack, language) so ajv/rule/handlebars compilation happens once per
 * plugin lifetime, not per tool call.
 */
export class DocService {
  private readonly schemaCheck: (artifact: unknown) => readonly Issue[]
  private readonly ruleEngine: (artifact: unknown, params?: Readonly<Record<string, unknown>> | undefined) => readonly Issue[]
  readonly renderer: (artifact: unknown) => string
  readonly promptTemplate: string
  private readonly schemaHash: string

  constructor(
    readonly pack: Pack,
    readonly language: string,
  ) {
    if (!pack.manifest.languages.includes(language)) {
      throw new Error(`pack "${pack.manifest.name}" does not support language "${language}" (supported: ${pack.manifest.languages.join(', ')})`)
    }
    this.promptTemplate = pack.prompts.get(language) ?? ''
    this.schemaCheck = createSchemaCheck(pack.schema, `pack "${pack.manifest.name}"`)
    this.ruleEngine = createRuleEngine(pack, language)
    this.renderer = createRenderer(pack.templates.get(language) ?? '', `pack "${pack.manifest.name}" ${language} template`)
    this.schemaHash = sha256(JSON.stringify(pack.schema))
  }

  validate(artifact: unknown, params?: Readonly<Record<string, unknown>> | undefined): readonly Issue[] {
    return [...this.schemaCheck(artifact), ...this.ruleEngine(artifact, params)]
  }

  rulesetSnapshot(): Receipt['rulesetSnapshot'] {
    return {
      declarative: (this.pack.rules.get(this.language) ?? []) as unknown as Record<string, Json>[],
      functionsSourceHash: this.pack.functionsSourceHash,
    }
  }

  rollup(issues: readonly Issue[]): Receipt['rules'] {
    return rollupRules(this.pack, this.language, issues)
  }

  /**
   * Single receipt constructor for generate and revalidate, so the two
   * receipt flavors can never drift apart.
   */
  buildReceipt(input: {
    artifact: unknown
    isValid: boolean
    unresolved: readonly Issue[]
    iterations: number
    rounds: Receipt['rounds']
    model: string
    upstream?: readonly UpstreamAnchor[] | undefined
    terminationReason?: Receipt['terminationReason'] | undefined
    params?: Readonly<Record<string, unknown>> | undefined
  }): Receipt {
    return {
      formatVersion: RECEIPT_FORMAT_VERSION,
      pack: this.pack.manifest.name,
      packVersion: this.pack.manifest.version,
      language: this.language,
      artifactHash: artifactHashOf(input.artifact),
      schemaHash: this.schemaHash,
      rulesetSnapshot: this.rulesetSnapshot(),
      upstreamHashes: [...(input.upstream ?? [])],
      ...(input.params === undefined ? {} : { params: { ...input.params } as { [key: string]: Json } }),
      iterations: input.iterations,
      rounds: input.rounds,
      rules: this.rollup(input.isValid ? [] : input.unresolved),
      isValid: input.isValid,
      ...(input.terminationReason === undefined ? {} : { terminationReason: input.terminationReason }),
      generatedAt: new Date().toISOString(),
      model: input.model,
    }
  }
}

/** Cache key `${pack}:${language}` → compiled DocService. */
const serviceCache = new Map<string, DocService>()

/** Cached DocService accessor; compilation cost is paid once per (pack, language). */
export function getDocService(pack: Pack, language: string): DocService {
  const key = `${pack.manifest.name}:${language}`
  let service = serviceCache.get(key)
  if (service === undefined) {
    service = new DocService(pack, language)
    serviceCache.set(key, service)
  }
  return service
}

export interface GenerateInput {
  readonly pack: Pack
  readonly language: string
  readonly materials: readonly string[]
  /** Absolute root material references resolve against (from the tool layer). */
  readonly materialsRoot: string
  /** Upstream artifact JSON texts, receipt-verified by the tool layer. */
  readonly upstream?: readonly string[] | undefined
  /** Chain anchors recorded into the receipt (pack/version/hash per upstream). */
  readonly upstreamAnchors?: readonly UpstreamAnchor[] | undefined
  /** Call-time round cap (user intent via the tool arg); clamped by the pack default and config ceiling. */
  readonly maxRounds?: number | undefined
  /** Call-time pack-param overrides; validated against the manifest declaration. */
  readonly params?: Readonly<Record<string, unknown>> | undefined
  readonly artifactName: string
  readonly workspaceRoot: string
  /** Absolute root artifacts/receipts/markdown are written to (tool layer). */
  readonly outputRoot: string
  readonly config: Config
  readonly llm: LlmPort
  readonly signal?: AbortSignal | undefined
  readonly onRound: (round: number, artifact: unknown) => void
}

export interface GenerateOutput {
  readonly artifactPath: string
  readonly markdownPath: string
  readonly receipt: Receipt
}

/** Artifact names become filesystem basenames; reject anything path-shaped. */
export function assertSafeArtifactName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) {
    throw new Error(`artifactName must be a plain basename of [A-Za-z0-9._-] (no path separators, no leading dot); got ${JSON.stringify(name)}`)
  }
}

/** Write via tmp+rename so a crash never leaves a half-written file. */
async function writeAtomic(path: string, content: string): Promise<void> {
  await writeFile(`${path}.tmp`, content, 'utf8')
  await rename(`${path}.tmp`, path)
}

/**
 * doc_generate core: token pre-check → closed loop → persist artifact,
 * markdown, and sidecar receipt. Exhausted loops still write the draft and
 * a red receipt (fail loud, nothing silent).
 */
export async function generateDocument(input: GenerateInput): Promise<GenerateOutput> {
  assertSafeArtifactName(input.artifactName)
  const service = getDocService(input.pack, input.language)
  const effectiveParams = resolveEffectiveParams(input.pack, input.params)
  const materialTexts = await readMaterials(input.materials, input.workspaceRoot, input.materialsRoot)
  const firstPrompt = assembleGeneratorPrompt({ promptTemplate: service.promptTemplate, materials: materialTexts, upstream: input.upstream, params: effectiveParams })
  const budget = estimateTokens(firstPrompt)
  const tokenBudget = input.config.promptTokenBudget ?? DEFAULT_PROMPT_TOKEN_BUDGET
  if (budget > tokenBudget) {
    throw new Error(`generator prompt exceeds token budget (${budget} > ${tokenBudget}); reduce materials or raise promptTokenBudget`)
  }
  // Round cap chain: tool arg (user intent) > pack default > config global, clamped by the hard ceiling.
  const ceiling = input.config.maxRoundsCeiling ?? DEFAULT_MAX_ROUNDS_CEILING
  const requestedRounds = input.maxRounds ?? input.pack.manifest.maxRounds ?? input.config.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isInteger(requestedRounds) || requestedRounds < 1) {
    throw new Error(`maxRounds must be a positive integer (got ${String(requestedRounds)})`)
  }
  const maxIterations = Math.min(requestedRounds, ceiling)
  const model = input.config.model ?? 'unknown'
  const scoring = createScoring(input.pack, input.config)
  const result = await runRepairLoop(
    {
      llm: input.llm,
      promptTemplate: service.promptTemplate,
      materials: materialTexts,
      upstream: input.upstream,
      params: effectiveParams,
      maxIterations,
      promptTokenBudget: tokenBudget,
      model,
      signal: input.signal,
      validate: artifact => service.validate(artifact, effectiveParams),
      scoring,
    },
    (event, artifact) => input.onRound(event.round, artifact),
  )

  const isValid = result.status === 'green'
  const artifact = isValid ? result.artifact : result.draftArtifact
  const unresolved = isValid ? [] : result.unresolved
  const receipt = service.buildReceipt({
    artifact,
    isValid,
    unresolved,
    iterations: result.iterations,
    rounds: result.rounds,
    model,
    upstream: input.upstreamAnchors,
    ...(isValid ? {} : { terminationReason: result.reason }),
    ...(Object.keys(effectiveParams).length > 0 ? { params: effectiveParams } : {}),
  })

  const outDir = input.outputRoot
  await mkdir(outDir, { recursive: true })
  const artifactPath = join(outDir, `${input.artifactName}.json`)
  const receiptPath = join(outDir, `${input.artifactName}.receipt.json`)
  const markdownPath = join(outDir, `${input.artifactName}.md`)
  // Draft-first persistence: the artifact lands on disk before the receipt so
  // any crash between writes leaves a readable draft, never an orphan receipt.
  await writeAtomic(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`)
  await writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  await writeAtomic(markdownPath, service.renderer(artifact))

  if (!isValid) {
    throw new Error(`doc_generate exhausted after ${result.iterations} iterations without going green; draft + red receipt kept at ${artifactPath}. Unresolved: ${unresolved.slice(0, 5).map(i => i.ruleId).join(', ')}${unresolved.length > 5 ? '…' : ''}`)
  }
  return { artifactPath, markdownPath, receipt }
}
