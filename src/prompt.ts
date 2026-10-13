import type { Issue } from './issue.ts'

/**
 * Generator and repair prompt assembly. Repair prompts embed the current
 * artifact plus issues grouped by jsonPath; oversized artifacts fail loud in
 * the loop's budget pre-check before any model call is spent.
 */

export function assembleGeneratorPrompt(options: {
  promptTemplate: string
  materials: readonly string[]
  upstream?: readonly string[] | undefined
  /** Effective pack params; rendered into the {{params}} slot when the template offers it. */
  params?: Readonly<Record<string, unknown>> | undefined
  /** Declared overridable param names; renders the materials-may-adjust hint after the params block. */
  overridableParams?: readonly string[] | undefined
}): string {
  const materialsBlock = options.materials.map(m => `<material>\n${m}\n</material>`).join('\n\n')
  const upstreamBlock = options.upstream === undefined || options.upstream.length === 0
    ? ''
    : `\n\n<upstream-artifacts>\n${options.upstream.join('\n\n')}\n</upstream-artifacts>`
  let paramsBlock = options.params === undefined || Object.keys(options.params).length === 0
    ? ''
    : `\n\n<effective-params>\n${JSON.stringify(options.params, null, 2)}\n</effective-params>`
  if (paramsBlock !== '' && options.overridableParams !== undefined && options.overridableParams.length > 0) {
    const present = options.overridableParams.filter(n => options.params?.[n] !== undefined)
    if (present.length > 0) {
      paramsBlock += `\n\nMaterials content may adjust these params when the materials clearly justify different values: ${present.join(', ')}. Every other param is a hard constraint — materials must not change it.`
    }
  }
  // Replacer functions: replacement strings interpret $&/$`/$' patterns,
  // which would silently corrupt materials containing them.
  return options.promptTemplate
    .replace('{{materials}}', () => materialsBlock)
    .replace('{{upstream}}', () => upstreamBlock)
    .replace('{{params}}', () => paramsBlock)
}

export function assembleRepairPrompt(options: {
  promptTemplate: string
  originalRequest: string
  artifact: unknown
  issues: readonly Issue[]
}): string {
  const grouped = new Map<string, Issue[]>()
  for (const issue of options.issues) {
    const list = grouped.get(issue.jsonPath) ?? []
    list.push(issue)
    grouped.set(issue.jsonPath, list)
  }
  const issueLines = [...grouped.entries()].map(([path, list]) => {
    const items = list.map(i => `    - [${i.severity}] ${i.ruleId}: ${i.message}${i.suggestion === undefined ? '' : `\n      fix: ${i.suggestion}`}`).join('\n')
    return `  ${path}:\n${items}`
  }).join('\n')
  return [
    options.promptTemplate,
    '',
    '<previous-attempt>',
    options.originalRequest,
    '</previous-attempt>',
    '',
    '<current-artifact>',
    JSON.stringify(options.artifact, null, 2),
    '</current-artifact>',
    '',
    '<validation-issues>',
    issueLines,
    '</validation-issues>',
    '',
    'Fix ONLY the listed issues. Return the complete corrected JSON document and nothing else. Do not change parts not listed above.',
  ].join('\n')
}

/** Rough token estimate for the budget pre-check: CJK chars ≈ 1 token each, others ≈ 4 chars/token. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF]|[\uD840-\uD87F][\uDC00-\uDFFF]/g) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/** Extract the first JSON value from a model reply, tolerating code fences. */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?\n?/g, '')
  const start = stripped.indexOf('{')
  if (start < 0) throw new Error(`no JSON object found in model output (length ${text.length})`)
  // Forward scan tracking string/escape state; JSON.parse only at depth-zero
  // closes keeps adversarial outputs O(n) instead of O(n^2).
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = inString; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1))
        } catch {
          throw new Error(`model output JSON object is malformed (span ${start}..${i})`)
        }
      }
    }
  }
  throw new Error('model output contains no complete parseable JSON object (unbalanced braces)')
}
