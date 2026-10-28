import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { materialAnchors, type MaterialEntry } from './materials.ts'
import type { Pack, ParamSpec } from './pack.ts'
import { assertValueMatches, type ExtractionNotFound, type ExtractionView, type ExtractedParamValue } from './params.ts'
import type { Json, MaterialAnchor } from './receipt.ts'
import { writeAtomic } from './doc-service.ts'

/**
 * Material param extraction (param provenance, proposal A —
 * docs/designs/params-and-chain-contract.md): the model proposes {value,
 * quote} pairs for pack-declared extractable params and the ENGINE verifies
 * each quote is a verbatim material excerpt — "no quote" means "not found",
 * a first-class result. A required param left notFound is intercepted before
 * generation; the materials must not be silently substituted for.
 */

/** One record of the extraction file. */
export type ExtractionRecord =
  | { readonly status: 'extracted'; readonly value: Json; readonly quote: string }
  | { readonly status: 'notFound'; readonly suggestion?: Json; readonly rationale?: string }

/**
 * On-disk extraction cache, one file per pack next to its artifacts
 * (`<outputRoot>/<pack>.extracted.json`). Re-extraction overwrites the file
 * wholesale — it records the most recent extraction run plus the materials
 * manifest it ran against (audit: model-visible ⟺ log-reconstructible).
 */
export interface ExtractionFile {
  readonly pack: string
  readonly packVersion: string
  readonly materials: readonly MaterialAnchor[]
  readonly extractions: Readonly<Record<string, ExtractionRecord>>
}

/** Per-param outcome row returned by doc_extract_params (the model's feedback loop). */
export type ExtractionResultRow = {
  readonly name: string
  readonly status: 'extracted' | 'notFound'
  readonly value?: Json
  readonly quote?: string
  readonly ref?: string
  readonly suggestion?: Json
  readonly rationale?: string
  /** Why a proposal did not become an extracted value: 'not proposed' | 'quote not found in any material'. */
  readonly reason?: string
}

/** Whitespace-normalized containment — the machine check for quote ⊆ material. */
function normalizeWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** First material whose (whitespace-normalized) text contains the quote. */
export function findQuoteEntry(quote: string, entries: readonly MaterialEntry[]): MaterialEntry | undefined {
  const needle = normalizeWs(quote)
  if (needle.length === 0) return undefined
  return entries.find(e => normalizeWs(e.text).includes(needle))
}

/** Names of params the pack declares extractable. */
export function extractableParams(pack: Pack): readonly string[] {
  return Object.entries(pack.manifest.params ?? {})
    .filter(([, spec]) => spec.extractable === true)
    .map(([name]) => name)
}

/**
 * Read the extraction cache. A missing or corrupt file means "no extraction
 * tier" — same semantics as a corrupt receipt falling back to generation;
 * the cache is never load-bearing for correctness (quotes are re-verified at
 * use time anyway).
 */
export async function readExtractionFile(path: string): Promise<ExtractionFile | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const f = parsed as Partial<ExtractionFile>
  if (typeof f.pack !== 'string' || typeof f.extractions !== 'object' || f.extractions === null || !Array.isArray(f.materials)) {
    return undefined
  }
  return parsed as ExtractionFile
}

export async function writeExtractionFile(path: string, file: ExtractionFile): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`)
}

/** Extraction-cache path convention: next to the pack's artifacts. */
export function extractionFilePath(outputRoot: string, packName: string): string {
  return join(outputRoot, `${packName}.extracted.json`)
}

/**
 * Turn the tool layer's proposed extractions into persisted records plus
 * per-param result rows. Machine checks, fail loud on malformed proposals
 * (they are tool arguments, not a cache): unknown param names, values that
 * violate the installed spec, non-string/empty quotes, a rationale without
 * a suggestion. A quote that simply does NOT appear in the materials is not
 * an error — the proposal degrades to notFound ("no quote" = "not found").
 */
export function processProposals(
  pack: Pack,
  entries: readonly MaterialEntry[],
  proposed: Readonly<Record<string, unknown>>,
): { extractions: Record<string, ExtractionRecord>; results: ExtractionResultRow[] } {
  const packName = pack.manifest.name
  const declared = pack.manifest.params ?? {}
  const extractable = extractableParams(pack)
  const available = extractable.length > 0 ? extractable.join(', ') : 'none declared'
  const extractions: Record<string, ExtractionRecord> = {}
  const results: ExtractionResultRow[] = []
  for (const [name, raw] of Object.entries(proposed)) {
    const spec: ParamSpec | undefined = declared[name]
    if (spec?.extractable !== true) {
      throw new Error(`param "${name}" is not extractable for pack "${packName}" (extractable: ${available}; fix: propose only doc_packs-marked extractable params)`)
    }
    const proposal = raw as { value?: unknown; quote?: unknown; notFound?: unknown; suggestion?: unknown; rationale?: unknown }
    if (proposal.notFound === true) {
      const suggestion = proposal.suggestion
      const rationale = proposal.rationale
      if (rationale !== undefined && typeof rationale !== 'string') {
        throw new Error(`extraction for "${name}": rationale must be a string`)
      }
      if (rationale !== undefined && suggestion === undefined) {
        throw new Error(`extraction for "${name}": rationale requires a suggestion (a rationale explains a proposed value)`)
      }
      if (suggestion !== undefined) {
        assertValueMatches(spec, name, suggestion, packName, false)
        extractions[name] = { status: 'notFound', suggestion: suggestion as Json, ...(rationale === undefined ? {} : { rationale }) }
        results.push({ name, status: 'notFound', suggestion: suggestion as Json, ...(rationale === undefined ? {} : { rationale }) })
      } else {
        extractions[name] = { status: 'notFound' }
        results.push({ name, status: 'notFound', reason: 'not found in materials' })
      }
      continue
    }
    const { value, quote } = proposal
    if (value === undefined || typeof quote !== 'string' || quote.trim().length === 0) {
      throw new Error(`extraction for "${name}" must be { value, quote } with a non-empty verbatim quote, or { notFound: true } (fix: quote the material exactly as it states the value, or report notFound)`)
    }
    assertValueMatches(spec, name, value, packName, false)
    const entry = findQuoteEntry(quote, entries)
    if (entry === undefined) {
      // Not an error: an unprovable proposal IS a notFound (materials do not
      // literally state the value — possibly a mis-copied quote, possibly
      // substitution; either way the engine refuses to carry it as proven).
      extractions[name] = { status: 'notFound' }
      results.push({ name, status: 'notFound', reason: 'quote not found in any material' })
      continue
    }
    extractions[name] = { status: 'extracted', value: value as Json, quote }
    results.push({ name, status: 'extracted', value: value as Json, quote, ref: entry.ref })
  }
  for (const name of extractable) {
    if (name in extractions) continue
    extractions[name] = { status: 'notFound' }
    results.push({ name, status: 'notFound', reason: 'not proposed' })
  }
  return { extractions, results }
}

/**
 * Re-verify the extraction file against the CURRENT call's materials: a
 * value survives only if its quote is still a verbatim excerpt of some
 * material text and the value still satisfies the installed spec (a pack
 * upgrade may have tightened constraints). Everything else drops to the
 * next resolution tier — the file is a cache, not a contract.
 */
export function verifyExtraction(pack: Pack, file: ExtractionFile, entries: readonly MaterialEntry[]): ExtractionView {
  const values: Record<string, ExtractedParamValue> = {}
  const notFound: Record<string, ExtractionNotFound> = {}
  const declared = pack.manifest.params ?? {}
  for (const [name, record] of Object.entries(file.extractions)) {
    const spec: ParamSpec | undefined = declared[name]
    if (spec?.extractable !== true) continue
    if (record.status !== 'extracted') {
      if (record.suggestion !== undefined) {
        notFound[name] = { suggestion: record.suggestion, ...(record.rationale === undefined ? {} : { rationale: record.rationale }) }
      }
      continue
    }
    const entry = findQuoteEntry(record.quote, entries)
    if (entry === undefined) continue
    try {
      assertValueMatches(spec, name, record.value, pack.manifest.name, false)
    } catch {
      continue
    }
    values[name] = { value: record.value, quote: record.quote, ref: entry.ref }
  }
  return { values, notFound }
}

/** Build the persisted file from processed proposals. */
export function buildExtractionFile(pack: Pack, entries: readonly MaterialEntry[], extractions: Readonly<Record<string, ExtractionRecord>>): ExtractionFile {
  return {
    pack: pack.manifest.name,
    packVersion: pack.manifest.version,
    materials: materialAnchors(entries),
    extractions,
  }
}
