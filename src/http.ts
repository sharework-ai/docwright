import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Read-only HTTP surface for the params maintenance UI (S1 of
 * docs/designs/param-management-ui.md). Mounted as an EXACT route on the
 * host's webServer — and exact registrations win over the host's own /api
 * prefix fence (dsh-market #729 finding), so this layer re-applies the host
 * gate itself: `connection.requestRejection` (the Host/Origin fence plus the
 * browser login — the same verdict the host's own API answers with), read
 * per request because the connection service only exists after the host's
 * async init (mounting happens earlier). The payload provider is lazy for
 * the same reason.
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

/**
 * Mount `GET /api/docwright/params` (exact). Returns the disposer. A
 * read-only route needs no same-origin check (no side effects to forge) —
 * the host gate's login verdict is the boundary; mutating routes (S3) add
 * the same-origin check dsh-market applies.
 */
export function mountParamsRoutes(
  webServer: WebServerLike,
  deps: {
    /** Lazy payload builder (packs/config can change via HMR without a remount). */
    payload: () => unknown
    /** Lazy host-connection accessor; absent on hosts without the service (loopback scripts/tests). */
    connection?: (() => ConnectionLike | undefined) | undefined
  },
): () => void {
  const dispose = webServer.register({
    kind: 'exact',
    path: '/api/docwright/params',
    handler: (request, response) => {
      const connection = deps.connection?.()
      const gate = connection?.requestRejection
      let rejected: number | undefined
      try {
        // The gate is the host's own method — invoke it with its service as
        // `this` (dsh-market's contract: 403/401/undefined). A gate that
        // throws has not admitted anything: fail closed at 403 rather than
        // turning a host bug into an open read.
        rejected = gate === undefined ? undefined : gate.call(connection, request)
      } catch {
        rejected = 403
      }
      if (rejected !== undefined) {
        sendJson(response, rejected, { error: `request rejected by the host gate (status ${rejected})` })
        return
      }
      sendJson(response, 200, deps.payload())
    },
  })
  return dispose
}
