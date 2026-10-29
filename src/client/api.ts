/**
 * docwright params UI — host RPC client. Same-origin fetches against the
 * plugin's exact routes (src/http.ts); the host gate (login + Host/Origin
 * fence) applies to every call, so no extra auth handling lives here.
 */

export interface UiParamDeclaration {
  pack: string
  name: string
  type: string
  description: string
  default: unknown
  required: boolean
  confirm: boolean
  overridable: boolean
  extractable: boolean
  enumValues?: readonly (number | string | boolean)[]
  min?: number
  max?: number
  role: 'source' | 'shadowed'
  shadowedBy?: string
}

export interface UiPackEntry {
  name: string
  version: string
  description: string
  scope: 'workspace' | 'topic'
  consumes: readonly string[]
  paramDriftPolicy?: string
  params: readonly UiParamDeclaration[]
}

export interface UiParamGroup {
  name: string
  sources: readonly string[]
  declarations: readonly UiParamDeclaration[]
}

export interface UiConfigEntry {
  key: string
  type: string
  description?: string
  value?: unknown
  default?: unknown
  origin: 'default' | 'configured'
  choices?: readonly (number | string | boolean)[]
}

export interface ParamsPayload {
  packs: readonly UiPackEntry[]
  groups: readonly UiParamGroup[]
  config: readonly UiConfigEntry[]
}

async function parse<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`docwright: the server answered HTTP ${response.status} with a non-JSON body; is the docwright plugin loaded?`)
  }
  if (!response.ok) {
    const detail = (body as { error?: unknown }).error
    throw new Error(typeof detail === 'string' && detail.length > 0 ? detail : `docwright request failed with HTTP ${response.status}`)
  }
  return body as T
}

/** Fetch the params catalog (packs, aggregation groups, config provenance). */
export async function fetchParams(): Promise<ParamsPayload> {
  return parse<ParamsPayload>(await fetch('/api/docwright/params', { headers: { accept: 'application/json' } }))
}

/** Merge a Config patch through the host settings service (server-proxied). */
export async function saveConfigPatch(patch: Record<string, unknown>): Promise<void> {
  await parse(await fetch('/api/docwright/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch }),
  }))
}

/** Set one pack param default in its manifest (server re-validates at load strength). */
export async function savePackParam(pack: string, param: string, value: unknown): Promise<void> {
  await parse(await fetch('/api/docwright/pack-param', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pack, param, value }),
  }))
}
