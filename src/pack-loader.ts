import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { DeclarativeRule, FunctionRule, Pack, PackManifest, ScoreFn } from './pack.ts'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const SEVERITIES: readonly string[] = ['error', 'warning', 'info']
const RULE_KINDS: readonly string[] = ['minLength', 'maxLength', 'forbiddenKeywords', 'pattern']

/**
 * Directory-convention loader. Built-in packs ship inside the package;
 * `packsDir` entries override same-name packs (DX-H3 merge semantics).
 * Loading validates manifests, rules, prompts, and language coverage loudly:
 * a broken pack fails at plugin apply, never mid-generation.
 */

interface RawPackDirs {
  readonly extra?: readonly string[] | undefined
}

function assertManifest(raw: unknown, dir: string): PackManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error(`pack ${dir}: manifest.json must be an object`)
  const m = raw as Partial<PackManifest>
  if (typeof m.name !== 'string' || m.name.length === 0) throw new Error(`pack ${dir}: manifest.name must be a non-empty string`)
  if (typeof m.version !== 'string' || m.version.length === 0) throw new Error(`pack ${dir}: manifest.version must be a non-empty string`)
  if (typeof m.description !== 'string' || m.description.length === 0) {
    throw new Error(`pack ${dir}: manifest.description must be a non-empty string (one line naming the document this pack generates; doc_packs shows it to the model)`)
  }
  if (!Array.isArray(m.languages) || m.languages.length === 0) throw new Error(`pack ${dir}: manifest.languages must be a non-empty array`)
  if (m.languages.some(l => typeof l !== 'string' || l.length === 0)) throw new Error(`pack ${dir}: manifest.languages entries must be non-empty strings`)
  if (m.consumes !== undefined && !Array.isArray(m.consumes)) throw new Error(`pack ${dir}: manifest.consumes must be an array when present`)
  return { name: m.name, version: m.version, description: m.description, consumes: m.consumes ?? [], languages: m.languages }
}

/**
 * Strict declarative-rule validation: a typo like severity "fatal" would
 * otherwise pass loading, never count as an error, and the loop would go
 * green over a failing rule. Kind-specific payloads are validated and
 * patterns compile-checked here.
 */
function assertRule(raw: unknown, dir: string, i: number): DeclarativeRule {
  if (typeof raw !== 'object' || raw === null) throw new Error(`pack ${dir}: rules[${i}] must be an object`)
  const r = raw as Record<string, unknown>
  for (const k of ['id', 'severity', 'given', 'field', 'suggestion']) {
    if (typeof r[k] !== 'string' || (r[k] as string).length === 0) throw new Error(`pack ${dir}: rules[${i}].${k} must be a non-empty string`)
  }
  if (!SEVERITIES.includes(String(r.severity))) {
    throw new Error(`pack ${dir}: rules[${i}].severity must be one of error|warning|info (got ${JSON.stringify(r.severity)})`)
  }
  if (!RULE_KINDS.includes(String(r.kind))) {
    throw new Error(`pack ${dir}: rules[${i}].kind must be one of ${RULE_KINDS.join('|')}`)
  }
  switch (r.kind) {
    case 'minLength':
      if (typeof r.min !== 'number' || !Number.isFinite(r.min)) throw new Error(`pack ${dir}: rules[${i}].minLength requires a finite numeric min`)
      break
    case 'maxLength':
      if (typeof r.max !== 'number' || !Number.isFinite(r.max)) throw new Error(`pack ${dir}: rules[${i}].maxLength requires a finite numeric max`)
      break
    case 'forbiddenKeywords':
      if (!Array.isArray(r.keywords) || r.keywords.length === 0 || r.keywords.some(k => typeof k !== 'string' || k.length === 0)) {
        throw new Error(`pack ${dir}: rules[${i}].forbiddenKeywords requires a non-empty array of non-empty strings`)
      }
      break
    case 'pattern':
      if (typeof r.pattern !== 'string' || r.pattern.length === 0) throw new Error(`pack ${dir}: rules[${i}].pattern must be a non-empty string`)
      if (typeof r.mustMatch !== 'boolean') throw new Error(`pack ${dir}: rules[${i}].pattern requires a boolean mustMatch`)
      try {
        void new RegExp(r.pattern)
      } catch (error) {
        throw new Error(`pack ${dir}: rules[${i}].pattern does not compile: ${(error as Error).message}`)
      }
      break
  }
  return r as unknown as DeclarativeRule
}

/** Function-rule modules authored by pack maintainers; validated on load. */
async function loadFunctionRules(dir: string): Promise<{ rules: readonly FunctionRule[]; sourceHash: string; score: ScoreFn | undefined }> {
  const rulesPath = join(dir, 'rules', 'functions.js')
  let source: string
  try {
    source = await readFile(rulesPath, 'utf8')
  } catch {
    return { rules: [], sourceHash: '', score: undefined }
  }
  let mod: Record<string, unknown>
  try {
    mod = await import(rulesPath)
  } catch (error) {
    // A present-but-broken functions.js must never silently disable rules.
    throw new Error(`pack ${dir}: rules/functions.js failed to import (${(error as Error).message}); fix the module or remove the file`)
  }
  const exported = mod.rules
  if (exported === undefined) throw new Error(`pack ${dir}: rules/functions.js must export a \`rules\` array`)
  if (!Array.isArray(exported)) throw new Error(`pack ${dir}: rules/functions.js \`rules\` must be an array`)
  const rules = exported.map((raw, i) => {
    const r = raw as Partial<FunctionRule>
    if (typeof r.id !== 'string' || r.id.length === 0) throw new Error(`pack ${dir}: functions.rules[${i}].id must be a non-empty string`)
    if (typeof r.suggestion !== 'string' || r.suggestion.length === 0) throw new Error(`pack ${dir}: functions.rules[${i}] must carry a suggestion`)
    if (typeof r.check !== 'function') throw new Error(`pack ${dir}: functions.rules[${i}].check must be a function`)
    if (r.severity !== undefined && !SEVERITIES.includes(String(r.severity))) {
      throw new Error(`pack ${dir}: functions.rules[${i}].severity must be error|warning|info`)
    }
    return { ...r, severity: r.severity ?? 'error' } as FunctionRule
  })
  const score = mod.score
  if (score !== undefined && typeof score !== 'function') {
    throw new Error(`pack ${dir}: rules/functions.js \`score\` export must be a function (artifact, issues) => 0-100 number`)
  }
  return { rules, sourceHash: sha256(source), score: score as ScoreFn | undefined }
}

async function loadOnePack(dir: string): Promise<Pack> {
  const manifest = assertManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')), dir)
  const schema = JSON.parse(await readFile(join(dir, 'schema.json'), 'utf8')) as Record<string, unknown>

  const rules = new Map<string, readonly DeclarativeRule[]>()
  const prompts = new Map<string, string>()
  const templates = new Map<string, string>()
  for (const lang of manifest.languages) {
    const rawRules = JSON.parse(await readFile(join(dir, 'rules', `${lang}.json`), 'utf8')) as unknown[]
    if (!Array.isArray(rawRules)) throw new Error(`pack ${dir}: rules/${lang}.json must be an array`)
    rules.set(lang, rawRules.map((r, i) => assertRule(r, dir, i)))
    const prompt = await readFile(join(dir, 'prompts', `${lang}.md`), 'utf8')
    if (!prompt.includes('{{materials}}')) {
      throw new Error(`pack ${dir}: prompts/${lang}.md is missing the {{materials}} slot; materials would be silently dropped`)
    }
    prompts.set(lang, prompt)
    templates.set(lang, await readFile(join(dir, 'templates', `${lang}.hbs`), 'utf8'))
  }
  const goldenSample = JSON.parse(await readFile(join(dir, 'samples', 'golden.json'), 'utf8'))
  const { rules: functionRules, sourceHash, score } = await loadFunctionRules(dir)
  return { manifest, schema, rules, functionRules, score, functionsSourceHash: sourceHash, prompts, templates, goldenSample, dir }
}

async function listPackRoots(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => join(root, e.name))
  } catch {
    return []
  }
}

/**
 * Load built-in packs then `packsDir` overrides. Same-name later entries win
 * (Config over built-in); failures inside a directory fail loud (ruleset
 * syntax belongs to load time, decision #11).
 */
export async function loadPacks(builtinRoot: string, dirs: RawPackDirs): Promise<ReadonlyMap<string, Pack>> {
  const roots = [builtinRoot, ...(dirs.extra ?? [])]
  const packs = new Map<string, Pack>()
  for (const root of roots) {
    for (const dir of await listPackRoots(root)) {
      const pack = await loadOnePack(dir)
      packs.set(pack.manifest.name, pack)
    }
  }
  return packs
}
