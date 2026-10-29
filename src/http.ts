import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * HTTP surface for the params maintenance UI (docs/designs/param-management-ui.md).
 * Mounted as EXACT routes on the host's webServer — and exact registrations
 * win over the host's own /api prefix fence (dsh-market #729 finding), so
 * this layer re-applies the host gate itself: `connection.requestRejection`
 * (the Host/Origin fence plus the browser login — the same verdict the
 * host's own API answers with), read per request because the connection
 * service only exists after the host's async init (mounting happens
 * earlier). Mutating routes additionally enforce same-origin (a forged
 * cross-site POST cannot carry the Host-gated origin) and read a size-capped
 * JSON body.
 */

export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** The slice of the host connection service the routes consume. */
export interface ConnectionLike {
  requestRejection?: ((request: IncomingMessage) => number | undefined) | undefined
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Reject a cross-site write: the Origin header, when present, must match the Host. */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  try {
    const originHost = new URL(origin).host
    return originHost === host
  } catch {
    return false
  }
}

const MAX_BODY_BYTES = 64 * 1024

/** Read and parse a JSON body, refusing oversized or malformed payloads. */
async function readJsonBody(request: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413, error: `request body exceeds ${MAX_BODY_BYTES} bytes` }
    chunks.push(chunk as Buffer)
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch (error) {
    return { ok: false, status: 400, error: `request body is not valid JSON: ${(error as Error).message}` }
  }
}

/** Run the host gate with the service as `this`; a throwing gate fails closed at 403. */
function hostRejection(connection: ConnectionLike | undefined, request: IncomingMessage): number | undefined {
  if (connection === undefined) return undefined
  const gate = connection.requestRejection
  if (gate === undefined) return undefined
  try {
    return gate.call(connection, request)
  } catch {
    return 403
  }
}

export interface WriteChannels {
  /** Merge a Config patch through the host settings service (S3 Config channel). */
  readonly updateConfig: (patch: Record<string, unknown>) => Promise<void>
  /** Set one pack param default in its manifest, re-validating at load strength, and hot-swap the pack map. */
  readonly setPackParamDefault: (pack: string, param: string, value: unknown) => Promise<void>
}

/**
 * Mount the params routes. Returns the disposer.
 * - `GET  /api/docwright/params` — the read catalog (S1).
 * - `POST /api/docwright/config` — `{ patch }` merged into the plugin's live Config via the host settings service.
 * - `POST /api/docwright/pack-param` — `{ pack, param, value }` sets one manifest default.
 */
export function mountParamsRoutes(
  webServer: WebServerLike,
  deps: {
    /** Lazy payload builder (packs/config can change via HMR without a remount). */
    payload: () => unknown
    /** Lazy host-connection accessor; absent on hosts without the service (loopback scripts/tests). */
    connection?: (() => ConnectionLike | undefined) | undefined
    /** Write channels; absent mounts the read route only (headless hosts without a webServer never get here; tests may exercise read-only). */
    writes?: WriteChannels | undefined
  },
): () => void {
  const disposeRead = webServer.register({
    kind: 'exact',
    path: '/api/docwright/params',
    handler: (request, response) => {
      const rejected = hostRejection(deps.connection?.(), request)
      if (rejected !== undefined) {
        sendJson(response, rejected, { error: `request rejected by the host gate (status ${rejected})` })
        return
      }
      sendJson(response, 200, deps.payload())
    },
  })
  if (deps.writes === undefined) return disposeRead

  const post = (path: string, handler: (body: unknown, request: IncomingMessage) => Promise<{ status: number; payload: unknown }>): (() => void) =>
    webServer.register({
      kind: 'exact',
      path,
      handler: async (request, response) => {
        const rejected = hostRejection(deps.connection?.(), request)
        if (rejected !== undefined) {
          sendJson(response, rejected, { error: `request rejected by the host gate (status ${rejected})` })
          return
        }
        // Same-origin for every mutating request (the read route needs none —
        // no side effects to forge).
        if (request.method !== 'POST' || !sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-site write refused: Origin does not match the deployment host' })
          return
        }
        const body = await readJsonBody(request)
        if (!body.ok) {
          sendJson(response, body.status, { error: body.error })
          return
        }
        try {
          const result = await handler(body.body, request)
          sendJson(response, result.status, result.payload)
        } catch (error) {
          // Error contract: what happened, why, what to do next (problem + cause + fix).
          sendJson(response, 422, { error: (error as Error).message })
        }
      },
    })

  const disposeConfig = post('/api/docwright/config', async body => {
    const patch = (body as { patch?: unknown }).patch
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new Error('body must be {"patch": {...}} with an object of Config keys; nothing was written')
    }
    await deps.writes!.updateConfig(patch as Record<string, unknown>)
    return { status: 200, payload: { ok: true } }
  })
  const disposeParam = post('/api/docwright/pack-param', async body => {
    const { pack, param, value } = body as { pack?: unknown; param?: unknown; value?: unknown }
    if (typeof pack !== 'string' || pack.length === 0 || typeof param !== 'string' || param.length === 0) {
      throw new Error('body must be {"pack", "param", "value"} with non-empty pack and param names; nothing was written')
    }
    if (value === undefined) {
      throw new Error('body.value is required (the new default; pass null to state that explicitly is not supported — defaults are edited, not removed, from the UI)')
    }
    await deps.writes!.setPackParamDefault(pack, param, value)
    return { status: 200, payload: { ok: true } }
  })
  return () => {
    disposeParam()
    disposeConfig()
    disposeRead()
  }
}
